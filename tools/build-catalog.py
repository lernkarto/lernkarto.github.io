#!/usr/bin/env python3
"""Phase A: emit a versioned content catalog (metadata only, no cards) from the
deck/topic/subject files. The thin app bundles this to browse the whole library
offline, and diffs each deck's `hash` to know what to (re)download on demand.

Usage: python3 tools/build-catalog.py   ->   writes catalog.json at the repo root.
"""
import json, hashlib, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
T = os.path.join(DATA, "topics"); D = os.path.join(DATA, "decks")
S = os.path.join(DATA, "subjects"); C = os.path.join(DATA, "courses")

def jload(p):
    with open(p, encoding="utf-8") as f: return json.load(f)

# single discovery file: brand + topics + subjects + courses
data_manifest = jload(os.path.join(DATA, "manifest.json"))

# load subjects from individual files
subjects = {}
for sf in data_manifest.get("subjects", []):
    sp = os.path.join(S, sf)
    if os.path.exists(sp):
        obj = jload(sp)
        if obj.get("name"): subjects[obj["name"]] = obj
topic2subj = {}
for s, meta in subjects.items():
    for t in meta.get("topics", []):
        topic2subj.setdefault(t, []).append(s)

manifest = data_manifest.get("topics", data_manifest.get("sets", []))
deck2topics, topics_out = {}, []
for tf in manifest:
    tp = os.path.join(T, tf)
    if not os.path.exists(tp): continue
    tj = jload(tp)
    name = tj.get("topic", tf)
    topics_out.append({"id": tj.get("id"), "name": name, "file": f"data/topics/{tf}",
                       "standard": bool(tj.get("standard")),
                       "subjects": topic2subj.get(name, []),
                       "deckFiles": tj.get("deckFiles", [])})
    for df in tj.get("deckFiles", []):
        deck2topics.setdefault(df, set()).add(name)

decks_out, total_bytes, total_cards = [], 0, 0
for fn in sorted(os.listdir(D)):
    if not fn.endswith(".json"): continue
    p = os.path.join(D, fn)
    raw = open(p, "rb").read()
    dj = json.loads(raw)
    tops = sorted(deck2topics.get(fn, []))
    subs = sorted({s for t in tops for s in topic2subj.get(t, [])})
    cards = dj.get("cards", [])
    total_bytes += len(raw); total_cards += len(cards)
    decks_out.append({
        "id": dj.get("id"), "file": f"data/decks/{fn}", "name": dj.get("name", fn),
        "description": dj.get("description", ""), "tags": dj.get("tags", []),
        "color": dj.get("color"), "cardCount": len(cards), "bytes": len(raw),
        "hash": hashlib.sha256(raw).hexdigest()[:16],
        "topics": tops, "subjects": subs,
        "hasPrimer": bool(dj.get("primer")), "orphan": not tops,
    })

# load courses from individual files
courses = []
for cf in data_manifest.get("courses", []):
    cp = os.path.join(C, cf)
    if os.path.exists(cp):
        try: courses.append(jload(cp))
        except Exception: pass

# catalog version = hash of the per-deck hashes (changes iff any deck changes)
cat_ver = hashlib.sha256("".join(sorted(d["hash"] for d in decks_out)).encode()).hexdigest()[:12]
catalog = {"catalogVersion": cat_ver, "counts": {"decks": len(decks_out), "cards": total_cards, "bytes": total_bytes},
           "subjects": subjects, "topics": topics_out, "decks": decks_out, "courses": courses}
out = os.path.join(ROOT, "catalog.json")
with open(out, "w", encoding="utf-8") as f: json.dump(catalog, f, ensure_ascii=False, indent=2)
print(f"wrote catalog.json  · v{cat_ver} · {len(decks_out)} decks · {total_cards} cards · index {os.path.getsize(out)//1024} KB vs full library {total_bytes//1024} KB")
