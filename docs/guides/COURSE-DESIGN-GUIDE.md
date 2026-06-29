# Course guide

A course is an **ordered playlist across decks, topics, or subjects** — a curated sequence that gates content in a specific order. It is not a containment level: it owns no cards and no progress of its own.

See [DECK-DESIGN-GUIDE.md](DECK-DESIGN-GUIDE.md), [TOPIC-GUIDE.md](TOPIC-GUIDE.md), and [SUBJECT-GUIDE.md](SUBJECT-GUIDE.md) for the entities a course references.

---

## The model

A course holds an ordered list of **items**, each a typed reference to a deck, topic, or subject. The engine *expands* each item to its constituent decks (deduped, preserving sequence):

- `{"type": "deck", "ref": "market-risk"}` → that one deck
- `{"type": "topic", "ref": "Market risk"}` → all decks in that topic, in their `deckFiles` order
- `{"type": "subject", "ref": "Risk management"}` → all decks across all topics of that subject

**De-duplication rule:** each deck appears **once**, at its **most-specific** placement:
- An explicit `deck` reference beats the same deck reached via a `topic` reference, which beats one reached via a `subject`.
- Within the same specificity, the earliest reference wins.
- This means you can put a deck up front as an item and also include the subject that contains it — the deck stays at the front and is dropped from the subject's expansion.

**Two study modes:**
- **Interleaved shuffle:** cards from all expanded decks, shuffled together.
- **Gated sequential:** decks unlock one at a time, in order; the next deck unlocks when the current one reaches the pass threshold.

Courses come in two flavours with the same JSON shape:
- **Authored** — shipped in `data/courses/<id>.json` (listed in `data/manifest.json`).
- **Custom** — user-built in the *build a course* tool, persisted in `localStorage`. Same schema; not in the repo.

---

## File format

```json
{
  "id": "banking-risk-full",
  "name": "Banking Risk — Full Curriculum",
  "subject": "Risk management",
  "standard": true,
  "description": "The complete banking risk curriculum in study order.",
  "items": [
    { "type": "topic", "ref": "Risk foundations" },
    { "type": "topic", "ref": "Financial risk management" },
    { "type": "topic", "ref": "Market risk" },
    { "type": "deck",  "ref": "credit-counterparty-risk" },
    { "type": "topic", "ref": "Credit risk" }
  ]
}
```

**Required:** `id`, `name`, `items`.

**Fields:**

| Field | Purpose |
|---|---|
| `id` | Stable slug used as progress key and URL segment. Never change once the course is studied. |
| `name` | Display name shown in the library. |
| `subject` | Optional. Name of the primary subject this course belongs to (for grouping in the library). |
| `standard` | `true` — include in the public standard library. |
| `description` | One-line subtitle. |
| `items` | Ordered array of `{type, ref}` references. `type` is `"deck"`, `"topic"`, or `"subject"`. `ref` is the deck `id`, topic `topic` name, or subject `name`. |

**`ref` values:**
- `deck` → the `id` field of a deck JSON file (e.g. `"market-risk"`, not `"market-risk.json"`).
- `topic` → the `topic` field of a topic JSON file (display name, e.g. `"Market risk"`).
- `subject` → the `name` field of a subject JSON file (e.g. `"Risk management"`).

---

## Step by step

1. **Create the file** at `data/courses/<id>.json`. Use a lowercase hyphenated `id` that matches the filename.

2. **Design the sequence.** List items in the order a learner should study them — foundational topics first, advanced topics later. You can mix deck, topic, and subject references freely.

3. **Use the right reference granularity:**
   - Use `"type": "subject"` to include a full domain and let the subject's topic order drive the sequence.
   - Use `"type": "topic"` to include a specific topic's decks without pulling in the whole subject.
   - Use `"type": "deck"` to pin a single deck at a specific point in the sequence — useful for prerequisites you want front-loaded, or to break the default topic order.

4. **Register the course in `data/manifest.json`:**
   ```json
   {
     "courses": ["banking-risk-full.json", "your-new-course.json"]
   }
   ```

5. **Validate:**
   ```bash
   python3 -m json.tool data/courses/your-course.json > /dev/null && echo OK
   node tests/run.js   # checks manifest consistency + id field present
   ```

---

## Conventions

**When to author a course vs just studying a subject:**
- A subject already acts like a course: studying a subject in "study all" mode gives you all its topics in order.
- Author a course when you need a sequence that *crosses* subjects, or when you need a different ordering than the subject's default, or when you want to gate a curated subset of topics rather than a whole subject.

**De-duplication in practice:**
- If a deck appears in two different topics both referenced by the course, the engine keeps it at the first occurrence. You do not need to worry about duplicates — the engine handles them.
- If you want a deck to appear at a specific point *despite* also being reachable via a topic or subject reference, list it explicitly as a `"type": "deck"` item at that position. The explicit reference wins by specificity.

**`standard: true`:**
- Set it only if every deck in the course's expansion meets the [deck design standard](DECK-DESIGN-GUIDE.md). The build script uses this flag.

**Course `id` stability:**
- The `id` is used as the localStorage progress key for custom courses. For authored courses the progress lives on the underlying decks, so renaming an authored course's `id` is less disruptive — but still avoid it once the course is public.

---

## Example: a mixed-reference course

A "quick-start" course that pulls selected topics from two subjects plus one isolated deck:

```json
{
  "id": "quant-finance-primer",
  "name": "Quant Finance — Primer",
  "description": "A focused primer for candidates new to quantitative finance.",
  "items": [
    { "type": "topic",   "ref": "Probability foundations" },
    { "type": "topic",   "ref": "Probability distributions" },
    { "type": "deck",    "ref": "statistics-inference-basics" },
    { "type": "topic",   "ref": "Risk foundations" },
    { "type": "topic",   "ref": "Market risk" }
  ]
}
```

The learner studies probability first, a targeted statistics deck (not the full topic), then the risk foundations and market risk topics.

---

## Quality bar

A course is ready to publish when:

- Every `ref` resolves: deck `id`s exist, topic names match a loaded topic's `topic` field, subject names match a loaded subject's `name`.
- The sequence is intentional — not just a dump of all topics in no particular order.
- `standard: true` is set only if the full expansion meets the deck design standard.
- `node tests/run.js` is green.
