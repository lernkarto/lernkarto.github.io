#!/usr/bin/env python3
r"""
build-standalone.py — bundle lernkarto into one offline, double-clickable HTML file.

The hosted app loads its decks with fetch(), which browsers block on the file://
protocol — so a plain index.html opened from disk shows nothing. This script
produces dist/lernkarto-offline.html with EVERYTHING inlined:

    • the stylesheet
    • the engine (js/app.js)
    • the fully resolved deck set, embedded as window.RECTO_EMBEDDED_DECKS
    • KaTeX's JS (katex.min.js + auto-render) so LaTeX renders
    • KaTeX's CSS with the woff2 fonts base64-embedded, so math glyphs work
      with no font files to fetch

The result needs no server, no internet and no install: open it, or email it,
or drop it on a USB stick. It is the 'offline dedicated way' to use the app.

Usage:
    python3 tools/build-standalone.py               # personal build — INCLUDES private/ overlay
    python3 tools/build-standalone.py --public       # clean, shareable build (no private decks)
    python3 tools/build-standalone.py --standard     # LAUNCH build — only "standard": true sets
    python3 tools/build-standalone.py --out path.html

No third-party dependencies; standard library only.
"""

import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read_text(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def _resolve_manifest(manifest_path: str, topic_dir: str, deck_dir: str, embedded_decks: list, standard_only: bool = False) -> None:
    manifest = json.loads(read_text(manifest_path))
    # "topics" is canonical; "sets" is the legacy key (still read for old/private manifests)
    for topic_file_name in (manifest.get("topics") or manifest.get("sets") or []):
        topic_object = json.loads(read_text(topic_dir + topic_file_name))
        if standard_only and not topic_object.get("standard"):
            continue   # launch build: ship only the curated standard library
        topic_name = topic_object.get("topic") or topic_object.get("set") or topic_object.get("name")
        topic_subject = topic_object.get("subject")
        # a topic may belong to several subjects: normalise to a list
        topic_subjects = topic_subject if isinstance(topic_subject, list) else ([topic_subject] if topic_subject else [])
        for inline_deck in topic_object.get("decks", []) or []:
            inline_deck.setdefault("topic", topic_name)
            if topic_subjects:
                inline_deck.setdefault("subjects", topic_subjects)
            embedded_decks.append(inline_deck)
        for deck_file_name in topic_object.get("deckFiles", []) or []:
            deck_object = json.loads(read_text(deck_dir + deck_file_name))
            deck_object.setdefault("topic", topic_name)
            if topic_subjects:
                deck_object.setdefault("subjects", topic_subjects)
            embedded_decks.append(deck_object)


def resolve_deck_set(include_private: bool = False, standard_only: bool = False) -> list:
    """Load every deck referenced by every shipped topic, tagged with its topic name.
    With include_private, also fold in the local-only private/ overlay (if present).
    With standard_only, ship only topics flagged "standard": true (the launch library)."""
    embedded_decks = []
    _resolve_manifest("data/manifest.json", "data/topics/", "data/decks/", embedded_decks, standard_only=standard_only)
    if include_private and not standard_only and (ROOT / "private" / "manifest.json").exists():
        _resolve_manifest("private/manifest.json", "private/", "private/", embedded_decks)
    return embedded_decks


def inline_katex_css() -> str:
    """KaTeX CSS with each woff2 referenced font replaced by a base64 data URI,
    and the woff/ttf fallbacks (whose files we don't ship) stripped to avoid 404s."""
    css = read_text("vendor/katex/katex.min.css")

    def woff2_to_data_uri(match: "re.Match") -> str:
        font_file = match.group(1)  # e.g. KaTeX_Main-Regular.woff2
        font_bytes = (ROOT / "vendor/katex/fonts" / font_file).read_bytes()
        encoded = base64.b64encode(font_bytes).decode("ascii")
        return f"url(data:font/woff2;base64,{encoded})"

    css = re.sub(r"url\(fonts/([^)]+\.woff2)\)", woff2_to_data_uri, css)
    # remove the now-unbacked woff / ttf sources (leading comma + format() included)
    css = re.sub(r",\s*url\(fonts/[^)]+\.(?:woff|ttf)\)\s*format\([^)]*\)", "", css)
    return css


def extract_body_inner(index_html: str) -> str:
    """Pull the <body> contents out of index.html and drop the external script tags."""
    match = re.search(r"<body[^>]*>(.*)</body>", index_html, re.DOTALL | re.IGNORECASE)
    body_inner = match.group(1) if match else index_html
    body_inner = re.sub(r'<script src="js/schema\.js"></script>\s*', "", body_inner)
    body_inner = re.sub(r'<script src="js/graphs\.js"></script>\s*', "", body_inner)
    body_inner = re.sub(r'<script src="js/app\.js"></script>\s*', "", body_inner)
    return body_inner.strip()


def build(output_path: Path, include_private: bool = False, standard_only: bool = False) -> None:
    schema_js = read_text("js/schema.js")
    graphs_js = read_text("js/graphs.js")
    app_js = read_text("js/app.js")
    app_css = read_text("css/styles.css")
    katex_js = read_text("vendor/katex/katex.min.js")
    autorender_js = read_text("vendor/katex/contrib/auto-render.min.js")
    katex_css = inline_katex_css()
    body_inner = extract_body_inner(read_text("index.html"))

    embedded_decks = resolve_deck_set(include_private, standard_only=standard_only)
    card_total = sum(len(deck.get("cards", [])) for deck in embedded_decks)
    # JSON safe to drop inside a <script> element
    decks_json = json.dumps(embedded_decks, ensure_ascii=False).replace("</", "<\\/")

    # data/manifest.json is the single discovery file: brand + topics + subjects + courses
    data_manifest = json.loads(read_text("data/manifest.json"))
    brand = data_manifest.get("brand") or {}
    brand_json = json.dumps(brand, ensure_ascii=False).replace("</", "<\\/")
    brand_name = brand.get("name", "lernkarto")
    brand_tag = brand.get("tagline", "flashcards")

    # subject registry (metadata + primers): load individual files, embed as {name: {...}} dict
    subjects = {}
    for sf in data_manifest.get("subjects", []):
        try:
            obj = json.loads(read_text("data/subjects/" + sf))
            if obj.get("name"): subjects[obj["name"]] = obj
        except Exception: pass
    subjects_json = json.dumps(subjects, ensure_ascii=False).replace("</", "<\\/")

    # authored course registry: load individual files, embed as array
    courses = []
    for cf in data_manifest.get("courses", []):
        try: courses.append(json.loads(read_text("data/courses/" + cf)))
        except Exception: pass
    courses_json = json.dumps(courses, ensure_ascii=False).replace("</", "<\\/")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{brand_name} — {brand_tag} (offline)</title>
<meta name="description" content="Offline single-file build: {card_total} flashcards with LaTeX. No server, no network.">
<style>{katex_css}</style>
<style>{app_css}</style>
<script>{katex_js}</script>
<script>{autorender_js}</script>
</head>
<body>
{body_inner}
<script>window.RECTO_BRAND = {brand_json};</script>
<script>window.RECTO_SUBJECTS = {subjects_json};</script>
<script>window.RECTO_COURSES = {courses_json};</script>
<script>window.RECTO_EMBEDDED_DECKS = {decks_json};</script>
<script>{schema_js}</script>
<script>{graphs_js}</script>
<script>{app_js}</script>
</body>
</html>
"""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"built {output_path}")
    print(f"  {len(embedded_decks)} decks · {card_total} cards · {size_mb:.2f} MB · fully self-contained")


def main(argv) -> int:
    output_path = ROOT / "dist" / "lernkarto-offline.html"
    if "--out" in argv:
        output_path = Path(argv[argv.index("--out") + 1])
    # Default build INCLUDES the local private/ overlay (personal full build).
    # Use --public for a clean, shareable build with no private decks.
    # Use --standard for the launch build: only sets flagged "standard": true
    # (the curated standard library), and never the private overlay.
    standard_only = "--standard" in argv
    include_private = ("--public" not in argv) and not standard_only
    build(output_path, include_private=include_private, standard_only=standard_only)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
