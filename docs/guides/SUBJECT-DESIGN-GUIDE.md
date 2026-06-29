# Subject guide

A subject is a **first-class knowledge domain** — the top level of the content hierarchy. It owns a list of topics, carries its own primer, and is the unit a learner sees as a major area of study in the library.

See [TOPIC-GUIDE.md](TOPIC-GUIDE.md) for how topics work, [DECK-DESIGN-GUIDE.md](DECK-DESIGN-GUIDE.md) for decks, and [COURSE-GUIDE.md](COURSE-GUIDE.md) for ordered playlists that may span subjects.

---

## The model

```
subject  →  topic  →  deck  →  card
```

A subject owns topics by listing their *display names* in a `topics` array. Topics are unaware of which subjects include them — the subject references the topic, not the other way round. The same topic can appear in multiple subjects (reuse without duplication).

A subject file is a standalone JSON at `data/subjects/<slug>.json`. It is not a container file that embeds topic data — it is a metadata record (name, primer, description, topic list) that the app cross-references against the loaded topics.

---

## File format

```json
{
  "name": "Risk management",
  "primerTitle": "Risk management — what this subject covers",
  "description": "Banking risk: market, credit, operational, liquidity and the Basel framework.",
  "primer": "## Risk management\nA high-level orientation paragraph. What this subject covers, why it matters, and how the topics fit together.",
  "topics": [
    "Risk foundations",
    "Financial risk management",
    "Market risk",
    "Credit risk",
    "Liquidity risk",
    "Operational risk",
    "Basel framework"
  ]
}
```

**Required:** `name` and `topics`.

**Fields:**

| Field | Purpose |
|---|---|
| `name` | Display name and cross-reference key. Topics are matched to subjects by this string — never change it once topics list it, and it must be unique across subjects. |
| `primerTitle` | Heading for the subject primer panel. |
| `primer` | Markdown orientation text shown in the subject's "study all" view. Distils what the subject covers — not a repetition of the topic primers. |
| `description` | One-line subtitle shown in the library. |
| `topics` | Array of topic display names (`topic` field in topic files), in the order they appear in the subject's study view. |

**The `name` field is the cross-reference key.** Courses reference subjects by this string (`{"type": "subject", "ref": "Risk management"}`). It must be unique across all subjects in the manifest.

---

## Step by step

1. **Create the file** at `data/subjects/<slug>.json`. The filename slug is a lowercase-hyphenated version of the name (e.g. `Risk management` → `risk-management.json`).

2. **Set `name` carefully.** This string is the lookup key used by the app, by courses, and by the `topicSubjects` cross-reference. Changing it later requires updating every course that references it.

3. **List `topics`** in study order. Each entry must exactly match the `topic` field in a topic file (case-sensitive). Topics not loaded by the manifest (missing from `manifest.topics`) will silently not appear — ensure they are registered.

4. **Write a primer.** A subject primer frames the domain at a high level — what it covers, what the learner will be able to do, and how the topics connect. It is shown in the subject's overview panel, not before individual decks.

5. **Register the subject in `data/manifest.json`:**
   ```json
   {
     "subjects": ["risk-management.json", "your-new-subject.json", ...]
   }
   ```
   Subjects not in the manifest are not loaded by the app.

6. **Validate:**
   ```bash
   python3 -m json.tool data/subjects/your-subject.json > /dev/null && echo OK
   node tests/run.js   # checks manifest consistency + name field present
   ```

---

## Conventions

**Filename slug:**
- Derive from `name`: lowercase, spaces → hyphens, drop punctuation.
- `"Risk management"` → `risk-management.json`
- `"C++"` → `cpp.json` (avoid `+` in filenames)
- `"Codes & symbols"` → `codes-symbols.json`

**Topic list order:**
- Put foundational topics first. A learner who studies the subject "in order" should encounter prerequisites before advanced topics.
- Topics listed in a subject do not need to be *exclusive* to that subject — reuse across subjects is intentional.

**Subject primer scope:**
- One to three paragraphs: what is this field, what sub-areas does this subject cover, who benefits from studying it?
- Do not inline topic primers or deck primers. The subject primer orients; topic and deck primers teach.

**When to create a new subject vs add to an existing one:**
- Create a new subject when the domain warrants its own top-level shelf — a distinct discipline a learner might pick as their primary study area.
- Add a topic to an existing subject when the topic's content falls naturally under an existing domain.
- A topic can appear in more than one subject. Cross-listing is not a problem — it is encouraged when the topic genuinely belongs to both.

---

## Example: a complete subject file

```json
{
  "name": "Quantitative methods",
  "primerTitle": "Quantitative methods — what this subject covers",
  "description": "Probability, statistics, and the mathematical toolkit used across finance and science.",
  "primer": "## Quantitative methods\nThe mathematical foundations shared across finance, science, and engineering. Covers probability theory (distributions, moments, convergence), statistics (estimation, inference, regression), and the key tools (time series, linear algebra, numerical methods) that appear throughout the more specialized subjects.",
  "topics": [
    "Probability foundations",
    "Probability distributions",
    "Statistical inference",
    "Linear algebra essentials",
    "Time series"
  ]
}
```

---

## Quality bar

A subject is ready to publish when:

- Every name in `topics` matches a `topic` field in a loaded topic file (the manifest consistency test checks this indirectly via the topic files).
- The primer frames the subject's scope clearly enough that a first-time learner can decide whether to study it.
- Topics are ordered from foundational to advanced.
- The `name` is unique across all subjects in `data/manifest.json`.
- `node tests/run.js` is green.
