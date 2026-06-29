# Topic guide

A topic is a **named collection of decks** — the unit you study in one sitting. It groups related decks, carries its own primer, and appears as a row in the library or as a step in a course. Topics are unaware of the subjects that contain them.

See [DECK-DESIGN-GUIDE.md](DECK-DESIGN-GUIDE.md) for the deck format, [SUBJECT-GUIDE.md](SUBJECT-GUIDE.md) for how subjects bundle topics, and [COURSE-GUIDE.md](COURSE-GUIDE.md) for ordered playlists across topics.

---

## The model

```
subject  →  topic  →  deck  →  card
```

A topic owns `deckFiles` (filenames resolved from `data/decks/`) and optionally inline `decks`. The same deck can appear in multiple topics — it is referenced, not copied. Progress follows the deck, not the topic: completing a deck in one topic marks it complete everywhere it appears.

Topics are listed by name in subjects (`topics: ["Risk foundations", ...]`). A subject discovers topics by matching that name to the `topic` field of a loaded topic file.

---

## File format

```json
{
  "topic": "Risk foundations",
  "id": "risk-foundations",
  "standard": true,
  "primerTitle": "Risk foundations",
  "primer": "## Risk foundations\nOne-pager of what this topic covers — the shared language a learner needs before drilling the decks.",
  "description": "The shared language and governance of risk.",
  "deckFiles": [
    "risk-glossary-foundations.json",
    "foundations.json"
  ]
}
```

**Required:** `topic` (display name) and at least one of `deckFiles` or `decks`.

**Fields:**

| Field | Purpose |
|---|---|
| `topic` | Display name. Subjects reference topics by this string — never change it once a subject lists it. |
| `id` | Stable slug used in URLs and progress keys. Defaults from `topic` if omitted. |
| `standard` | `true` — include this topic in the public standard library (used by `build-standalone.py --standard`). |
| `primerTitle` | Heading for the topic primer panel. |
| `primer` | Markdown orientation one-pager shown before "study all" for this topic. Distils the topic's scope, not the deck primers — those live on decks. |
| `description` | One-line subtitle shown in the library. |
| `deckFiles` | Array of filenames in `data/decks/`. Order = study order when the topic is used in a gated course. |
| `decks` | Array of inline deck objects (same schema as a deck JSON file). Use for tiny decks that don't deserve their own file. |
| `tags` | Inherited by all decks in the topic; also filterable in the library. |
| `direction` | Topic-level default direction (`"forward"` / `"reverse"` / `"shuffle"`) inherited by decks that don't set their own. |

**`deckFiles` vs inline `decks`:** prefer `deckFiles` — separate files are individually reusable and simpler to diff. Use inline `decks` only for throwaway or example content.

---

## Step by step

1. **Create the file** at `data/topics/<id>.json`. The filename slug should match the `id` field (e.g. `risk-foundations.json` → `"id": "risk-foundations"`).

2. **Set the `topic` name.** This is the string subjects use to list this topic — pick it carefully; renaming later requires updating every subject file that references it.

3. **List `deckFiles`.** Add the filenames of decks in study order. Every file must already exist in `data/decks/`. Validate with `node tests/run.js` (manifest consistency checks whether every referenced deck file exists).

4. **Write a primer** (optional but recommended for topics with 3+ decks). The topic primer is a high-level orientation — one paragraph to a page — not a substitute for deck primers. Deck primers cover their own cards; the topic primer frames the whole set.

5. **Register the topic in `data/manifest.json`:**
   ```json
   {
     "topics": ["risk-foundations.json", "your-new-topic.json", ...]
   }
   ```
   Topics not in the manifest are not loaded by the app.

6. **Add the topic to a subject** (optional). Open `data/subjects/<subject>.json` and add the `topic` name to its `topics` array. The app cross-references by matching strings.

7. **Validate:**
   ```bash
   python3 -m json.tool data/topics/your-topic.json > /dev/null && echo OK
   node tests/run.js   # checks manifest consistency + no orphan decks
   ```

---

## Conventions

**When to create a new topic vs extend an existing one:**
- Create a new topic when the content is a distinct *study unit* — something you'd study in one sitting without also studying the surrounding context.
- Extend an existing topic (add a deck) when the content is a natural sub-chapter of the topic's existing scope.

**Naming:**
- Title-case display name: `"Risk foundations"`, not `"risk foundations"` or `"RISK FOUNDATIONS"`.
- Lowercase hyphenated `id`: `risk-foundations`.
- The `id` is a progress key — once cards in the topic's decks are studied, changing the `id` breaks nothing (progress is deck-keyed), but changing the `topic` name breaks subject membership.

**`standard: true`:**
- Set it when the topic ships in the public library. Leave it off for in-progress or private topics. The build script uses it to filter what goes into the offline standalone file.

**Topic primer scope:**
- Write for the learner arriving at the topic for the first time: what does this topic cover, why does it matter, what's the sequence?
- Do not reproduce deck-level primers here — the topic primer orients; the deck primers teach.
- You can embed an **interactive graph** anywhere in the primer markdown with a `graph` fence (same spec as `card.graph`). See [DECK-DESIGN-GUIDE.md §5](DECK-DESIGN-GUIDE.md#5-interactive-graphs) for the fence syntax and available recipes.

---

## Example: a complete minimal topic file

```json
{
  "topic": "Linear algebra essentials",
  "id": "linear-algebra",
  "standard": true,
  "primerTitle": "Linear algebra essentials",
  "primer": "## Linear algebra essentials\nVectors, matrices, and the key decompositions (eigenvalues, SVD) used across quantitative finance and ML. Three decks: core operations → properties → applications.",
  "description": "Vectors, matrices, eigenvalues, and SVD.",
  "deckFiles": [
    "linalg-core.json",
    "linalg-properties.json",
    "linalg-applications.json"
  ]
}
```

---

## Quality bar

A topic is ready to publish when:

- Every `deckFile` exists and passes JSON validation.
- The primer (if present) frames the scope — a learner can read it and know what the topic covers and why.
- Deck order in `deckFiles` reflects the intended learning sequence (foundational first).
- `standard: true` is set only if every deck in the topic meets the [deck design standard](DECK-DESIGN-GUIDE.md).
- `node tests/run.js` is green.
