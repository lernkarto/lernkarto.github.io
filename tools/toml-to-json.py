#!/usr/bin/env python3
r"""
toml-to-json.py — convert a TOML-authored deck or set into the JSON the app loads.

Why this exists
---------------
Quantile's runtime format is JSON: the browser parses it natively, no build step,
no dependency. TOML is offered purely as an *authoring convenience*. Its biggest
practical advantage for this project is literal strings (single quotes): inside
them, backslashes are NOT escape characters, so LaTeX can be written naturally —

    formula = '$\\mathrm{VaR}_\\alpha = \\inf\\{l : P(L>l) \\le 1-\\alpha\\}$'   # JSON: every \\ doubled
    formula = '$\mathrm{VaR}_\alpha = \inf\{l : P(L>l) \le 1-\alpha\}$'         # TOML literal: as written

Author in TOML if you prefer, then convert to JSON and drop the result into data/decks/
(for a deck) or data/topics/ (for a topic). Both deck and topic files convert the same way —
this script just translates the format, it does not validate the schema.

Usage
-----
    python3 tools/toml-to-json.py authoring/decks/example-deck.toml
    python3 tools/toml-to-json.py authoring/decks/example-deck.toml data/decks/example-toml.json
    python3 tools/toml-to-json.py authoring/topics/banking-risk-full.toml data/topics/banking-risk-full.json

If no output path is given, the input path is reused with a .json extension.
Requires Python 3.11+ (tomllib is in the standard library from 3.11).
"""

import json
import sys
from pathlib import Path

try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:  # pragma: no cover
    sys.stderr.write(
        "error: tomllib not found — this script needs Python 3.11 or newer.\n"
        "       (Or 'pip install tomli' and change the import to use it.)\n"
    )
    raise SystemExit(2)


def convert_toml_file_to_json(input_path: Path, output_path: Path) -> int:
    with input_path.open("rb") as toml_file:
        parsed_document = tomllib.load(toml_file)

    if not isinstance(parsed_document, dict):
        sys.stderr.write("error: top-level TOML must be a table (key = value pairs).\n")
        return 1

    looks_like_deck = isinstance(parsed_document.get("cards"), list)
    looks_like_set = isinstance(parsed_document.get("decks"), list) or isinstance(
        parsed_document.get("deckFiles"), list
    )
    if looks_like_deck:
        kind, count = "deck", len(parsed_document["cards"])
        detail = f"{count} card(s)"
    elif looks_like_set:
        kind = "set"
        deck_files = parsed_document.get("deckFiles", []) or []
        inline_decks = parsed_document.get("decks", []) or []
        detail = f"{len(deck_files)} deck file(s), {len(inline_decks)} inline deck(s)"
    else:
        kind, detail = "unknown", "no 'cards', 'decks' or 'deckFiles' key found"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as json_file:
        json.dump(parsed_document, json_file, ensure_ascii=False, indent=2)
        json_file.write("\n")

    print(f"converted {kind}: {input_path}  ->  {output_path}  ({detail})")
    if kind == "unknown":
        print("  note: file converted, but it doesn't look like a deck or a set.")
    return 0


def main(argv) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        sys.stderr.write(__doc__)
        return 0 if (len(argv) > 1 and argv[1] in ("-h", "--help")) else 2

    input_path = Path(argv[1])
    if not input_path.exists():
        sys.stderr.write(f"error: no such file: {input_path}\n")
        return 1

    output_path = Path(argv[2]) if len(argv) > 2 else input_path.with_suffix(".json")
    return convert_toml_file_to_json(input_path, output_path)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
