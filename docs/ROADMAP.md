# Roadmap & checklist

Design notes, open questions, and the v1 launch gate. The checklist is at the top (most actionable); design discussion follows.

---

## v1.0.0 Launch checklist

**What v1.0.0 is:** the static, offline-first PWA shipped publicly on GitHub Pages, serving a curated standard library under the neutral **lernkarto** brand. No backend.

**What it is NOT (→ v2, hosted):** live community ratings, moderation queues, reviewer workflow, tipping, accounts, i18n. These need a backend + identity (designed below). At v1 the library is vetted by maintainer curation — the `standard:true` flag + human PR review.

Legend: `[x]` done · `[ ]` to do · `[~]` partial · **(N)** = needs your decision · **(F)** = your fact-check.

### 1. Brand & identity
- [x] Engine de-branded to neutral **lernkarto** (shell, manifest, SW, strings)
- [x] Risk is just a subject ("Risk management"), not the app's identity
- [ ] **(N)** Grab a domain + handles (`lernkarto.io`/`.dev`) — optional for launch
- [ ] Neutral favicon / social preview image (currently the stacked-cards mark)

### 2. Licence & IP  *(blocking — do before the repo is public)*
- [x] Code licence: **AGPL-3.0** — `LICENSE` swapped (protects the commons / anti-SaaS-clone; relicensing after outside contributions would need every contributor's consent).
- [x] `THIRD-PARTY` file added (KaTeX MIT · Wikipedia CC BY-SA 4.0).
- [x] Per-deck `source` / `license` / `attribution` fields (CC BY-SA on Wikipedia-derived decks)
- [x] **DCO** chosen for outside contributions — per-commit sign-off (`git commit -s`), no CLA overhead. Consistent with AGPL-3.0 commons ethos; revisit only if dual-licensing is ever pursued.

### 3. Standard-library curation
- [x] `standard:true` flags on the educational + risk topics; private overlay excluded
- [x] `build-standalone.py --standard` ships only standard topics; `--public` drops the private overlay
- [x] Launch set confirmed: **Risk management** subject ships publicly under lernkarto (flagged `standard:true`).
- [ ] **Launch manifest**: the deployed `data/manifest.json` should list **only** standard topics (dev manifest keeps everything). Either trim at deploy or generate a launch manifest in the build.
- [ ] Sanity-pass every standard deck for the deck-design standard + comprehension contract (primers present — done; spot-check quality)

### 4. Content fact-check  *(owner: maintainer)*
- [ ] **(F)** Fact-pass the big new content before it's "vetted": Risk glossary (174), Financial risk management (44), Time series (7 decks), Normal distribution (53), Physical constants (21), and the core banking-risk decks
- [ ] **(F)** Confirm regulatory figures are current (Basel/CRR3 %, LCR/NSFR, output floor 72.5%, etc.)

### 5. Pre-public security sweep  *(the "pre-public sweep" routine)*
- [x] Pre-public security sweep complete — 3 blockers found and fixed (`.claude/` added to local `.gitignore`; `author = "Celeste"` scrubbed from TOML sources; stale Quantile refs cleaned from README). No secrets, PII, or machine paths in tracked content.
- [x] `private/` overlay removed from the repo; Claude artifacts git-ignored globally
- [x] LICENSE present; `.gitignore` correct
- [ ] **go / no-go** report (technical leaks = blockers; visibility/strategy = your call)

### 6. Deploy (GitHub Pages)
- [x] `.github/workflows/pages.yml` exists (serves `data/` at runtime)
- [ ] Create/confirm the public GitHub repo (org, not personal, per IP plan)
- [ ] Settings → Pages → Source = GitHub Actions; verify the build
- [ ] **(N)** Final confirm before the **public, irreversible** first deploy
- [ ] Smoke-test the live URL (loads over HTTPS, PWA installs, offline works)

### 7. Docs & polish
- [x] README / CONTRIBUTING / guides/ reflect the current model (deck·topic·subject·course, reuse, primers)
- [ ] README: a couple of screenshots / a one-line live link once deployed
- [ ] Quick "what is this" landing blurb for first-time visitors

---

## Data model — agreed, shipped

The reference-based hierarchy is live. Decks are reusable across topics; topics across subjects; any of them in courses. Progress is keyed per-card fingerprint and shared everywhere a deck appears.

Shipped:
- ✅ Schema (`subject`/`topic`/`topics`) + loader with deck reuse + library nav by subject›topic
- ✅ The session bundle (save/load decks + progress + settings)
- ✅ Cross-deck study-a-whole-topic (shuffled virtual deck, per-card fingerprint dedup)
- ✅ Courses (authored + custom playlists; gated + interleaved modes)

Still to do:
- Topic/subject-level SR scope + a unified review queue
- Generic recursive collection model (any depth) — pipelined

**Card-level reuse (pick & match) — next model extension.** Today *decks* are reusable across topics. The user wants the same for *cards*: reference a card from a focused deck (e.g. "Normal distribution") into another (e.g. "Statistics basics") so editing the source updates it everywhere. Design: a card gets a stable id (`deck-id + fingerprint` or `author/slug@uid#fp`); a deck stores `cardRefs` alongside its own `cards`; the loader resolves refs at load. Progress already keys by fingerprint so a referenced card shares history wherever it appears. Handle a missing/changed source (broken ref → fingerprint mismatch → treat as new) and a "detach to local copy" escape hatch. Bigger than deck reuse; do it after the cross-deck study work.

---

## When the app goes live (hosted, multi-user)

These features need a backend + identity and are explicitly deferred to v2:

### Community ratings — three axes (decided)
- **Subject / Topic → coverage.** Rate how well the area is covered overall.
- **Deck → quality.** Rate the craft: good questions, clear explanations, fair distractors.
- **Course → sequence quality.** Rate how well the course flows: order is logical, pacing is right, gaps are covered.
A subject score is **not** a simple average of its deck scores — coverage is its own signal. Store ratings per entity (deck, topic, subject, course); show aggregates in the library.

### Community reviews & contributions
- **Suggest a correction** to a card (typo, wrong answer, outdated figure).
- **Add a card** to an existing topic/deck.
- **Review/comment** on a deck.
Think "pull request for a flashcard" — a lightweight diff queue the deck owner accepts. The existing build-a-deck editor already encodes cards in the system format.

### Moderation of standard decks
Community suggestions/edits to a standard deck enter a queue and a moderator approves before they land (Wikipedia-style). User-imported decks stay unmoderated.

### Creator tipping
If pursued: gate tipping on quality (only original, well-rated, moderated decks), make it opt-in appreciation (not pay-per-card), route the platform cut to moderation + infra, keep the base app free. Never the primary incentive driver.

### Standard-topics library
The library tab becomes a catalog of curated "standard" decks users can browse and load on demand, with ratings/reviews/moderation attached.

---

## Vision: open-source, free, donation-funded

**Open-source suite of free study utilities, funded by donations (Wikipedia-style) — no ads, no paywall.**

### Intellectual property & licensing

> Not legal advice — confirm with an IP lawyer before any registration. Guiding principle: **open the code, own the brand, keep content clean.**

**1. Code license.** The repo ships **AGPL-3.0** (`LICENSE`) — chosen for network-use copyleft (anyone running a modified version as a hosted service must publish their source).
- **AGPL-3.0** — strong copyleft incl. network use: anyone running a modified version as a hosted service must publish their source. Best protection against closed-source SaaS clones; natural fit for a Wikipedia-style commons.
- **Apache-2.0** — permissive; max adoption, but anyone (incl. a competitor) can fork it closed-source. Adds an explicit patent grant.
- *Recommendation for this vision:* **AGPL-3.0**. Decide and swap `LICENSE` **before the repo goes public** (relicensing after others contribute needs every contributor's agreement).
- Third-party: vendored KaTeX is MIT. Keep a `THIRD-PARTY`/`NOTICE` file.

**2. Trademark.** Open-sourcing the code does not surrender the brand. Register at **EUIPO** (one filing covers the whole EU); add **USPTO** for US protection. Nice classes: 9 (software), 41 (education), 42 (SaaS). Run a knockout search first (`lernkarto` is cleaner than `recto` — see rename section).

**3. Content / deck IP.**
- Don't copy protected material. Facts and short definitions in your own words are fine; copying exam banks or textbook passages verbatim is not.
- Wikipedia-derived decks are **CC BY-SA 4.0**: attribute (link to article), indicate changes, share-alike, include a license notice. The `source`/`license`/`attribution` deck fields handle this.
- Community contributions: a **DCO** sign-off for code; **CC BY-SA 4.0** for shared deck content.

**4. Governance.** Hold the suite in a **GitHub organisation** (not personal); use **Open Collective** as a fiscal host for transparent donations. A dedicated non-profit can come later.

**5. Near-term action checklist.**
1. Pick the code licence (AGPL-3.0 vs Apache-2.0) and swap `LICENSE` before going public.
2. Settle the name; run EUIPO/USPTO knockout search; grab domain + social handles.
3. Add a `THIRD-PARTY` notice.
4. Create the GitHub org; set up Open Collective when donations start.
5. Decide DCO vs CLA before accepting outside contributions.

---

## Rename the project / repo — DONE: lernkarto

**Name chosen: `lernkarto`** (front/back of a leaf = the two sides of a flashcard).
Applied: GitHub repo renamed, `DEFAULT_BRAND` + header defaults + PWA manifest + offline-build filename (`lernkarto-offline.html`) + storage `PREFIX` (`lernkarto:`).

The **engine** is now `lernkarto`; the shipped **quantile** risk content keeps its own brand via deck metadata (`data/manifest.json` → `brand`). Domains: `lernkarto.com` is parked/for-sale; `lernkarto.io` and `lernkarto.dev` are free — lean `.io`/`.dev`.

---

## Card types & study modes — current reference

**Card types:**
- **Flip** — two-sided recall (term ⇄ definition); reveal by flipping.
- **Multiple choice** — single best answer; pick one, auto-graded.
- **True / False** — boolean statement; press T / F.
- **Multi-select** — "select all that apply"; pick the exact set, then check.
- **Cloze** — fill the blank (`{{answer}}` in the prompt); type to check.

**Modifiers any card can carry:** images · one-liner `summary` + "more" detail · LaTeX · `note` · interactive `graph` block.

**Study modes:**
- **name ↔ description** direction — `forward` / `reverse` / `shuffle`; deck-level via **ask:** control, or per-card via `direction` field.
- **Spaced repetition** (SM-2) on/off · **focus: still-learning** filter · **category** chips · **shuffle** (`s`).
- Interactive cards auto-grade on answer; plain cards **flip**.

---

## Launch content: the standard library

**Decision: launch ships a curated standard library of general-knowledge, CC-attributable decks.** Standard topics are tagged `"standard": true` in their topic file.

All 41 topics in `data/topics/` are currently flagged `standard:true`. The standard library now covers:

- **Languages (alphabets)** — Japanese kana + kanji N5, Cyrillic, Greek, Hebrew, Arabic, Korean Hangul, IPA, phonetics, codes
- **Quantitative methods** — Time series, Probability distributions, Normal distribution, Applied stats, Stats & markets
- **Risk management** — Foundations, Market, Credit, Liquidity, Capital, Counterparty, Operational, Glossary, Quant toolkit, Financial risk, Quant finance
- **C++** — Basics, OOP, Memory, Modern, Templates
- **Data / dev** — Data & prog tools, Dev reference
- **Quant interview** — Economics/stats/TS, Risk & markets, Quant interview, Aptitude
- **General knowledge** — Geography, Science, Physical constants, Thinking, Codes

**Mechanism:** `python3 tools/build-standalone.py --standard` produces the launch offline build (only `standard:true` topics, never the private overlay).

**Not in the standard launch:** the `private/` overlay has been removed from the repo entirely. Its generic decks now ship inside **Quantitative interview prep**, and the ECB/SSM deck moved to **Risk management → Capital & regulation**.

---

## LLM deck generation (distillator)

**Shipped v0 (client-side):** the build tab has *from Wikipedia* — paste a URL/title, it fetches the article summary into a draft deck with `source`/`license`/`attribution` (CC BY-SA 4.0) auto-filled.

**Still needed (the backend layer):**
- A hosted LLM to generate real cards from the full article, infer the right level, and emit deck/topic/subject(s)
- A **standard-library cache** so a popular page is converted once and reused
- An **auto-resync timer** that periodically re-checks the source Wikipedia page for edits and flags or regenerates changed cards (the per-card fingerprint already enables this — only changed cards reset)

**The differentiator:** none of the OSS flashcard apps treat a deck as a *living, attributed derivative of a source of truth*. Generate-from-source → cite → auto-resync is the white space.

**Distillator quality rules (binding — same bar as hand-authored decks):**
- Write the **primer** first, then cards across the three lenses (theoretical / empirical / practical), then **self-audit** the comprehension contract (DIRECT / DERIVED / GAP — patch the primer for any GAP before emitting).
- Generate fair MCQs — distractors plausible, in-domain, matched in length to the correct answer.
- **Plan-then-confirm:** first pass produces an assessment/plan (proposed structure, estimated card counts, related pages to pull from); generate only after the user confirms.
- See [`docs/guides/DECK-DESIGN-GUIDE.md`](guides/DECK-DESIGN-GUIDE.md) for the full quality standard.

---

## Cross-platform app (iOS + Android)

The app is static + offline-capable, so a mobile app is a thin wrapper:
1. **PWA first** — web-app manifest + service worker → installable on iOS/Android home screen, full offline, near-zero extra code. (Shipped.)
2. **Capacitor** (Ionic) — wrap the same web code into App Store / Play Store binaries when store presence is wanted.
3. React Native / Flutter / Tauri-mobile — only if a native UI rewrite is ever justified (it isn't, given the web app works).

---

## Interactive graphs

**Shipped:** a `graph` block on individual cards (`type`, `params`, `controls`) renders an interactive SVG via `GRAPH_RECIPES` in `js/graphs.js`. Implementation: hand-rolled SVG (no library — matches the no-deps ethos, cheap in the offline build). Cards with a graph block don't flip when the user interacts with sliders. Graphs also render in primers via a ` ```graph ``` ` markdown fence (JSON extracted before HTML escaping, hydrated via `buildGraph` after `innerHTML` is set). Both `graph` (card back) and `frontGraph` (card front, above the hint) are supported; `controls: []` gives a static graph, `controls: [...]` an interactive one.

Recipes shipped:
- ✅ `normal` — PDF curve with μ/σ sliders; fixed [-5, 5] window so the bell visibly shifts and reshapes. Wired on `normal-fundamentals.json`.
- ✅ `poisson` — PMF bar chart with λ slider. Wired on `dist-poisson.json`.
- ✅ `normal-within` — standard-normal bell with symmetric shading ±kσ and live "XX.X% within ±kσ" annotation. Used as interactive `frontGraph` and in primers (empirical rule explorer).
- ✅ `normal-cdf` — standard-normal bell with left-tail shading up to kσ and live Φ(kσ) annotation. One-sided CDF explorer; used as interactive `frontGraph` and in primers.
- ✅ `normal-hypothesis` — two overlapping N(0,1)/N(δ,1) bells (H₀ coral, H₁ blue); threshold slider; live α/β/power annotations. Wired on `hypothesis-testing.json`.

**Next recipes (priority order):**

| Card / topic | Recipe | The interaction that teaches it |
|---|---|---|
| t-distribution vs normal | `t-dist` | drag degrees of freedom; watch tails fatten vs Gaussian |
| Binomial PMF | `binomial` | drag n and p; see how the shape shifts and approaches normal |
| Exponential / waiting times | `exponential` | drag λ; see mean = 1/λ, memoryless shape |
| VaR, ES | `loss-distribution` | drag the confidence line; show VaR vs ES, shade the tail |
| Option payoff | `option-payoff` | drag strike; toggle call/put, long/short; add premium |
| Price vs yield (duration/convexity) | `price-yield` | shift yield; compare linear (duration) estimate to true curve |
| Yield curve | `yield-curve` | apply level / slope / curvature shocks |
| Volatility smile | `vol-smile` | drag skew/curvature; see how it bends from flat Black–Scholes |

All are 2-D, pure functions of a few parameters — the hand-rolled SVG approach handles them all.

**To wire up a new recipe:**
1. Add a `GRAPH_RECIPES["recipe-name"]` entry in `js/graphs.js` (before `buildGraph`).
2. Add `"graph"` or `"frontGraph": { "type": "recipe-name", "params": {...}, "controls": [...] }` to the card JSON, or a ` ```graph ``` ` fence in a primer.
3. Run `node tests/run.js` — tests catch orphan/manifest drift.

**Open questions:**
- **Accessibility:** draggable handles need keyboard control and an `aria`/text fallback (numeric input mirroring the drag) so the graph isn't mouse-only. The current sliders are accessible; draggable SVG handles (if added later) are not.
- **Reduced motion:** honour `prefers-reduced-motion` — render static with steppable inputs rather than animated transitions.
- **Print / export:** should a card's graph be capturable as an image for notes?
- **Recipe sprawl:** cap the built-in set; resist one-off graphs that don't generalise.

---

## Internationalization (i18n) — EN + FR + IT + ES

**Two layers, translated independently:**

1. **UI chrome (engine strings)** — ~100–150 strings (tab labels, buttons, settings, SR prompt). Extract into a `t("key")` helper + `i18n/en.json` source-of-truth; ship locale files (`fr.json`, `it.json`, `es.json`); fall back to `en` for any missing key. Locale resolution: user choice in settings → `navigator.language` → `en`.

2. **Deck content (cards)** — translations are sibling content, not runtime auto-generation. Add `lang` field (BCP-47) per deck; link translations via `translationOf` id so the library can offer "also available in: FR · IT". The Wikipedia distillator is a natural source of multilingual decks.

**Sequencing:** UI extraction first (small, self-contained), then FR to prove the pipeline, then IT + ES.

---

## Spaced repetition & notifications

**Due-card notifications:** when SR is on, notify when cards are due — but never at unreasonable hours. Defer 4am due times to a morning slot (~9am). Delivery: PWA web push (needs a push backend) or, on Capacitor, native local notifications (fully offline).

---

## Discussion — aptitude generator & live coding

- **Parametrised aptitude generator.** The aptitude families (random walk, arrangements, pigeonhole, dice/coin, counting, pseudocode) are templated — a generator could emit endless verified variants. Pair with method-primers; prefer "understand the technique" framing over memorisation. Worth a design pass before building.
- **Live coding in-app + Advent of Code.** If the app could run code (a sandboxed JS/Python cell via WebAssembly Pyodide), coding challenges become first-class content. Big feature (execution sandbox, test harness, per-puzzle input); north-star for a coding mode.

### Weekly brain-teaser (feature idea)
Every week, add a new puzzle to a randomly-chosen aptitude category so the `Cognitive & quant aptitude` decks grow over time. Generate → verify (exact/brute-force, the current bar) → append. A deterministic ISO-week seed picks the category + parameters for an offline reproducible "card of the week". Surface with a weeks-solved streak + quiet-hours notification.

---

## Prior art

Open-source Quizlet/Anki-likes to learn from:
- **quenti-io/quenti** — open-source Quizlet alternative (self-hostable, has a backend)
- **hwgilbert16/scholarsome** — self-hosted flashcard study system
- **judemont/QuizFlow** — lightweight FOSS Quizlet alternative (Learn/Match/Test modes)
- **Anki / AnkiWeb** — the gold standard for spaced repetition (heavier, desktop-first)

Our niche: zero-backend, offline single-file + PWA, bring-your-own-deck engine.

---

## Wishlist (parked content — not committed)

- **Programming-language courses (10).** Full, ordered courses (C++ done): Python, R, SAS, Java, JavaScript, Go, Rust, Swift, VHDL — each a subject with version-aware topics. Big content effort — parked until after v1.0.0.
- **Interview-questions bank (general).** A curated bank of questions likely to be asked in interviews, broadening the existing `interview-question-bank` deck. Scope/structure TBD (by field? quant/SWE/risk? difficulty tiers?).
