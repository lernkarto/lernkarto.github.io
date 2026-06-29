# Deck design guide

A deck is the **atom of knowledge** — a self-contained set of cards on one thing. This guide covers the file format, how to create and register a deck, and the quality bar every deck must meet.

See [TOPIC-GUIDE.md](TOPIC-GUIDE.md), [SUBJECT-GUIDE.md](SUBJECT-GUIDE.md), and [COURSE-GUIDE.md](COURSE-GUIDE.md) for the containers that bundle decks.

---

## File format

```json
{
  "id": "market-risk",
  "name": "Market risk",
  "color": "#00e0d0",
  "description": "Loss from moving prices — VaR, ES, sensitivities, FRTB.",
  "primer": "## Market risk\nOne-pager of notions needed to pass the deck...",
  "primerTitle": "Market risk — what this deck covers",
  "tags": ["risk", "quant"],
  "cards": [
    {
      "term": "Value at Risk",
      "sub": "VaR",
      "definition": "The α-quantile of the loss distribution — the loss not exceeded with probability α.",
      "formula": "$\\mathrm{VaR}_\\alpha(L) = \\inf\\{l : P(L > l) \\le 1-\\alpha\\}$",
      "note": "Not coherent — fails subadditivity for non-elliptical distributions.",
      "category": "measures"
    }
  ],
  "categories": {
    "measures": { "label": "Measures", "color": "#00e0d0" },
    "methods":  { "label": "Methods",  "color": "#ffd166" }
  }
}
```

**Required:** `name`, and each card's `term` + `definition`.

**Deck-level optional fields:**

| Field | Purpose |
|---|---|
| `id` | Stable identifier (defaults from `name` if omitted). Used as the progress key — never change after cards are studied. |
| `color` | Accent color for the card rail and category labels. |
| `description` | One-line subtitle shown in the library. |
| `primer` | Markdown one-pager shown before studying. See §3. |
| `primerTitle` | Heading for the primer panel. |
| `tags` | Lowercase strings for search/filter. |
| `categories` | In-deck sections. Keys match card `category` values. |
| `direction` | `"forward"` / `"reverse"` / `"shuffle"` — default ask direction. |
| `dual` | `true` — double every card into a forward and a reverse card. |

**Per-card optional fields:**

| Field | Purpose |
|---|---|
| `sub` | Abbreviation or subtitle shown below the term. |
| `formula` | Shown in a monospace block. Put LaTeX here. |
| `note` | One-line citation or memory hook, shown at the very bottom of the answer (below any graph). |
| `category` | Key into `categories`. |
| `summary` | First sentence of the answer (auto-extracted if omitted). |
| `image` / `answerImage` | URL, relative path, or `data:` URI. |
| `direction` | Per-card override of the deck's direction. |
| `frontGraph` | Interactive graph shown on the card **front** (the question), above the "tap to reveal" hint. See §5. |
| `graph` | Interactive graph shown on the card **back** (the answer), above `note`. See §5. |

**Field aliases** (so existing decks drop in): `front`→`term`, `back`/`answer`→`definition`, `subtitle`→`sub`, `example`→`formula`, `hint`→`note`.

**LaTeX:** every backslash must be doubled in JSON — `"$\\mathrm{VaR}$"`. Use TOML literal strings (single quotes) to avoid this; see [Authoring in TOML](#authoring-in-toml).

---

## Card types

Beyond the default flip card, a card declares its type with a `type` field (or via `sub`/`definition` conventions):

| Type | How to author | How it grades |
|---|---|---|
| **flip** *(default)* | No `type`. | User self-marks got-it / still-learning. |
| **mcq** | `choices: ["A","B","C","D"]` + `answer: 0` (index). Or `sub: "A) … B) … C) …"` + `definition: "Correct: B) …"`. | Pick one → auto right/wrong. |
| **truefalse** | `type: "truefalse"`, `answer: true\|false`. | Press T/F → auto right/wrong. |
| **cloze** | `type: "cloze"`, wrap the hidden term as `{{answer}}` in `term`. | Type it in → auto check. |
| **multi** | `type: "multi"`, `choices: [...]`, `answers: [0, 2]`. | Pick the exact set → auto check. |

---

## Step by step

1. **Create the file** at `data/decks/<id>.json`. Use a lowercase hyphenated `id` that matches the filename (e.g. `market-risk.json` → `"id": "market-risk"`).

2. **Write the primer first** (if the deck is standalone or formula-heavy). The primer is the one-pager a learner reads before drilling — write it before the cards so the comprehension contract (§3) is checkable.

3. **Write cards across the three lenses** (§1): definitions, theorems/properties, use cases, and 1–2 exercises per deck.

4. **Register the deck in a topic.** Add the filename to a topic's `deckFiles` array in `data/topics/<topic>.json`. The deck is not visible in the app until it's referenced by a topic.

5. **Validate:**
   ```bash
   python3 -m json.tool data/decks/your-deck.json > /dev/null && echo OK
   node tests/run.js   # catches orphan decks and manifest drift
   ```

6. **Check LaTeX** by loading the deck in a local server (`python3 -m http.server`). Raw text instead of math = single backslashes in JSON — double them.

**Authoring in TOML (optional):** TOML literal strings (single quotes) keep backslashes literal, which is handy for LaTeX-heavy decks. Write in TOML, convert once, then the JSON in `data/decks/` is the master — edit it going forward:
```bash
python3 tools/toml-to-json.py authoring/decks/market-risk.toml data/decks/market-risk.json
```
The `.toml` scratch file can be kept or deleted — the JSON in `data/` is always authoritative.

---

## 1. Cover three lenses

Every topic should be probed from all three angles, not just definitions:

- **Theoretical** — definitions, properties, and the related theorems that give the concept its backbone.
- **Empirical** — what the data / stylised facts actually show, and when the assumptions hold or break.
- **Practical** — concrete use cases, limitations, and 1–2 short exercises that require *applying* a notion rather than reciting it.

A useful category convention: `core` · `theorems` · `use` · `exercise`.

---

## 2. Use card types deliberately

- **flip** — definitions and "explain X". Use a one-liner `summary` + fuller `definition`.
- **mcq** — discrimination between close concepts. The correct option must not be a tell (not the longest/shortest/odd-one-out).
- **cloze** — a single key term, value, or formula slot.
- **truefalse** — target a specific misconception head-on.
- **multi** — partial-knowledge checks where several options apply.

---

## 3. The comprehension contract

A deck that ships a `primer` must satisfy:

> **Every card's answer must be either stated in the primer, or a short derivation from notions that are in it.**

This separates understanding from rote recall. If a card can only be answered by recalling a fact the primer never taught, either the card is trivia or the primer is incomplete — fix one.

**Workflow:** write the primer → write cards answerable from it → **audit coverage**: classify each card's answer as DIRECT (in the primer), DERIVED (one step from it), or GAP — then close every GAP by adding the missing notion to the primer or cutting the card.

---

## 5. Interactive graphs

Graphs can live in three places — pick the one that matches the pedagogical intent:

| Location | Field / syntax | When to use |
|---|---|---|
| **Primer** | `` ```graph `` fence in `primer` markdown | Tutorial/exploratory — learner drags sliders to build intuition before drilling. Preferred for "feel how σ changes the bell." |
| **Card front** | `card.frontGraph` | The graph *is* the question — learner reads the graph and must identify something. |
| **Card back** | `card.graph` | Illustrates or reinforces the answer after reveal. |

Both `frontGraph` and `graph` use the same spec object.

**Card-back graph** (answer illustration):

```json
{
  "term": "How does σ change the normal bell?",
  "definition": "Larger σ widens and flattens the bell; smaller σ tightens and raises it.",
  "formula": "$f(x)=\\dfrac{1}{\\sigma\\sqrt{2\\pi}}e^{-(x-\\mu)^2/2\\sigma^2}$",
  "note": "[1] Normal distribution (Wikipedia) — https://en.wikipedia.org/wiki/Normal_distribution",
  "graph": {
    "type": "normal",
    "params": { "mu": 0, "sigma": 1 },
    "controls": ["mu", "sigma"]
  }
}
```

**Card-front graph** (graph as question):

```json
{
  "term": "The shaded area to the left of x represents which probability?",
  "definition": "P(X ≤ x) — the CDF evaluated at x, i.e. the cumulative area under the density curve.",
  "frontGraph": {
    "type": "normal",
    "params": { "mu": 0, "sigma": 1 },
    "controls": []
  }
}
```

**Graph spec fields:**

| Field | Purpose |
|---|---|
| `type` | Built-in recipe name. Supported: `"normal"`, `"poisson"`, `"normal-within"`, `"normal-cdf"`, `"normal-hypothesis"`. |
| `params` | Starting parameter values. Defaults per recipe if omitted. |
| `controls` | Which parameters get a slider. Empty array `[]` → static graph, no sliders. |
| `ranges` | Optional override per parameter: `{"sigma": [0.1, 5, 0.1]}` (min, max, step). |

The back graph is rendered **above `note`** so citations always stay at the bottom of the answer. The front graph appears **above the "tap to reveal" hint**.

**Graphs in primers:** to add an interactive graph inside a deck or topic primer, use a fenced `graph` block in the primer markdown:

````markdown
## What σ controls

A larger σ spreads the bell; smaller σ concentrates it.

```graph
{"type":"normal","params":{"mu":0,"sigma":1},"controls":["mu","sigma"]}
```

Try dragging the slider — watch the bell flatten as σ grows.
````

The JSON in the fence is the same graph spec as `card.graph`. The block can appear anywhere in the primer markdown; the surrounding text acts as the prompt.

**Adding a new recipe:** add an entry to `GRAPH_RECIPES` in `js/graphs.js` (before `buildGraph`). Each recipe needs `defaults` (parameter defaults), `controls` (default slider list), `ranges` (per-param `[min, max, step]`), and a `render(svg, params)` function that draws into the passed SVG element.

---

## 6. Attribution

Decks distilled from a source carry `source`, `license`, and `attribution` fields (e.g. Wikipedia → `CC BY-SA 4.0`). Keep them accurate to the language and article you worked from.

---

## For the Wikipedia distillator (LLM)

When generating a deck from an article, the model must:

1. Write the **primer** first — the one-pager of notions needed to pass the deck.
2. Generate cards across the **three lenses**, including related theorems and 1–2 exercises.
3. **Self-audit the comprehension contract**: every card's answer must trace to the primer (DIRECT or DERIVED); patch the primer for any GAP before emitting.
4. Apply the MCQ anti-tell rules and carry correct CC BY-SA attribution.

See the [ROADMAP](../ROADMAP.md) distillator section for the surrounding pipeline.

---

## Model reference

The full hierarchy — deck · categories · topic · subject · course — is documented at the top of this file's parent: see [TOPIC-GUIDE.md](TOPIC-GUIDE.md) §0 for the one-paragraph model summary. The key rules:

- Primers don't inherit. Each entity has only its own.
- Everything is referenced, not copied. Progress is shared across all contexts where a deck appears.
- A course is a view, not a copy. Reordering a course never resets deck progress.
