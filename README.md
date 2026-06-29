# lernkarto

**Live:** <https://lernkarto.github.io/>

A self-hostable, offline-capable, LaTeX-aware **flashcard engine** — no account,
no tracking, no build step to run it. Bring your own **decks** and **topics**;
the header brand adapts to whatever content is loaded.

> **lernkarto** is the (generic) engine — *recto/verso* is the front and back of
> a leaf, i.e. the two sides of a flashcard. The decks shipped in this repo are a
> **quantitative risk-management** curriculum (foundations through Basel, quant
> methods, stress testing) that uses **"Quantile"** as its example brand via deck metadata —
> swap or remove that content without touching the engine (see
> [Branding](#branding) and [Renaming](#renaming)).

---

## Run it

It's static files. Decks load over HTTP(S), so use one of:

- **Local server** (any will do):
  ```bash
  cd <repo>
  python3 -m http.server 8000      # then open http://localhost:8000
  ```
- **GitHub Pages** — see [Deploy](#deploy-to-github-pages).
- **Offline single file** — open `dist/lernkarto-offline.html` directly; no
  server, no network (see [Offline](#offline-use)).
- **Install as an app (PWA)** — when served over http(s), the app ships a web
  manifest + service worker, so a browser's *Install* / *Add to Home Screen* puts
  it on your phone or desktop and it works fully offline after the first load
  (`manifest.webmanifest`, `sw.js`, `icon.svg`). Bump `CACHE` in `sw.js` to ship a
  new shell.

Opening `index.html` straight off disk (`file://`) won't load the shipped decks,
because browsers block `fetch()` on `file://`. Use a server, the offline build,
or the in-app **import** to load a pasted deck.

---

## Decks, topics and the manifest

Three file types, all plain JSON (authorable in TOML — see below).

### A deck

```json
{
  "id": "market-risk",
  "name": "Market risk",
  "color": "#00e0d0",
  "description": "Loss from moving prices.",
  "cards": [
    {
      "term": "Value at Risk",
      "sub": "VaR",
      "definition": "The α-quantile of the loss distribution.",
      "formula": "$\\mathrm{VaR}_\\alpha(L) = \\inf\\{l : P(L > l) \\le 1-\\alpha\\}$",
      "note": "Not coherent — fails subadditivity in general.",
      "category": "measures"
    }
  ]
}
```

**Required:** `name`, and each card's `term` + `definition`.
**Optional, deck-level:** `id` (defaults from name), `description`,
`color` (the deck's accent — used for the card rail and uncategorised labels),
`topic` (a group label; legacy alias `set`), and `categories` (see below).
**Optional, per card:** `sub` (a subtitle/abbreviation), `formula` (shown in a
monospace block; put LaTeX here), `note` (a one-line caveat), `category` (a key
into `categories`).

**Field aliases** (so existing decks drop in): `front` → `term`;
`back`/`answer` → `definition`; `subtitle` → `sub`; `example` → `formula`;
`hint` → `note`.

**Categories** are optional sub-sections within a deck. Omit them and every card
uses the deck `color`; include them for in-deck filter chips:

```json
"categories": {
  "measures":      { "label": "Measures",      "color": "#00ff88" },
  "methods":       { "label": "Methods",       "color": "#00e0d0" },
  "sensitivities": { "label": "Sensitivities", "color": "#ffcc55" }
}
```

Any category referenced by a card but not defined here gets an auto-assigned
colour. (This curriculum keeps most decks single-themed and relies on the
**topic → deck** split for navigation.)

### A topic (a collection of decks)

A **topic** is one file that lists many decks and carries its own primer. It does **not**
declare a subject — subjects own topics (see below), so the same topic can be reused by
several subjects (e.g. *Time series* under both Quantitative methods and Risk management):

```json
{
  "topic": "Banking Risk — Full Curriculum",
  "id": "banking-risk-full",
  "description": "339 concepts across fourteen decks.",
  "author": "you",
  "deckFiles": ["foundations.json", "market-risk.json", "credit-risk.json"]
}
```

- `deckFiles` — filenames resolved relative to `data/decks/` and fetched at load; **or**
- `decks` — whole deck objects inlined (required if you want to *import* a topic by
  paste, since pasted `deckFiles` can't be fetched).

Decks inherit the topic's name as their group label unless they declare their own
`topic` (the old key `set` is still accepted as an alias).

### The manifest

`data/manifest.json` lists the topics to load on startup:

```json
{ "topics": ["banking-risk-full.json"] }
```

Add more topic files to the array to ship multiple curricula; the picker shows each
topic as its own group. (The legacy key `"sets"` is still read as a fallback.)

### Subjects and courses

Two optional registries sit alongside the manifest:

- **`data/subjects/<name>.json`** — first-class **subjects** that own their topics. Each file has
  `name`, `primerTitle`, `primer`, `description`, and `topics: [...]` listing the topic *names*
  the subject groups (the same topic may appear under several subjects — that's reuse).
  The subject's primer distils what its topics cover and is shown in its "study all" view.
  Topic files themselves don't name a subject. (Private/imported topics may still declare a
  `subject` field; that's read as a back-compat fallback.)
- **`data/courses/<id>.json`** — authored **courses**: each file is a single
  `{ id, name, subject?, standard?, items: [{type, ref}] }` object, where each item references a
  `"deck"` (by id), `"topic"`, or `"subject"` (by name). A course is an *ordered playlist*
  expanded to its decks in sequence and gated in order — a cross-cutting container, not a
  containment level (see the [content guides](docs/guides/)).
  Users build their own the same way in the **build a course** tool (stored locally).

---

## LaTeX

Any text field may contain math, rendered by [KaTeX](https://katex.org)
(vendored under `vendor/katex/`, so it works **offline**). Delimiters:

- `$ … $` inline, `$$ … $$` display
- `\( … \)` inline, `\[ … \]` display

In **JSON** every backslash must be doubled — `"$\\alpha$"`, `"$\\frac{a}{b}$"`.
That doubling is the most common authoring slip; if math renders as raw text,
check for single backslashes first.

---

## Authoring in TOML (optional)

JSON is the runtime format. TOML is offered only as an authoring convenience, and
its real payoff is **literal strings** (single quotes), where backslashes are
*not* escapes — so LaTeX is written exactly as it appears:

```toml
# authoring/example-deck.toml
name = "Example deck (TOML)"
id   = "example-toml"
color = "#00ff88"

[[cards]]
term = "Value at Risk"
definition = "The α-quantile of the loss distribution."
formula = '$\mathrm{VaR}_\alpha(L) = \inf\{l : P(L>l) \le 1-\alpha\}$'   # no \\ doubling
```

Convert to the JSON the app loads:

```bash
python3 tools/toml-to-json.py authoring/example-deck.toml data/decks/example-toml.json
python3 tools/toml-to-json.py authoring/banking-risk-full.toml data/topics/banking-risk-full.json
```

Topics convert the same way. The converter only translates the format — it doesn't
validate the schema. Requires Python 3.11+ (`tomllib` is standard library).

---

## Offline use

`tools/build-standalone.py` bundles **everything** — engine, styles, the fully
resolved deck collection, and KaTeX (JS + CSS with fonts base64-embedded) — into one
self-contained file:

```bash
python3 tools/build-standalone.py        # -> dist/lernkarto-offline.html (~1.0 MB)
```

Open it, email it, or put it on a USB stick: no server, no install, no network.
This is the dedicated offline mode. The app also ships as an installable,
auto-caching **PWA** (see *Run it* above) — `manifest.webmanifest` + `sw.js`.

---

## Study features

Four tabs: **study** (drill the decks), **review** (decks with spaced repetition on
and how many cards are due now — jump straight in), **library** (browse decks grouped
by **subject › topic**), and **build a deck** (author cards in a form — see
[Building a deck](#building-a-deck)).

**Subject › topic › deck.** Decks are grouped by **topic** (a topic file's `topic` name) under
a **subject** (a topic file's optional `subject`). A deck can belong to **several topics**
(reuse) — e.g. a "basic logic" deck under both *Physics* and *Programming* — and it
shows under each, sharing one progress record (progress is keyed per card, per deck).

**Session bundle.** In the library, **⤓ save session** downloads your whole session
— imported decks + progress + per-deck settings (SR/shuffle/direction) — as one
`lernkarto-session.json`; **load session** restores it on another device or build.
(A **pack** is one topic's decks; a **bundle/session** is your whole working state.)

3-D flip · prev/next · mark **got it** / **still learning** (keys `1` / `2`) ·
**focus: still learning** filter + in-deck category chips in the bottom bar ·
per-deck progress bar · topic-grouped deck switcher · import/export. Progress
persists per deck.

**⚙ settings** is a dedicated page (gear in the top bar) for per-deck, on-device
preferences — **spaced repetition**, **shuffle** order, **ask direction** — kept
out of the filter bar to avoid clutter. SR is per-deck and feeds the **review**
tab; once you've used SR, opening an undecided deck offers to add it. Long cards
(e.g. open-ended) scroll within the card.

**Answers lead with a one-liner.** The reveal shows a concept summary first, with
a **more ›** toggle for the full explanation, formula and sources. Author the
summary explicitly with a `summary` field, or it's taken from the first sentence.

**Interactive card types.** Beyond the plain flip card, a card can be:

| Type | Authoring | How it grades |
|------|-----------|---------------|
| **Multiple choice** | `choices` + `answer` (index/letter), or the text form `sub`/`"Correct: X)"` | pick one → right/wrong |
| **True / False** | `type:"truefalse"` + `answer:true|false` | press `T` / `F` |
| **Multi-select** | `type:"multi"` + `choices` + `answers:[…]` | pick the exact set, then **check** |
| **Cloze** | wrap the hidden term as `{{answer}}` in the question | type it in, **enter** to check |

Picking/typing reveals the explanation and **auto-grades** — correct → *got it*
(green pulse), wrong → *still learning* (red shake) — and you can override with
the mark buttons.

**Spaced repetition.** Toggle **⟳ spaced repetition** to switch from linear
browsing to an SM-2-style schedule: each grade (manual or auto from an answer)
sets the next review — a correct card moves out by days, a wrong one returns
within the session. The deck then shows only what's due, most-overdue first.

**Images.** A card may carry an `image` (shown on the question side) and/or an
`answerImage` (shown with the answer) — a URL, a relative path, or a `data:` URI
(use a data URI to stay offline-safe). They render on flip and interactive cards.

**Name ↔ description.** In **⚙ settings**, *ask direction* sets how flip cards are
asked: `deck default` (the deck's own `direction`), `name → desc`, `desc → name`
(shown the description, recall the name), or `shuffle`. It's per deck, and **a card
can pin its own** `direction` (which wins over the deck/ask setting).

**Shuffle.** A **shuffle** toggle in **⚙ settings** (or the `s` key) randomises card
order; it persists per deck.

**Progress (your "memory").** Marks and the spaced-repetition schedule persist
per deck in the browser (`localStorage`, with the host's `window.storage` used
too when available). **save progress** (footer) downloads it all as one
`lernkarto-progress.json`; **load progress** restores it — so you can back it up
or carry your right/wrong history to another device or the offline build.

Keyboard: `← →` move · `space` flip · `1`–`9`/`A`–`D` pick · `T`/`F` true-false ·
`1`/`2` mark (once answered) · `s` shuffle.

## Building a deck

**From Wikipedia (v0).** In the build tab, paste a Wikipedia article URL/title and
**from Wikipedia** drafts a deck from the article summary with **CC BY-SA 4.0
attribution auto-filled** (`source`, `license`, `attribution` deck fields, shown
under the deck title). It's a starter draft — an in-app LLM step to generate the
full deck (and infer deck/topic/subject level) is planned (see ROADMAP).

The **build a deck** tab is a form that emits a deck in the system JSON format. Set
a deck name, **+ add card**, choose each card's type (the fields adapt), and watch
the JSON build live on the right. **open .json** loads an existing deck back into
the form to edit it (the round-trip is lossless — types are re-detected). Then
**load into study** (adds it as an imported deck right away) or **download .json**
/ **copy** to save it under `data/decks/` and add it to a topic. No hand-editing of JSON.

## Library & packs

The **library** tab lists every loaded deck grouped by topic. Each topic has a
**⤓ pack** button that downloads the whole topic — all its decks inlined — as one
self-contained `*.pack.json`. Importing that file (header **+ import**) loads
every deck in the topic at once, grouped under the topic name. So a pack is just a
topic with its `decks` inlined: portable, shareable, and re-importable as a unit.

(The term **bundle** is reserved for a full *user session* — decks, topics,
subjects and answer history together — see [ROADMAP.md](docs/ROADMAP.md).)

## Private decks (local-only overlay)

Confidential or personal decks can live in a **`private/` folder that the main
repo git-ignores** (kept as a separate repo). On startup the app fetches
`private/manifest.json` *if present* and loads those topics/decks (grouped under
their topic name); on the public deploy the folder is absent, so the fetch 404s and
is silently skipped. The **default offline build *includes* the private overlay**
(it's your personal full build); pass `--public` for a clean, shareable build with
no private decks: `python3 tools/build-standalone.py --public`. See
[`private/README.md`](private/README.md) (local only).

## Branding

The engine is content-agnostic and ships a neutral default brand (**recto**). The
loaded content sets the header identity via a `brand` object —
`{ name, tagline, accent, mark }` (`mark` is inline SVG) — read from
`data/manifest.json` (app-wide), a topic, or a deck, in that order of specificity.
The shipped `data/manifest.json` carries a sample brand (gaussian-VaR mark and
green accent); swap it to rebrand without touching the engine. For safety, a raw
SVG `mark` is only honoured from shipped content, never from an imported deck.

See [ROADMAP.md](docs/ROADMAP.md) for post-launch ideas (community ratings, reviews,
a standard-topics catalog).

---

## Deploy to GitHub Pages

```bash
git init && git add . && git commit -m "Initial commit"
# create the repo on GitHub, then:
git remote add origin git@github.com:your-org/<repo>.git
git push -u origin main
```

A GitHub Actions workflow is included at
[`.github/workflows/pages.yml`](.github/workflows/pages.yml): set **Settings →
Pages → Source: GitHub Actions** and every push to `main` deploys automatically
(no build step — it serves the static files as-is). Alternatively, **Deploy from a
branch → `main` / `root`** works too. The app is served at
`https://your-org.github.io/<repo>/`, where the shipped sets load over HTTPS.

**Visibility:** on a free plan, Pages only publishes from a **public** repo
(private Pages needs GitHub Pro). To keep the repo private but still host it, use
Cloudflare Pages / Netlify / Vercel.

---

## Renaming

The name lives in a few obvious places: `<title>` and `.brand-name` in
`index.html`, the `PREFIX` constant and `document.title` strings in `js/app.js`, `js/schema.js` and `js/graphs.js`,
the offline output filename in `tools/build-standalone.py`, and this README.
Changing `PREFIX` resets saved progress (it namespaces storage keys), so pick the
name before people start studying.

---

## Project layout

```
lernkarto/
├── index.html                  # shell: palette, KaTeX, gaussian mark, picker
├── css/styles.css              # terminal palette (#0d0d0d / #00ff88 / Courier New)
├── js/schema.js                # shared constants, helpers and deck-parsing functions
├── js/graphs.js                # GRAPH_RECIPES + buildGraph (interactive SVG graphs)
├── js/app.js                   # study engine (content-agnostic; topic, graph + LaTeX aware)
├── sw.js                       # service worker — PWA + offline cache
├── vendor/katex/               # vendored KaTeX (MIT) — offline math
├── data/
│   ├── manifest.json           # discovery file: brand + topics + subjects + courses
│   ├── decks/                  # deck JSON files (one deck each)
│   ├── topics/                 # topic JSON files (group decks into named topics)
│   ├── subjects/               # subject JSON files (group topics + primers)
│   └── courses/                # course JSON files (ordered playlists)
├── authoring/                  # optional TOML sources
│   ├── banking-risk-full.toml
│   └── example-deck.toml
├── tools/
│   ├── toml-to-json.py         # TOML -> JSON authoring converter
│   ├── build-catalog.py        # -> catalog.json (metadata index)
│   └── build-standalone.py     # -> dist/lernkarto-offline.html
├── docs/                       # design docs and roadmap
└── dist/lernkarto-offline.html  # generated offline single file
```

## Accuracy note

The deck content aims to be interview-accurate, but definitions are compressed by
design. For anything you'll rely on professionally, confirm against a primary
source (Basel texts, Hull, Jorion). Corrections via pull request are welcome.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Vendored KaTeX is MIT (`vendor/katex/LICENSE`); see [THIRD-PARTY](THIRD-PARTY) for full notices.
