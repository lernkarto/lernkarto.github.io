# Contributing

## Versioning and stability contract

lernkarto follows [Semantic Versioning](https://semver.org/) with an optional
data-patch suffix (see [Versioning](#versioning) below).

| Phase | Contract |
|---|---|
| Pre-1.0 (current) | No backward-compatibility guarantees. Any release may break any consumer. Active development happens on the `dev` branch directly. Topic branches are encouraged but not required. |
| Post-1.0 | Breaking changes require a major-version bump. Additive changes within `1.x` are permitted. Removal of any public API requires at least one minor release with a deprecation notice first. The branching model below applies. |

## Branching model (effective at v1.0.0)

| Branch | Role | Lifecycle |
|---|---|---|
| `main` | Delivered software. Holds release-tagged commits only. | Long-lived. Receives merges only from `dev` at release time. GitHub Pages deploys from here — each push is squashed to a single `First commit`. |
| `dev` | Integration branch. Active work converges here. | Long-lived. Receives merges from topic branches. |
| `dev_patch_<name>` | Short-lived bug-fix branch. | Created from `dev`; merged back to `dev`; deleted after merge. |
| `dev_<feature_name>` | Short-lived feature branch. | Same pattern as `dev_patch_<name>`. |

### Release procedure (post-1.0)

1. All work for the release lands on `dev` via topic branches.
2. `CHANGELOG.md` version is updated on `dev`.
3. Merge `dev` → `main` (fast-forward or squash).
4. `git tag -a vX.Y.Z -m "..."` on `main`.
5. `git push origin main --tags` — Pages deploys automatically.
6. Cut a GitHub Release from the tag with notes derived from the `CHANGELOG.md` entry.

## Tests

The engine has a zero-dependency unit suite. Run it before pushing engine changes:

```bash
node tests/run.js
```

It loads `js/schema.js` then `js/app.js` into a Node `vm` with a stubbed DOM and
asserts pure functions (card parsing, deck normalisation, fuzzy grading, CSV/TSV
import, tags, virtual cross-deck builder). `js/graphs.js` is excluded — it requires
a live DOM. Add a case when you touch any of those.

Tests must pass on the working branch before any merge into `dev`.

---

Two kinds of content contribution are most welcome: **new decks/topics**, and
**accuracy fixes** to existing cards.

> Authoring guides live in [`guides/`](guides/) — one per entity type:
> [deck](guides/DECK-DESIGN-GUIDE.md) · [topic](guides/TOPIC-GUIDE.md) ·
> [subject](guides/SUBJECT-GUIDE.md) · [course](guides/COURSE-GUIDE.md).
> Every new piece of content should clear the bar set there.

## Add a deck

1. Create `data/decks/your-deck.json`. Minimum viable card:
   ```json
   {
     "name": "Your deck",
     "color": "#00ff88",
     "cards": [
       { "term": "Front", "definition": "Back.", "formula": "$E=mc^2$", "note": "Optional caveat." }
     ]
   }
   ```
   Required: `name`, and each card's `term` + `definition`. Everything else
   (`id`, `description`, `color`, `topic`, `categories`, and per-card `sub` /
   `formula` / `note` / `category` / `graph`) is optional. Full schema, field
   aliases, and the interactive graph format are in
   [DECK-DESIGN-GUIDE.md](guides/DECK-DESIGN-GUIDE.md).

2. To make it load on startup, add it to a topic's `deckFiles` (e.g.
   `data/topics/banking-risk-full.json`) — or create a new topic and list it in
   `data/manifest.json`.

3. Prefer authoring in **TOML**? TOML literal strings (single quotes) keep LaTeX backslashes
   intact — handy for formula-heavy decks. Convert once, then edit the JSON going forward:
   ```bash
   python3 tools/toml-to-json.py authoring/your-deck.toml data/decks/your-deck.json
   ```
   The JSON in `data/decks/` is always the master. In JSON, remember to double every backslash.

## Add a topic

A topic groups decks into a browsable unit. See the [topic guide](guides/TOPIC-GUIDE.md) for
the full format and conventions. Quick version: list deck filenames in `deckFiles` (resolved
from `data/decks/`), or inline whole decks under `decks`. Then reference the topic file
in `data/manifest.json`.

## Add a subject

A subject bundles related topics. See the [subject guide](guides/SUBJECT-GUIDE.md).
Create `data/subjects/<slug>.json`, list the `topics` by their `topic` display name, write a
primer, then register in `data/manifest.json`.

## Add a course

A course is an ordered playlist — decks, topics, or subjects assembled into a study path.
See the [course guide](guides/COURSE-GUIDE.md). Create `data/courses/<id>.json`, sequence
your `items`, then register in `data/manifest.json`.

## After changing content

- **Validate JSON** before committing:
  ```bash
  python3 -m json.tool data/decks/your-deck.json > /dev/null && echo OK
  ```
- **Check LaTeX renders** by loading the deck (`python3 -m http.server`, then
  open the app). Math showing as raw text almost always means single backslashes
  in JSON — double them.
- **Rebuild the offline file** if you want it to include your changes:
  ```bash
  python3 tools/build-standalone.py
  ```
- **Keep docs in sync**: if you change the deck/set schema or the loader, update
  the schema section of the README and this file together.

## Accuracy

Definitions are compressed for study, but they should not be *wrong*. If you spot
an error, open a PR with the correction and — where it helps — a one-line pointer
to a primary source (Basel text, Hull, Jorion). Substance over prose: a precise,
plain definition beats an elegant, fuzzy one.

## Help translate (i18n)

The app ships in English today, and help bringing it to **French, Italian and
Spanish** (and beyond) is very welcome. There are two independent things to
translate — pick either:

1. **The interface** (buttons, tabs, settings, prompts). Once the UI strings are
   externalised into `i18n/<lang>.json`, translating is just copying `i18n/en.json`
   to your locale and filling in the values — keep the keys, translate the text.
   Missing keys fall back to English, so a partial translation is still useful and
   safe to submit. Add your locale to the language picker in the same PR.
2. **Deck content** (the cards themselves). Author a translated deck as its own
   file with a `lang` field (BCP-47, e.g. `"lang": "fr"`) and a `translationOf`
   pointing at the source deck's `id`, so the library can offer the same deck in
   multiple languages. Translate the *meaning*, not word-for-word — and keep any
   `source` / `license` / `attribution` accurate for the language you worked from
   (e.g. a deck distilled from `fr.wikipedia.org` keeps its CC BY-SA attribution to
   the French article).

If the i18n scaffolding (the `i18n/` dictionary and `t()` helper) doesn't exist
yet when you read this, open an issue first — landing the extraction is the
blocker, and we'd rather coordinate than have two parallel attempts. See the
**Internationalization** section of the [ROADMAP](ROADMAP.md) for the design.

Same rules as any content: validate JSON, check it loads, and don't machine-
translate without a human pass — a fluent, faithful card beats a literal one.

## Versioning

lernkarto uses **semver** with a data-patch suffix:

```
vMAJOR.MINOR.PATCH[-N]
```

| Part | Meaning |
|---|---|
| `MAJOR.MINOR.PATCH` | Standard semver — engine and schema changes. |
| `-N` | **Data patch.** Increments for deck/topic/subject/course additions or fixes that carry no engine change. N resets to 1 whenever the semver string changes. |

Examples: `v1.0.0` (engine release) → `v1.0.0-1` (first data-only update) → `v1.0.0-2` (another) → `v1.1.0` (next engine release, N counter drops) → `v1.1.0-1`.

**Rule of thumb:** if you only touch files under `data/`, bump `-N`. If you touch `js/app.js`, `js/schema.js`, `js/graphs.js`, `css/styles.css`, `index.html`, `sw.js`, or any guide, bump `PATCH` (or higher).

## Style

- Long, descriptive identifiers in the engine (`ring_center_x`, not `x`); no
  single-letter names.
- Vanilla JS/CSS, no frameworks, no build step to *run* the app. The only
  vendored dependency is KaTeX, for offline math.
- No analytics, no tracking, no external calls at runtime.

## Scope

**lernkarto** is the generic, content-agnostic engine; subject-specific content
(decks + branding) rides on it as a separate concern. Keep that split in mind:
engine improvements (new card types, study modes, i18n, the loader) belong in the
engine and should avoid hard-coding domain specifics; domain content goes in decks.
If a change blurs the line, mention it in the PR and we'll route it.
