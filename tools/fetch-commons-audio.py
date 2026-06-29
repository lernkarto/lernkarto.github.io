#!/usr/bin/env python3
r"""
fetch-commons-audio.py — attach VERIFIED Wikimedia Commons pronunciation audio to a deck.

Guessed audio URLs would 404; this script only writes URLs for files the Commons API
confirms exist. It derives candidate filenames per card using a per-deck "scheme",
checks them against the API (batched, with a User-Agent — Wikimedia 403s without one),
and writes card["audio"] = the real upload URL for the first candidate that exists.
Cards with no match are left untouched (the app falls back to speech-synthesis TTS).

Schemes:
  russian   Ru-<lowercase cyrillic letter>.ogg          (from the card term)
  japanese  Ja-<Capitalised romaji>.oga                  (romaji from the definition)
  ipa       <Phone name>.ogg                             (phone name from the definition,
                                                          trying with/without voiced/voiceless)

Usage:
  python3 tools/fetch-commons-audio.py decks/cyrillic.json russian
  python3 tools/fetch-commons-audio.py decks/hiragana.json japanese
  python3 tools/fetch-commons-audio.py decks/ipa.json ipa
  (add --dry-run to report coverage without writing)
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "lernkarto/0.1 (deck pronunciation audio; offline study app)"}


def first_token(text: str) -> str:
    """leading word of a definition: 'a (as in ...)' -> 'a', 'ka' -> 'ka'."""
    t = text.strip()
    for sep in (" (", " ", "—", ",", "/"):
        if sep in t:
            t = t.split(sep)[0].strip()
    return t


def candidates(card: dict, scheme: str) -> list:
    term = card.get("term", "").strip()
    defn = card.get("definition", "").strip()
    if scheme == "russian":
        letter = (term.split()[-1] if term else "").lower()   # "А а" -> "а"
        return [f"Ru-{letter}.ogg"] if letter else []
    if scheme == "japanese":
        romaji = first_token(defn)
        if not romaji:
            return []
        cap = romaji[:1].upper() + romaji[1:]
        return [f"Ja-{cap}.oga", f"Ja-{cap}.ogg"]
    if scheme == "ipa":
        name = defn.split("(")[0].strip().rstrip(".")
        if not name:
            return []
        variants = [name]
        for prefix in ("voiced ", "voiceless "):
            if name.lower().startswith(prefix):
                variants.append(name[len(prefix):])
        # capitalise first letter only (Commons style: "Voiceless bilabial plosive.ogg")
        return [v[:1].upper() + v[1:] + ".ogg" for v in variants]
    raise SystemExit(f"unknown scheme: {scheme}")


def lookup(titles: list) -> dict:
    """map 'Filename.ogg' -> real upload URL (or None) for a batch of titles."""
    found = {}
    uniq = list(dict.fromkeys(titles))
    for i in range(0, len(uniq), 40):
        chunk = uniq[i:i + 40]
        q = (API + "?action=query&format=json&prop=imageinfo&iiprop=url&titles="
             + urllib.parse.quote("|".join("File:" + t for t in chunk)))
        req = urllib.request.Request(q, headers=UA)
        data = None
        for attempt in range(5):                      # back off on 429 rate-limit
            try:
                data = json.load(urllib.request.urlopen(req, timeout=30))
                break
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 4:
                    time.sleep(8 * (attempt + 1))
                    continue
                raise
        time.sleep(1)                                 # be polite between batches
        norm = {n["to"]: n["from"] for n in data["query"].get("normalized", [])}
        for page in data["query"]["pages"].values():
            title = page["title"]
            key = norm.get(title, title).replace("File:", "")
            url = None
            if "missing" not in page and page.get("imageinfo"):
                url = page["imageinfo"][0]["url"]
            found[key] = url
    return found


def main(argv) -> int:
    args = [a for a in argv if not a.startswith("--")]
    dry = "--dry-run" in argv
    if len(args) < 3:
        print(__doc__)
        return 2
    deck_path, scheme = args[1], args[2]
    deck = json.load(open(deck_path, encoding="utf-8"))
    cards = deck.get("cards", [])

    all_titles = []
    per_card = []
    for card in cards:
        cands = candidates(card, scheme)
        per_card.append(cands)
        all_titles.extend(cands)

    found = lookup(all_titles)

    hits = 0
    for card, cands in zip(cards, per_card):
        url = next((found.get(c) for c in cands if found.get(c)), None)
        if url:
            hits += 1
            if not dry:
                card["audio"] = url
        # else: leave as-is (TTS fallback)

    print(f"{deck_path} [{scheme}]: {hits}/{len(cards)} cards matched Commons audio"
          + (" (dry-run, not written)" if dry else ""))
    if not dry and hits:
        with open(deck_path, "w", encoding="utf-8") as fh:
            json.dump(deck, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
