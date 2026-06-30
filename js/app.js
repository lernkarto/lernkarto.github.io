/* ===========================================================
   lernkarto : the flashcard engine (content-agnostic)
   Content-agnostic. Studies whatever it loads:
     • shipped content: data/manifest.json -> data/topics/*.json -> data/decks/*.json
     • imported decks or sets (inline) pasted/uploaded at runtime
     • embedded decks (single-file offline build)
   LaTeX in any text field renders via KaTeX ($...$ / $$...$$).
   Progress persists per deck through window.storage. No deps beyond
   the vendored KaTeX; no build step to host or contribute.
   =========================================================== */

"use strict";

const PREFIX = "lernkarto:";

/* PALETTE, DEFAULT_ACCENT, DEFAULT_BRAND, and text helpers live in schema.js (loaded first) */
let appBrand = DEFAULT_BRAND;        // app-wide brand (from manifest / offline bundle)
let currentBrandName = DEFAULT_BRAND.name;
let defaultMarkHtml = "";            // the generic mark shipped in index.html (captured at startup)

/* ---------- persistence ----------
   Uses the host's window.storage when present (e.g. the preview sandbox), and
   always also mirrors to localStorage so progress survives across visits on a
   plain browser (GitHub Pages, the offline single-file build, etc.). */
const Store = {
  ext: (typeof window !== "undefined" && window.storage && typeof window.storage.get === "function"),
  ls: (() => { try { const k = "__recto_probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; } catch (e) { return false; } })(),
  async get(key) {
    if (this.ext) { try { const record = await window.storage.get(key); if (record && record.value != null) return record.value; } catch (e) { /* fall through */ } }
    if (this.ls) { try { return localStorage.getItem(key); } catch (e) { /* ignore */ } }
    return null;
  },
  async set(key, value) {
    if (this.ext) { try { await window.storage.set(key, value); } catch (e) { /* ignore */ } }
    if (this.ls) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } }
  },
};

/* helpers, MCQ parsing, deck schema: schema.js (loaded before app.js) */
/* ---- progress ("memory"): what you got right/wrong, portable across visits ---- */
async function exportProgress() {
  const data = { type: "lernkarto-progress", version: 1, exportedAt: new Date().toISOString(), srMode, marks: {}, sr: {} };
  for (const d of library) {
    const m = await Store.get(PREFIX + "marks:" + d.id);
    if (m) { try { const o = JSON.parse(m); if (o && Object.keys(o).length) data.marks[d.id] = o; } catch (e) { /* skip */ } }
    const s = await Store.get(PREFIX + "sr:" + d.id);
    if (s) { try { const o = JSON.parse(s); if (o && Object.keys(o).length) data.sr[d.id] = o; } catch (e) { /* skip */ } }
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "lernkarto-progress.json";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  URL.revokeObjectURL(url);
}

async function importProgressFromText(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { alert("That isn't valid JSON."); return; }
  if (!data || (typeof data.marks !== "object" && typeof data.sr !== "object")) {
    alert("This doesn't look like a progress file (expected marks / sr)."); return;
  }
  let decks = 0;
  for (const [id, o] of Object.entries(data.marks || {})) { await Store.set(PREFIX + "marks:" + id, JSON.stringify(o)); decks++; }
  for (const [id, o] of Object.entries(data.sr || {})) { await Store.set(PREFIX + "sr:" + id, JSON.stringify(o)); }
  if (typeof data.srMode === "boolean") { srMode = data.srMode; }   // per-deck sr-on:<id> is the persisted source; no global srMode key
  if (currentDeck) await selectDeck(currentDeck.id);   // re-read marks/SR for the open deck
  alert("Progress restored for " + decks + " deck(s).");
}

/* a whole set packaged as one importable "pack" (set + all its decks inline).
   (A "bundle" is reserved for the full user session.) */
function downloadPack(topicName, decks) {
  const pack = { topic: topicName, id: slugify(topicName), decks: decks.map(deckToObject) };
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = slugify(topicName) + ".pack.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------ state --------------------------- */
let library = [];
let topicSubjects = {};    // topic name -> Set of subject names; a topic may belong to SEVERAL subjects (reuse)
let importedRaw = [];      // flat list of imported deck objects (sets are flattened on import)
let currentDeck = null;
let marks = {};
let currentCategory = "all";
let focusLearning = false;
let deck = [];             // indices into currentDeck.cards
let position = 0;
let isFlipped = false;
let fetchFailed = false;
let srMode = false;
let srUser = false;        // has the user opted into spaced repetition anywhere?
let myLib = new Set();     // deck ids saved to "My library" (your working collection)
let learningSet = new Set(); // deck ids you're actively learning (SR + scoring active)
let savedColl = new Set();   // ⭐ saved topics/subjects/courses — typed keys "topic:..|subject:..|course:.."
let studyingColl = new Set(); // 🎓 currently-studying topics/subjects/courses (set when you start one)
let libFilter = "all";     // ⭐/🎓 sub-filter (browse + decks views): all | lib | learning
let libView = "browse";    // library lookup tab: browse | decks | topics | subjects | courses
let libTag = "";           // active tag filter applied to the current lookup view ("" = none)
let librarySearch = "";    // global card search query (Library tab)
let searchScope = "decks";   // search entity type: decks | topics | subjects | courses | cards
let searchLang  = "";         // "" = any lang; BCP-47 code to restrict to that language
let customCourses = [];    // user-built courses: [{id, name, items:[{type,ref}]}]
let authoredCourses = [];  // shipped courses (data/courses/*.json) — same shape; ordered playlists over decks/topics/subjects
let courseBuild = false;   // library is in "pick decks for a new course" mode
let libSubj = null;        // selected subject in the library shell (master-detail)
let libTopic = null;       // selected topic in the library shell
let libPane = "nav";       // narrow-screen pane: "nav" (master) | "main" (detail)
let pickerOpen = new Set(); // expanded node ids in the study-selector working set
let topicToFile = {};      // topic name → topic filename (for lazy primer loading)
let courseSelection = [];          // ordered course items [{type,ref}] selected while building
let courseView = null;     // {type:'subject'|'course', key} while showing a gated ordered path
let studyDays = [];        // YYYY-MM-DD dates with study activity (for the streak)
let ownerMarks = {};       // when studying a virtual (cross-deck) deck: ownerDeckId -> its marks map
let shuffleMode = false;   // persistent random card order (per deck)
let cardDir = "default";   // name↔description: default(follow deck) | forward | reverse | shuffle
let studyMode = "flip";    // flip | quiz (auto-MCQ) | listen (audio-first MCQ)  — per deck
let activeQuiz = null;     // synthesized MCQ for the current quiz/listen render (not persisted)
let activeType = null;     // {answer, wantTerm} for the current type-to-answer render
let exam = null;           // {queue:[cardIdx], idx, results:[{category,correct}], start} during an exam
let examTimer = null;      // interval id for the exam clock
let topicPrimers = {};     // topicName → { body, title }: a topic's own recap (NOT inherited by its decks)
let subjectMeta = {};      // subjectName → { primerTitle, primer, description } from data/subjects/*.json
let sr = {};               // term -> {ease, reps, interval(min), due(ts)}  (spaced repetition)
const SR_DAY = 1440;       // minutes in a day

const $ = (id) => document.getElementById(id);
const host = $("stageHost");

/* --------------------------- loading ---------------------------- */
/* add a deck (deduped by id) and record its TOPIC membership — a deck may belong to
   several topics (reuse). Returns the deck (new or existing). */
// MCQ quality check: an option-length tell. The correct answer should not stand out by length —
// warn when its length is an outlier vs EVERY distractor (fine if ≥1 distractor is similar length).
function mcqAnswerLengthOutlier(card) {
  if (!card || card.type !== "mcq" || !Array.isArray(card.choices) || typeof card.answer !== "number") return false;
  const ch = card.choices, a = card.answer;
  if (a < 0 || a >= ch.length || ch.length < 2) return false;
  const L = String(ch[a]).length;
  const others = ch.map((c, i) => (i === a ? -1 : String(c).length)).filter((n) => n >= 0);
  const similar = (o) => Math.abs(L - o) <= 12 || (Math.min(L, o) > 0 && Math.max(L, o) / Math.min(L, o) <= 1.5);
  return !others.some(similar);   // flagged when no distractor is close in length to the correct option
}
function warnMcqBalance(deck) {
  try {
    const bad = (deck.cards || []).map((c, i) => ({ c, i })).filter((x) => mcqAnswerLengthOutlier(x.c));
    if (bad.length) console.warn(
      `[deck:${deck.id}] ${bad.length} MCQ card(s) where the correct answer is a length-outlier vs every distractor (guessable by shape) — `
      + bad.map((x) => `#${x.i + 1} "${String(x.c.term).slice(0, 56)}"`).join("; ")
    );
  } catch (e) { /* a lint check must never block loading */ }
}
function addDeck(normalized, options) {
  const opts = options || {};
  let deck = library.find((existing) => existing.id === normalized.id);
  if (!deck) {
    deck = normalized;
    deck.topics = [];
    if (opts.brand && !deck.brand) deck.brand = opts.brand;
    deck.imported = !!opts.imported;
    library.push(deck);
    warnMcqBalance(deck);   // warn at load / creation if any answer is guessable by length
  }
  const topic = opts.topic || normalized.topic;
  if (topic) {
    if (!deck.topic) deck.topic = topic;                            // primary topic (eyebrow + back-compat)
    if (deck.topics.indexOf(topic) < 0) deck.topics.push(topic);
    const subs = (opts.subjects && opts.subjects.length) ? opts.subjects
      : ((normalized.subjects && normalized.subjects.length) ? normalized.subjects : (normalized.subject ? [normalized.subject] : []));
    if (subs.length) {
      topicSubjects[topic] = topicSubjects[topic] || new Set();
      subs.forEach((s) => topicSubjects[topic].add(s));
      if (!deck.subject || Array.isArray(deck.subject)) deck.subject = subs[0];   // primary subject = first declared
    }
  }
  return deck;   // a deck's primer is ITS OWN (raw.primer) only — topics/subjects never push theirs onto decks
}

// card count for display — works on both fully-loaded decks and lightweight catalogue stubs
const deckCount = (d) => d.count != null ? d.count : (d.cards ? d.cards.length : 0);

// fetch and populate cards for a catalogue stub (no-op if already loaded or imported)
async function ensureCards(d) {
  if (!d || d.cards !== null || d.imported) return;
  try {
    const res = await fetch("data/decks/" + d.id + ".json");
    if (!res.ok) { d.cards = []; d.categories = {}; return; }
    const full = normalizeDeck(await res.json(), d.id + ".json");
    // preserve topic/subject hierarchy from the catalogue (source of truth)
    const { topic, topics, subject, subjects } = d;
    Object.assign(d, full);
    if (topic) d.topic = topic;
    if (topics && topics.length) d.topics = topics;
    if (subject) d.subject = subject;
    if (subjects && subjects.length) d.subjects = subjects;
    d.count = d.cards.length;
  } catch (e) { d.cards = []; d.categories = {}; }
}

// fetch a topic's primer text lazily — only called when entering a virtual "study all" session
async function loadTopicPrimer(topicName) {
  if (topicPrimers[topicName] || !topicToFile[topicName]) return;
  try {
    const res = await fetch("data/topics/" + topicToFile[topicName]);
    if (!res.ok) return;
    const t = await res.json();
    const name = t.topic || t.set || t.name;
    if (name && t.primer) topicPrimers[name] = { body: String(t.primer), title: t.primerTitle || null };
  } catch (e) { /* primer unavailable — study continues without it */ }
}

async function loadTopic(topicObject, baseDir) {
  baseDir = baseDir || "data/decks/";
  const topicName = topicObject.topic || topicObject.set || topicObject.name || null;
  const topicBrand = (topicObject.brand && typeof topicObject.brand === "object") ? topicObject.brand : null;
  const topicSubjectList = Array.isArray(topicObject.subject) ? topicObject.subject.map(String) : (topicObject.subject ? [String(topicObject.subject)] : []);
  const topicPrimer = topicObject.primer ? String(topicObject.primer) : null;          // topic's own recap — stored, NOT pushed onto its decks
  if (topicName && topicPrimer) topicPrimers[topicName] = { body: topicPrimer, title: topicObject.primerTitle ? String(topicObject.primerTitle) : null };
  const opts = { topic: topicName, brand: topicBrand, subjects: topicSubjectList };
  if (topicName && topicSubjectList.length) { topicSubjects[topicName] = topicSubjects[topicName] || new Set(); topicSubjectList.forEach((s) => topicSubjects[topicName].add(s)); }
  if (Array.isArray(topicObject.decks)) {
    topicObject.decks.forEach((raw) => addDeck(normalizeDeck(raw, raw && raw.id), opts));
  }
  if (Array.isArray(topicObject.deckFiles)) {
    for (const file of topicObject.deckFiles) {
      try {
        const response = await fetch(baseDir + file, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const raw = await response.json();
        addDeck(normalizeDeck(raw, file), opts);
      } catch (error) { console.warn("recto: could not load deck", file, error); }
    }
  }
}


async function loadLibrary() {
  srUser = (await Store.get(PREFIX + "sr-user")) === "1";
  try { myLib = new Set(JSON.parse((await Store.get(PREFIX + "mylib")) || "[]")); } catch (e) { myLib = new Set(); }
  try { learningSet = new Set(JSON.parse((await Store.get(PREFIX + "learning")) || "[]")); } catch (e) { learningSet = new Set(); }
  try { savedColl = new Set(JSON.parse((await Store.get(PREFIX + "saved")) || "[]")); } catch (e) { savedColl = new Set(); }
  try { studyingColl = new Set(JSON.parse((await Store.get(PREFIX + "studying")) || "[]")); } catch (e) { studyingColl = new Set(); }
  try { studyDays = JSON.parse((await Store.get(PREFIX + "days")) || "[]") || []; } catch (e) { studyDays = []; }
  try { customCourses = JSON.parse((await Store.get(PREFIX + "courses")) || "[]") || []; } catch (e) { customCourses = []; }
  defaultMarkHtml = $("brandMark") ? $("brandMark").innerHTML : "";
  if (window.RECTO_BRAND && typeof window.RECTO_BRAND === "object") appBrand = window.RECTO_BRAND;

  // imported decks (persisted; work without a server)
  try {
    const stored = await Store.get(PREFIX + "imported");
    if (stored) importedRaw = JSON.parse(stored) || [];
  } catch (error) { importedRaw = []; }
  importedRaw.forEach((raw) => addDeck(normalizeDeck(raw, raw && raw.id), { imported: true, topic: raw && (raw.topic || raw.set) }));

  // embedded decks (single-file offline build sets window.RECTO_EMBEDDED_DECKS)
  if (Array.isArray(window.RECTO_EMBEDDED_DECKS)) {
    window.RECTO_EMBEDDED_DECKS.forEach((raw) => addDeck(normalizeDeck(raw, raw && raw.id), { topic: raw && (raw.topic || raw.set) }));
  }

  // data/manifest.json is the single discovery file: brand + topics + subjects + courses arrays.
  try {
    const manifestResponse = await fetch("data/manifest.json", { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error("manifest " + manifestResponse.status);
    const manifest = await manifestResponse.json();
    if (manifest && manifest.brand && typeof manifest.brand === "object") appBrand = manifest.brand;

    // catalogue: lightweight stub for every deck (no cards — loaded lazily on selectDeck)
    const catRes = await fetch("data/catalogue.json", { cache: "no-store" });
    if (!catRes.ok) throw new Error("catalogue " + catRes.status);
    const cat = await catRes.json();
    topicToFile = cat.topicToFile || {};
    for (const e of (cat.decks || [])) {
      const stub = {
        id: e.id, name: e.name, slug: e.id,
        accent: e.color || DEFAULT_ACCENT,
        description: e.description || "",
        count: e.count || 0,
        tags: e.tags || [],
        lang: e.lang || null,
        dual: !!e.dual,
        primerTitle: e.primerTitle || null,
        hasPrimer: !!e.hasPrimer,
        source: e.source || null, license: e.license || null, attribution: e.attribution || null,
        topic: (e.topics && e.topics[0]) || null,
        topics: e.topics || [],
        subject: (e.subjects && e.subjects[0]) || null,
        subjects: e.subjects || [],
        imported: false, cards: null, categories: null, primer: null,
      };
      library.push(stub);
      if (e.topics) e.topics.forEach((tn, i) => {
        topicSubjects[tn] = topicSubjects[tn] || new Set();
        (e.subjects || []).forEach((s) => topicSubjects[tn].add(s));
      });
    }

    // subject registry: first-class subjects that OWN a list of topics (+ their primer)
    if (window.RECTO_SUBJECTS && typeof window.RECTO_SUBJECTS === "object") subjectMeta = Object.assign({}, window.RECTO_SUBJECTS);
    for (const sf of (manifest.subjects || [])) {
      try {
        const res = await fetch("data/subjects/" + sf, { cache: "no-store" });
        if (res.ok) { const s = await res.json(); if (s.name) subjectMeta[s.name] = s; }
      } catch (e) { /* skip a bad subject file */ }
    }

    // authored course registry: shipped ordered playlists
    if (Array.isArray(window.RECTO_COURSES)) authoredCourses = window.RECTO_COURSES.slice();
    const fetched = [];
    for (const cf of (manifest.courses || [])) {
      try {
        const cr = await fetch("data/courses/" + cf, { cache: "no-store" });
        if (cr.ok) fetched.push(await cr.json());
      } catch (e) { /* skip a bad course file */ }
    }
    if (fetched.length) authoredCourses = fetched;
  } catch (error) {
    fetchFailed = true; // typically file:// or offline without the bundle
  }

  // a subject owns its topics → invert into topicSubjects (a topic may be owned by several subjects).
  // (Legacy/private topics that still declare their own `subject` already populated topicSubjects in loadTopic.)
  Object.keys(subjectMeta).forEach((s) => {
    (subjectMeta[s].topics || []).forEach((t) => { topicSubjects[t] = topicSubjects[t] || new Set(); topicSubjects[t].add(s); });
  });
  // stamp each deck's primary subject (first subject that owns one of its topics)
  library.forEach((d) => { if (!d.subject) { const ss = deckSubjects(d); if (ss.size) d.subject = [...ss][0]; } });

  renderNotice();
  renderDeckPicker();

  // resume the last thing studied — a deck, or a whole subject/topic/course session (not a random catalog deck)
  let resumed = false;
  try {
    const raw = await Store.get(PREFIX + "lastSel");
    if (raw) {
      const ls = JSON.parse(raw);
      if (ls.kind === "deck" && library.find((d) => d.id === ls.ref)) { await selectDeck(ls.ref); resumed = true; }
      else if (ls.kind === "subject") { await studyVirtual(ls.ref, true); resumed = true; }
      else if (ls.kind === "topic") { await studyVirtual(ls.ref, false); resumed = true; }
      else if (ls.kind === "course") { const co = findCourse(ls.ref); if (co) { await studyCourse(co); resumed = true; } }
    }
  } catch (e) { /* corrupt pointer — fall through */ }
  if (!resumed) {
    const lastId = await Store.get(PREFIX + "lastDeck");
    const start = library.find((d) => d.id === lastId);   // an explicit last deck, if any — never an arbitrary catalog deck
    if (start) selectDeck(start.id);
    else { renderNoDecks(); if (library.length) showTab("library"); }   // nothing to resume: land on the library, don't force a deck
  }
}

async function selectDeck(id) {
  const chosen = library.find((d) => d.id === id);
  if (!chosen) return;
  await ensureCards(chosen);
  currentDeck = chosen;
  Store.set(PREFIX + "lastDeck", id);
  Store.set(PREFIX + "lastSel", JSON.stringify({ kind: "deck", ref: id }));

  marks = {};
  const storedMarks = await Store.get(PREFIX + "marks:" + id);
  if (storedMarks) { try { marks = JSON.parse(storedMarks) || {}; } catch (error) { marks = {}; } }

  sr = {};
  const storedSr = await Store.get(PREFIX + "sr:" + id);
  if (storedSr) { try { sr = JSON.parse(storedSr) || {}; } catch (error) { sr = {}; } }

  currentCategory = "all";
  focusLearning = false;
  const storedFilter = await Store.get(PREFIX + "filter:" + id);
  if (storedFilter && (storedFilter === "all" || chosen.categories[storedFilter])) currentCategory = storedFilter;

  cardDir = "default";
  const storedDir = await Store.get(PREFIX + "dir:" + id);
  if (["default", "forward", "reverse", "shuffle"].indexOf(storedDir) >= 0) cardDir = storedDir;

  shuffleMode = (await Store.get(PREFIX + "shuffle:" + id)) === "1";
  studyMode = "flip";
  const storedMode = await Store.get(PREFIX + "mode:" + id);
  if (["flip", "quiz", "listen", "type"].indexOf(storedMode) >= 0) studyMode = storedMode;
  const srOnRaw = await Store.get(PREFIX + "sr-on:" + id);      // spaced repetition is per-deck
  srMode = srOnRaw === "1";
  // if the user uses SR and hasn't decided about this deck yet, offer to add it
  const srUndecided = srUser && (srOnRaw === null || srOnRaw === undefined);

  applyBrand(chosen);
  renderDeckHeader();
  renderDeckPicker();
  $("removeDeck").hidden = !chosen.imported;
  rebuildDeck(true);

  const prompt = $("srPrompt");
  if (prompt) {
    prompt.hidden = !(srUndecided && chosen.cards.length);
    if (!prompt.hidden) $("srPromptText").textContent = `Add “${chosen.name}” to your spaced-repetition reviews?`;
  }

  await offerPrimer(chosen);   // one-pager recap — offered on first entry, on demand afterwards
}

/* ------------------------- header / chrome ---------------------- */
function renderDeckHeader() {
  $("deckName").textContent = currentDeck.name;
  const total = currentDeck.cards.length;
  const categoryCount = Object.keys(currentDeck.categories).length;
  const bits = [total + (total === 1 ? " card" : " cards")];
  if (categoryCount > 1) bits.push(categoryCount + " sections");
  const meta = currentDeck.description ? currentDeck.description + "  ·  " + bits.join(" · ") : bits.join(" · ");
  $("deckMeta").textContent = meta;
  const subj = currentDeck.subject || (currentDeck.topic ? topicSubjectsArr(currentDeck.topic)[0] : null);
  $("appEyebrow").textContent = currentDeck.topic
    ? "// " + (subj ? subj.toLowerCase() + " · " : "") + currentDeck.topic.toLowerCase()
    : (currentDeck.imported ? "// imported" : "// deck");

  const attr = $("deckAttr");
  if (attr) {
    if (currentDeck.attribution || currentDeck.source || currentDeck.license) {
      const bitsA = [];
      if (currentDeck.attribution) bitsA.push(linkify(escapeHtml(currentDeck.attribution)));
      else {
        if (currentDeck.source) bitsA.push("source: " + linkify(escapeHtml(currentDeck.source)));
        if (currentDeck.license) bitsA.push(escapeHtml(currentDeck.license));
      }
      attr.innerHTML = bitsA.join(" · ");
      attr.hidden = false;
    } else { attr.hidden = true; attr.textContent = ""; }
  }
}

/* ------------------------- primer (one-pager recap) ---------------------- */
/* light-markdown → HTML for the primer body: ## headings, **bold**, `code`,
   - bullets, and paragraphs. $math$ is left intact for KaTeX to typeset. */
function mdToHtml(src) {
  // Extract ```graph ... ``` fences before HTML-escaping so JSON survives intact
  const graphs = [];
  const srcProcessed = String(src || "").replace(/```graph\n([\s\S]*?)```/g, (_, json) => {
    graphs.push(json.trim());
    return `%%GRAPH_${graphs.length - 1}%%`;
  });
  const inline = (s) => linkify(s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>"));
  const lines = escapeHtml(srcProcessed).split(/\r?\n/);
  let html = "", listOpen = false;
  const closeList = () => { if (listOpen) { html += "</ul>"; listOpen = false; } };
  for (const line of lines) {
    const t = line.trim();
    let m;
    if (!t) { closeList(); }
    else if ((m = t.match(/^%%GRAPH_(\d+)%%$/))) {
      closeList();
      const spec = graphs[parseInt(m[1], 10)] || "{}";
      html += `<div class="primer-graph" data-spec="${encodeURIComponent(spec)}"></div>`;
    }
    else if ((m = t.match(/^#{2,3}\s+(.*)$/))) { closeList(); html += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = t.match(/^[-*]\s+(.*)$/))) { if (!listOpen) { html += "<ul>"; listOpen = true; } html += `<li>${inline(m[1])}</li>`; }
    else { closeList(); html += `<p>${inline(t)}</p>`; }
  }
  closeList();
  return html;
}

/* the seen-key is per set (or deck if standalone) so the recap shows once per topic */
function primerKey(deck) { return (deck && (deck._primerKey || deck.id)) || ""; }
/* offer an entity's OWN primer: a real deck's, or (for a virtual deck) its topic's / subject's.
   No inheritance — an entity without its own primer simply shows none. */
async function offerPrimer(deck) {
  if ($("primerOpen")) $("primerOpen").hidden = !deck.primer;
  closePrimer(false);
  const decided = deck.primer ? (await Store.get(PREFIX + "primer-seen:" + primerKey(deck))) === "1" : true;
  const pprompt = $("primerPrompt");
  if (pprompt) {
    pprompt.hidden = !(deck.primer && !decided && deck.cards.length);
    if (!pprompt.hidden) $("primerPromptText").textContent = `New to “${deck.topic || deck.name}”? Read the quick recap first?`;
  }
}

function showPrimer() {
  if (!currentDeck || !currentDeck.primer) return;
  $("primerTitle").textContent = currentDeck.primerTitle || ("Recap — " + (currentDeck.topic || currentDeck.name));
  const body = $("primerBody");
  body.innerHTML = mdToHtml(currentDeck.primer);
  typesetMath(body);
  body.querySelectorAll(".primer-graph[data-spec]").forEach(el => {
    try { buildGraph(JSON.parse(decodeURIComponent(el.dataset.spec)), el); } catch (e) { /* bad spec */ }
  });
  $("primerPanel").hidden = false;
  $("studyView").classList.add("primer-open");
}

async function closePrimer(markSeen) {
  $("primerPanel").hidden = true;
  $("studyView").classList.remove("primer-open");
  if (markSeen && currentDeck && currentDeck.primer) await Store.set(PREFIX + "primer-seen:" + primerKey(currentDeck), "1");
}

/* set the header brand from the deck's metadata, the app brand, or the default.
   Imported decks may set name/tagline (text) but never a raw SVG mark (XSS). */
function applyBrand(deck) {
  const brand = (deck && deck.brand) ? deck.brand
    : (deck && deck.imported ? DEFAULT_BRAND : appBrand);
  currentBrandName = brand.name || DEFAULT_BRAND.name;
  if ($("brandName")) $("brandName").textContent = currentBrandName;
  if ($("brandSub")) $("brandSub").textContent = brand.tagline || DEFAULT_BRAND.tagline;
  const markEl = $("brandMark");
  if (markEl) {
    const trusted = brand.mark && !(deck && deck.imported);   // SVG only from shipped content
    markEl.innerHTML = trusted ? brand.mark : defaultMarkHtml;
  }
  document.documentElement.style.setProperty("--accent", brand.accent || DEFAULT_ACCENT);
  document.title = currentBrandName + " — " + (brand.tagline || DEFAULT_BRAND.tagline);
}

/* header switcher: a focused popover over your WORKING SET — custom courses + the
   decks you saved to My library (plus the open deck). Full subject/topic browsing,
   "study all", search and the course builder live on the Library page. */
function renderDeckPicker() {
  const btn = $("deckBrowse");
  if (btn) btn.textContent = (currentDeck ? currentDeck.name : "choose…") + "  ▾";
  const panel = $("browsePanel");
  if (!panel) return;
  panel.innerHTML = "";
  const pick = (fn) => { fn(); closeBrowse(); };

  // one drillable row in the working set (expand subjects→topics→decks; ▶ shuffle / 🎯 course are per-row actions)
  const pickerNode = (o) => {
    const row = document.createElement("div"); row.className = "pick-row"; row.style.paddingLeft = (8 + (o.indent || 0) * 14) + "px";
    const main = document.createElement("button"); main.type = "button"; main.className = "pick-main";
    main.innerHTML = `<span class="pick-tw">${o.expandable ? (o.open ? "▾" : "▸") : ""}</span><span class="pick-lab">${escapeHtml(o.label)}</span>`
      + (o.count != null ? `<span class="browse-n">${o.count}</span>` : "");
    main.onclick = o.onPick ? () => pick(o.onPick) : (e) => { e.stopPropagation(); o.onToggle(); };
    row.appendChild(main);
    (o.actions || []).forEach((a) => {
      const x = document.createElement("button"); x.type = "button"; x.className = "pick-act"; x.title = a.title; x.textContent = a.icon;
      x.onclick = (e) => { e.stopPropagation(); pick(a.go); };
      row.appendChild(x);
    });
    panel.appendChild(row);
  };
  const topicDecksOf = (t) => library.filter((d) => ((d.topics && d.topics.length) ? d.topics : [d.topic]).indexOf(t) >= 0);
  // a saved/studying container, drilled in place: subject → its topics → their decks (or a standalone topic / course)
  const renderWorkingSet = (title, keys) => {
    const conts = keys.map((k) => { const i = k.indexOf(":"); return { type: k.slice(0, i), ref: k.slice(i + 1) }; })
      .filter((c) => c.type === "subject" || c.type === "topic" || c.type === "course");
    if (!conts.length) return;
    const sh = document.createElement("div"); sh.className = "browse-subject"; sh.innerHTML = `<span>${title}</span>`; panel.appendChild(sh);
    conts.forEach((c) => {
      if (c.type === "course") { const co = findCourse(c.ref); if (co) pickerNode({ label: co.name, count: courseSize(co), onPick: () => studyCourse(co) }); return; }
      if (c.type === "subject") {
        const nid = "S:" + c.ref, open = pickerOpen.has(nid);
        pickerNode({ label: c.ref, expandable: true, open, onToggle: () => { open ? pickerOpen.delete(nid) : pickerOpen.add(nid); renderDeckPicker(); },
          actions: [{ icon: "▶", title: "Shuffle all decks in this subject", go: () => studyVirtual(c.ref, true) },
                    { icon: "🎯", title: "Gated course through this subject", go: () => { courseView = { type: "subject", key: c.ref }; showTab("library"); renderLibrary(); } }] });
        if (open) {
          const sdecks = library.filter((d) => deckInSubject(d, c.ref));
          let topics = [...new Set(sdecks.flatMap((d) => (d.topics && d.topics.length) ? d.topics : [d.topic]))].filter((t) => topicSubjectsArr(t).includes(c.ref));
          if (!topics.length) topics = [...new Set(sdecks.flatMap((d) => (d.topics && d.topics.length) ? d.topics : [d.topic]))];
          topics.sort((a, b) => a.localeCompare(b)).forEach((t) => {
            const tid = nid + "|T:" + t, topen = pickerOpen.has(tid);
            pickerNode({ indent: 1, label: t, expandable: true, open: topen, onToggle: () => { topen ? pickerOpen.delete(tid) : pickerOpen.add(tid); renderDeckPicker(); },
              actions: [{ icon: "▶", title: "Shuffle this topic", go: () => studyVirtual(t, false) }] });
            if (topen) sdecks.filter((d) => ((d.topics && d.topics.length) ? d.topics : [d.topic]).indexOf(t) >= 0)
              .forEach((d) => pickerNode({ indent: 2, label: d.name, count: deckCount(d), onPick: () => selectDeck(d.id) }));
          });
        }
        return;
      }
      // standalone topic
      const nid = "T:" + c.ref, open = pickerOpen.has(nid);
      pickerNode({ label: c.ref, expandable: true, open, onToggle: () => { open ? pickerOpen.delete(nid) : pickerOpen.add(nid); renderDeckPicker(); },
        actions: [{ icon: "▶", title: "Shuffle this topic", go: () => studyVirtual(c.ref, false) }] });
      if (open) topicDecksOf(c.ref).forEach((d) => pickerNode({ indent: 1, label: d.name, count: deckCount(d), onPick: () => selectDeck(d.id) }));
    });
  };
  renderWorkingSet("Currently studying", [...studyingColl]);
  renderWorkingSet("Saved", [...savedColl].filter((k) => !studyingColl.has(k)));

  if (customCourses.length) {
    const sh = document.createElement("div");
    sh.className = "browse-subject";
    sh.innerHTML = "<span>My courses</span>";
    panel.appendChild(sh);
    customCourses.forEach((co) => {
      const item = document.createElement("button");
      item.type = "button"; item.className = "browse-deck";
      item.innerHTML = `<span>${escapeHtml(co.name)}</span><span class="browse-n">${courseSize(co)}</span>`;
      item.onclick = () => pick(() => studyCourse(co));
      panel.appendChild(item);
    });
  }

  // My library decks (+ the currently-open deck so you can switch back), grouped subject › topic
  const libDecks = library.filter((d) => myLib.has(d.id) || (currentDeck && d.id === currentDeck.id));
  if (libDecks.length) {
    const topicDecks = new Map();
    libDecks.forEach((d) => {
      const topics = (d.topics && d.topics.length) ? d.topics : [d.topic || "Imported / standalone"];
      topics.forEach((t) => { if (!topicDecks.has(t)) topicDecks.set(t, []); topicDecks.get(t).push(d); });
    });
    const bySubject = new Map();
    for (const t of topicDecks.keys()) { const subs = topicSubjectsArr(t); (subs.length ? subs : [""]).forEach((s) => { if (!bySubject.has(s)) bySubject.set(s, []); bySubject.get(s).push(t); }); }
    const shown = new Set();   // each deck once, even if it lives in several topics
    [...bySubject.keys()].sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b)).forEach((subject) => {
      const frag = document.createDocumentFragment(); let any = false;
      bySubject.get(subject).forEach((topic) => {
        const decks = topicDecks.get(topic).filter((d) => !shown.has(d.id));
        if (!decks.length) return;
        const th = document.createElement("div"); th.className = "browse-topic"; th.innerHTML = `<span>${escapeHtml(topic)}</span>`; frag.appendChild(th);
        decks.forEach((d) => {
          shown.add(d.id);
          const item = document.createElement("button");
          item.type = "button";
          item.className = "browse-deck" + (currentDeck && d.id === currentDeck.id ? " current" : "");
          item.innerHTML = `<span>${escapeHtml(d.name)}</span><span class="browse-n">${deckCount(d)}</span>`;
          item.onclick = () => pick(() => selectDeck(d.id));
          frag.appendChild(item);
        });
        any = true;
      });
      if (!any) return;
      if (subject) { const sh = document.createElement("div"); sh.className = "browse-subject"; sh.innerHTML = `<span>${escapeHtml(subject)}</span>`; panel.appendChild(sh); }
      panel.appendChild(frag);
    });
  }

  if (!studyingColl.size && !savedColl.size && !customCourses.length && !libDecks.length) {
    const p = document.createElement("p");
    p.className = "lib-empty"; p.style.padding = "8px 10px";
    p.textContent = "Your library is empty — open the Library and tap ⭐ to add decks here.";
    panel.appendChild(p);
  }

  const foot = document.createElement("button");
  foot.type = "button"; foot.className = "browse-foot";
  foot.textContent = "⌕ browse full library →";
  foot.onclick = () => pick(() => showTab("library"));
  panel.appendChild(foot);
}
function openBrowse() { const p = $("browsePanel"); if (p) { p.hidden = false; $("deckBrowse").setAttribute("aria-expanded", "true"); } }
function closeBrowse() { const p = $("browsePanel"); if (p) { p.hidden = true; $("deckBrowse").setAttribute("aria-expanded", "false"); } }

function renderNotice() {
  const notice = $("notice");
  if (fetchFailed && !library.some((d) => !d.imported)) {
    notice.hidden = false;
    notice.innerHTML = "Shipped sets load over http(s). Open the live demo, run a local server "
      + "(<code>python3 -m http.server</code>), use the offline build, or import a deck above.";
  } else {
    notice.hidden = true;
  }
}

/* ------------------------- deck building ------------------------ */
function rebuildDeck(resetToStart) {
  const previousFp = (deck.length && !resetToStart) ? currentDeck.cards[deck[position]].fp : null;
  deck = [];
  const now = Date.now();
  currentDeck.cards.forEach((card, index) => {
    if (currentCategory !== "all" && card.category !== currentCategory) return;
    if (srMode) {
      const st = sr[card.fp];
      if (st && st.due > now) return;                 // not due yet
    } else if ((focusLearning || shuffleMode) && marks[card.fp] === "known") {
      return;   // shuffle and focus both skip cards you've already mastered
    }
    deck.push(index);
  });
  if (srMode) {
    deck.sort((a, b) => {
      const da = sr[currentDeck.cards[a].fp], db = sr[currentDeck.cards[b].fp];
      return (da ? da.due : 0) - (db ? db.due : 0);   // most-overdue (and new) first
    });
  } else if (shuffleMode) {
    for (let i = deck.length - 1; i > 0; i--) {        // Fisher–Yates
      const j = Math.floor(Math.random() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
  }

  buildFilters();

  if (deck.length === 0) { renderEmpty(); updateProgress(); return; }

  if (previousFp) {
    const keep = deck.findIndex((index) => currentDeck.cards[index].fp === previousFp);   // by fp: dual twins share a term
    position = keep >= 0 ? keep : Math.min(position, deck.length - 1);
  } else {
    position = 0;
  }
  renderCard();
  updateProgress();
}

function buildFilters() {
  const box = $("filters");
  box.innerHTML = "";

  // study mode: flip (default) · quiz (auto-MCQ) · listen (audio-first). Listen needs audio/TTS.
  const deckSpeakable = !!(currentDeck.lang || currentDeck.cards.some((c) => c.audio));
  const modes = [["flip", "🃏 flip"], ["quiz", "🧠 quiz"], ["type", "✍️ type"]];
  if (deckSpeakable) modes.push(["listen", "🎧 listen"]);
  modes.forEach(([m, label]) => {
    const chip = makeChip(label, null, studyMode === m);
    chip.classList.add("toggle");
    chip.title = m === "quiz" ? "Multiple choice built from this deck's own cards"
      : m === "type" ? "Type the answer (fuzzy-graded)"
      : m === "listen" ? "Hear the sound, pick the symbol" : "Classic flip card";
    chip.onclick = () => setStudyMode(m);
    box.appendChild(chip);
  });
  const examBtn = document.createElement("button");
  examBtn.type = "button"; examBtn.className = "chip"; examBtn.textContent = "📝 exam";
  examBtn.title = "Timed test: up to 20 random questions, scored with a report";
  examBtn.onclick = () => startExam();
  box.appendChild(examBtn);
  const modeSep = document.createElement("span");
  modeSep.className = "sep";
  box.appendChild(modeSep);

  const categoryKeys = Object.keys(currentDeck.categories);
  if (categoryKeys.length > 1) {
    const all = makeChip("all", null, currentCategory === "all");
    all.onclick = () => setCategory("all");
    box.appendChild(all);
    categoryKeys.forEach((key) => {
      const category = currentDeck.categories[key];
      const chip = makeChip(category.label, category.color, currentCategory === key);
      chip.onclick = () => setCategory(key);
      box.appendChild(chip);
    });
    const separator = document.createElement("span");
    separator.className = "sep";
    box.appendChild(separator);
  }

  // study filters. SR governs order/filtering itself, so hide these when it's on.
  if (!srMode) {
    const focus = document.createElement("button");
    focus.className = "chip toggle" + (focusLearning ? " active" : "");
    focus.textContent = "focus: still learning";
    focus.onclick = () => { focusLearning = !focusLearning; rebuildDeck(true); };
    box.appendChild(focus);

    const shuf = document.createElement("button");
    shuf.className = "chip toggle" + (shuffleMode ? " active" : "");
    shuf.textContent = "🔀 shuffle";
    shuf.title = "Random order, skipping cards you've mastered (key: s)";
    shuf.onclick = () => setShuffleMode(!shuffleMode);
    box.appendChild(shuf);
  } else {
    const note = document.createElement("span");
    note.className = "dir-label";
    note.textContent = "⟳ spaced repetition on";
    box.appendChild(note);
  }
}

/* study mode: flip | quiz (auto-MCQ) | type (typed) | listen (audio-first). Persisted per deck. */
function setStudyMode(mode) {
  studyMode = mode;
  if (currentDeck && !currentDeck.virtual) Store.set(PREFIX + "mode:" + currentDeck.id, mode);   // virtual ids aren't persistable
  buildFilters();        // refresh active chip
  rebuildDeck(true);     // re-render the queue in the new mode
}

/* single place that flips shuffle (filter chip, settings, and the `s` key) */
function setShuffleMode(on) {
  shuffleMode = !!on;
  if (currentDeck && !currentDeck.virtual) Store.set(PREFIX + "shuffle:" + currentDeck.id, shuffleMode ? "1" : "0");
  if ($("setShuffle")) $("setShuffle").checked = shuffleMode;
  rebuildDeck(true);
}

function makeChip(label, color, active) {
  const chip = document.createElement("button");
  chip.className = "chip" + (active ? " active" : "");
  if (color) {
    const dot = document.createElement("i");
    dot.className = "cdot";
    dot.style.background = color;
    chip.appendChild(dot);
  }
  chip.appendChild(document.createTextNode(label));
  return chip;
}

/* ---------------------------- the card -------------------------- */
/* split an answer into a concept one-liner (lead) + the rest (shown on demand).
   Honours an explicit `summary`; otherwise takes a conservative first sentence. */
function splitLead(card) {
  if (card.summary) return { lead: card.summary, rest: card.definition };
  const text = card.definition;
  const m = text.match(/^([\s\S]{24,}?[.!?])\s+(?=[A-Z(“"$\\])/);
  if (m && m[1].length < text.length - 1) return { lead: m[1].trim(), rest: text.slice(m[1].length).trim() };
  return { lead: text, rest: "" };
}

/* an <img> for a card image (URL, relative path, or data: URI) */
function imageHtml(src, alt) {
  if (!src) return "";
  return `<img class="card-img" src="${escapeAttr(src)}" alt="${escapeAttr(alt || "")}" loading="lazy">`;
}

/* the answer block: one-liner + optional "more" + answer image + formula + note */
function explanationBlock(card, glFn) {
  const esc = glFn || escapeHtml;
  const parts = splitLead(card);
  let html = `<div class="lead">${linkify(esc(parts.lead))}</div>`;
  if (parts.rest) {
    html += `<button type="button" class="more-toggle">more ›</button>`
      + `<div class="more" hidden>${linkify(esc(parts.rest))}</div>`;
  }
  if (card.answerImage) html += imageHtml(card.answerImage, card.term);
  if (card.formula) html += `<div class="formula">${escapeHtml(card.formula)}</div>`;
  if (card.note) html += `<div class="note"><span class="mk">→</span><span>${linkify(esc(card.note))}</span></div>`;
  return html;
}

/* name ↔ description direction for a flip card — a per-card `dir` overrides the
   deck-level setting; "shuffle" picks at random per render. */
function resolveDirection(card) {
  const deckDefault = (currentDeck && currentDeck.defaultDir) || "forward";
  const setting = (cardDir === "default") ? deckDefault : cardDir;   // ask: "default" follows the deck
  const d = (card && card.dir) ? card.dir : setting;                 // a per-card pin still wins
  if (d === "shuffle") return (Math.random() < 0.5) ? "reverse" : "forward";
  return d === "reverse" ? "reverse" : "forward";
}

/* speak the term via the browser's speech synthesis (TTS) in the card/deck language */
function speakTTS(card) {
  if (!("speechSynthesis" in window)) return;
  const lang = card.lang || (currentDeck && currentDeck.lang) || "";
  const utterance = new SpeechSynthesisUtterance(card.say || card.term);
  if (lang) {
    utterance.lang = lang;
    const voice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(lang.toLowerCase()));
    if (voice) utterance.voice = voice;
  }
  try { speechSynthesis.cancel(); speechSynthesis.speak(utterance); } catch (e) { /* ignore */ }
}

/* play a card's pronunciation: an explicit audio file if provided, else TTS.
   Wikimedia files are Ogg (Safari can't play them), so fall back to TTS on error. */
function speakCard(card) {
  if (card.audio) {
    try {
      const audio = new Audio(card.audio);
      audio.addEventListener("error", () => speakTTS(card));   // unsupported format / network → TTS
      const played = audio.play();
      if (played && played.catch) played.catch(() => speakTTS(card));
      return;
    } catch (e) { /* fall through to TTS */ }
  }
  speakTTS(card);
}
/* reverse answer: the NAME (term) is the answer to a description prompt */
function answerBlockReverse(card, glFn) {
  const esc = glFn || escapeHtml;
  let html = `<div class="lead name-answer">${linkify(esc(card.term))}</div>`;
  if (card.answerImage) html += imageHtml(card.answerImage, card.term);
  if (card.formula) html += `<div class="formula">${escapeHtml(card.formula)}</div>`;
  if (card.note) html += `<div class="note"><span class="mk">→</span><span>${linkify(esc(card.note))}</span></div>`;
  return html;
}
function wireExplanation(container) {
  if (!container) return;
  const toggle = container.querySelector(".more-toggle");
  const more = container.querySelector(".more");
  if (!toggle || !more) return;
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const show = more.hidden;
    more.hidden = !show;
    toggle.textContent = show ? "less ‹" : "more ›";
    if (show) typesetMath(more);
  });
}

/* Auto-MCQ: turn a plain flip card into a multiple-choice question on the fly,
   drawing distractors from sibling cards — preferring ones the note flags as
   confusable (e.g. "looks like ツ"), then same-category, then the rest.
   mode "quiz": prompt is the card's prompt side. mode "listen": prompt is audio. */
function buildQuiz(card, dir, mode, speakable) {
  const listen = mode === "listen" && speakable;
  const wantTerm = listen || dir === "reverse";          // answer is the symbol (term)?
  const answer = (wantTerm ? card.term : card.definition).trim();
  if (!answer) return null;
  const seen = new Set([answer]);
  const priority = [], sameCat = [], otherCat = [];
  for (const sib of currentDeck.cards) {
    if (sib.fp.replace(/[fr]$/, "") === card.fp.replace(/[fr]$/, "")) continue;   // skip self + its dual twin (by fp, not term)
    const text = (wantTerm ? sib.term : sib.definition).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    if (card.note && sib.term && card.note.indexOf(sib.term) >= 0) priority.push(text);   // annotated confusable
    else if (card.category && sib.category === card.category) sameCat.push(text);
    else otherCat.push(text);
  }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const distractors = priority.concat(shuffle(sameCat), shuffle(otherCat)).slice(0, 3);
  if (!distractors.length) return null;                   // need at least one alternative
  return {
    kind: "mcq", quiz: true, mode: listen ? "listen" : "quiz", dir,
    choices: [answer].concat(distractors), answer: 0,     // correct lives at data-index 0
    promptText: listen ? "" : (wantTerm ? card.definition : card.term),
    promptGlyph: !wantTerm && card.term.trim().length <= 6,   // forward prompt is a short glyph
    ask: listen ? "symbol" : (wantTerm ? "symbol" : "sound"),
  };
}

/* math helpers, GRAPH_RECIPES, buildGraph, injectCardGraph, injectFrontGraph: graphs.js (loaded before app.js) */

function renderCard() {
  const card = currentDeck.cards[deck[position]];
  const meta = (card.category && currentDeck.categories[card.category]) || { label: "", color: currentDeck.accent };
  isFlipped = false;
  const speakable = !!(currentDeck.lang || card.lang || card.audio);
  const flipDir = card.q ? null : resolveDirection(card);   // compute once (avoid double-randomising)
  activeQuiz = (!card.q && (studyMode === "quiz" || studyMode === "listen") && currentDeck.cards.length >= 2)
    ? buildQuiz(card, flipDir, studyMode, speakable) : null;
  activeType = (!card.q && !activeQuiz && studyMode === "type")
    ? { answer: flipDir === "reverse" ? card.term : card.definition, wantTerm: flipDir === "reverse" } : null;
  const q = activeQuiz || card.q;

  const labelMarkup = meta.label
    ? `<span class="cdot"></span><span class="cat-label">${escapeHtml(meta.label)}</span>` : "";

  let frontExtra, termText = card.term, kindClass = "", answerHtml = null;

  const gl = (currentDeck && currentDeck.glossary) || {};
  const glossRefs = new Map();
  const glApply = (text) => {
    const { html, refs } = applyGlossary(text, gl);
    refs.forEach(({ term, def }) => { if (!glossRefs.has(term)) glossRefs.set(term, def); });
    return html;
  };

  // each button keeps its TRUE index in data-index; the label/position follow the
  // (optionally shuffled) display order, so option order can be randomised per render.
  const optButtons = (choices, order, keyFn) => order.map((trueIdx, disp) =>
    `<button type="button" class="mcq-opt" data-index="${trueIdx}">`
    + `<span class="mcq-key">${keyFn(disp)}</span>`
    + `<span class="mcq-text">${linkify(glApply(choices[trueIdx]))}</span></button>`).join("");
  const shuffledOrder = (n) => {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };

  if (activeQuiz) {
    kindClass = " mcq quizcard";
    const order = shuffledOrder(activeQuiz.choices.length);
    const opts = optButtons(activeQuiz.choices, order, (d) => String.fromCharCode(65 + d));
    if (activeQuiz.mode === "listen") {
      termText = "";
      frontExtra = `<button type="button" class="listen-prompt" id="listenPlay" title="replay (R)">🔊</button>`
        + `<div class="choices">${opts}</div>`
        + `<div class="hint" id="qHint">listen · pick the symbol · R replays</div>`;
    } else {
      termText = activeQuiz.promptText;
      if (activeQuiz.promptGlyph) kindClass += " quizglyph";
      frontExtra = `<div class="choices">${opts}</div>`
        + `<div class="hint" id="qHint">pick the ${activeQuiz.ask} · keys 1–${activeQuiz.choices.length}</div>`;
    }
  } else if (q && (q.kind === "mcq" || q.kind === "boolean")) {
    kindClass = " mcq";
    // shuffle MCQ options every render to defeat positional memory; keep True/False fixed
    const order = q.kind === "boolean" ? [0, 1] : shuffledOrder(q.choices.length);
    const opts = optButtons(q.choices, order, q.kind === "boolean" ? (d => d === 0 ? "T" : "F") : (d => String.fromCharCode(65 + d)));
    const hint = q.kind === "boolean" ? "true or false · keys T / F" : "pick an answer · keys 1–" + q.choices.length;
    frontExtra = `<div class="choices">${opts}</div><div class="hint" id="qHint">${hint}</div>`;
  } else if (q && q.kind === "multi") {
    kindClass = " mcq multi";
    frontExtra = `<div class="choices">${optButtons(q.choices, shuffledOrder(q.choices.length), d => String.fromCharCode(65 + d))}</div>`
      + `<button type="button" class="solid-btn mcq-check" id="multiCheck">check</button>`
      + `<div class="hint" id="qHint">select all that apply · then check</div>`;
  } else if (q && q.kind === "cloze") {
    kindClass = " mcq cloze";
    termText = "";
    frontExtra = `<div class="cloze-sentence">${linkify(glApply(q.display)).replace("____", '<span class="cloze-blank">____</span>')}</div>`
      + `<input type="text" class="cloze-input" id="clozeInput" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="type the missing term">`
      + `<button type="button" class="solid-btn mcq-check" id="clozeCheck">check</button>`
      + `<div class="hint" id="qHint">fill the blank · enter to check</div>`;
  } else if (activeType) {
    kindClass = " mcq typecard";
    termText = activeType.wantTerm ? "" : card.term;
    if (!activeType.wantTerm && card.term.trim().length <= 6) kindClass += " quizglyph";
    frontExtra = (activeType.wantTerm ? `<div class="prompt-desc">${linkify(glApply(card.definition))}</div>` : "")
      + `<input type="text" class="cloze-input" id="typeInput" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="type the answer">`
      + `<button type="button" class="solid-btn mcq-check" id="typeCheck">check</button>`
      + `<div class="hint" id="qHint">type the ${activeType.wantTerm ? "symbol" : "answer"} · enter to check</div>`;
  } else {
    const dir = flipDir;   // name ↔ description (per-card override wins)
    if (dir === "reverse") {
      kindClass = " reverse";
      termText = "";
      frontExtra = `<div class="prompt-desc">${linkify(glApply(card.definition))}</div>`
        + `<div class="hint">name it · space to reveal</div>`;
      answerHtml = answerBlockReverse(card, glApply);
    } else {
      const subMarkup = card.sub ? `<div class="sub">${escapeHtml(card.sub)}</div>` : "";
      frontExtra = `${subMarkup}<div class="hint">tap to reveal · space</div>`;
    }
  }

  if (answerHtml === null) answerHtml = explanationBlock(card, glApply);
  const frontImage = card.image ? imageHtml(card.image, card.term) : "";
  if (frontImage) kindClass += " has-image";   // compact the prompt, give the image room
  // short-symbol cards (alphabets, single glyphs) render big & centered, identically both directions
  if (!q && !activeType && !frontImage && card.term.trim().length <= 6) kindClass += " glyphcard";
  const termMarkup = termText ? `<div class="term">${glApply(termText)}</div>` : "";
  const speakMarkup = (speakable && !activeQuiz)   // quiz/listen has its own audio affordance
    ? `<button type="button" class="speak-btn" id="speakBtn" title="play pronunciation" aria-label="play pronunciation">🔊</button>` : "";

  host.innerHTML = `
    <div class="stage">
      <div class="card${kindClass}" id="card" tabindex="0" role="button" aria-pressed="false"
           aria-label="Flashcard. ${escapeAttr(card.term)}" style="--cat:${meta.color}">
        ${speakMarkup}
        <div class="card-inner">
          <div class="face front">
            <div class="cat-row">${labelMarkup}</div>
            ${termMarkup}
            ${frontImage}
            ${frontExtra}
          </div>
          <div class="face back">
            <div class="cat-row">${labelMarkup}</div>
            <div class="answer">${answerHtml}</div>
          </div>
        </div>
      </div>
    </div>`;

  if (glossRefs.size > 0) {
    const panel = document.createElement("div");
    panel.className = "gloss-panel";
    glossRefs.forEach((def, term) => {
      const span = document.createElement("span");
      span.className = "gloss-entry";
      span.innerHTML = `<b>${escapeHtml(term)}</b> — ${escapeHtml(def)}`;
      panel.appendChild(span);
    });
    host.appendChild(panel);
  }

  const cardElement = $("card");
  if (!q && !activeType) {
    // plain flip cards flip on click; interactive cards reveal inline instead
    cardElement.addEventListener("click", (event) => {
      if (event.target.closest("a") || event.target.closest(".more-toggle") || event.target.closest(".speak-btn") || event.target.closest(".card-graph")) return;
      toggleFlip();
    });
    wireExplanation(cardElement.querySelector(".back .answer"));
  }
  if (activeType) {
    const input = $("typeInput");
    $("typeCheck").addEventListener("click", (e) => { e.stopPropagation(); submitType(); });
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitType(); } });
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 30);
  }
  const speakBtn = $("speakBtn");
  if (speakBtn) speakBtn.addEventListener("click", (e) => { e.stopPropagation(); speakCard(card); });

  if (activeQuiz && activeQuiz.mode === "listen") {
    const playBtn = $("listenPlay");
    if (playBtn) playBtn.addEventListener("click", (e) => { e.stopPropagation(); speakCard(card); });
    setTimeout(() => speakCard(card), 130);   // auto-play the prompt sound on render
  }

  if (q && (q.kind === "mcq" || q.kind === "boolean")) {
    cardElement.querySelectorAll(".mcq-opt").forEach((btn) =>
      btn.addEventListener("click", (e) => { e.stopPropagation(); answerSingle(parseInt(btn.dataset.index, 10)); }));
  } else if (q && q.kind === "multi") {
    cardElement.querySelectorAll(".mcq-opt").forEach((btn) =>
      btn.addEventListener("click", (e) => { e.stopPropagation(); if (cardElement.dataset.answered !== "1") btn.classList.toggle("picked"); }));
    $("multiCheck").addEventListener("click", (e) => { e.stopPropagation(); submitMulti(); });
  } else if (q && q.kind === "cloze") {
    const input = $("clozeInput");
    $("clozeCheck").addEventListener("click", (e) => { e.stopPropagation(); submitCloze(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitCloze(); } });
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 30);
  }

  typesetMath(cardElement);             // render any $...$ / $$...$$
  if (card.frontGraph) injectFrontGraph(card.frontGraph, cardElement);
  if (card.graph) injectCardGraph(card.graph, cardElement);
  $("controls").style.display = "flex";
  const flipBtn = $("flip");                    // interactive cards reveal ("show") instead of flipping
  flipBtn.style.display = "";
  flipBtn.innerHTML = ((q || activeType) ? "show" : "flip") + ' <span class="k">space</span>';
  $("markRow").style.display = "flex";
  updateCounter();
  updateMarkButtons();
}

function renderEmpty() {
  const caughtUp = srMode && currentDeck && currentDeck.cards.length;
  host.innerHTML = caughtUp
    ? `<div class="empty"><h2>all caught up</h2>
        <p>No cards are due right now. Come back later, or turn off <b>spaced repetition</b> to keep drilling.</p></div>`
    : `<div class="empty"><h2>nothing left here</h2>
        <p>Every card in this filter is marked <b>got it</b>. Switch section, turn off the focus filter, or reset progress to keep going.</p></div>`;
  $("controls").style.display = "none";
  $("markRow").style.display = "none";
  updateCounter();
}

function renderNoDecks() {
  const hasLibrary = library.length > 0;
  $("deckName").textContent = hasLibrary ? "nothing open yet" : "no decks loaded";
  $("deckMeta").textContent = "";
  $("appEyebrow").textContent = "// start";
  $("progressWrap").style.display = "none";
  host.innerHTML = hasLibrary
    ? `<div class="empty">
      <h2>pick something to study</h2>
      <p>Open the <b>library</b> to choose a deck, topic, subject or course — or jump back into a saved or in-progress set.</p>
      <button type="button" class="ghost-btn" id="goLibrary">browse the library →</button>
    </div>`
    : `<div class="empty">
      <h2>load a set to begin</h2>
      <p>Serve this folder over http (<code>python3 -m http.server</code>) to load the shipped sets, open the offline build, or use <b>import</b> above to paste your own.</p>
    </div>`;
  const go = $("goLibrary"); if (go) go.onclick = () => showTab("library");
  $("controls").style.display = "none";
  $("markRow").style.display = "none";
  $("filters").innerHTML = "";
}

/* ------------------------------ actions ------------------------- */
function toggleFlip() {
  const cardElement = $("card");
  if (!cardElement) return;
  isFlipped = !isFlipped;
  cardElement.classList.toggle("flipped", isFlipped);
  cardElement.setAttribute("aria-pressed", String(isFlipped));
}

function move(step) {
  if (deck.length === 0) return;
  const cardEl = $("card");
  if (srMode && cardEl && cardEl.dataset.answered === "1") { rebuildDeck(true); return; }  // re-pull the due queue
  position = (position + step + deck.length) % deck.length;
  renderCard();
}

function setCategory(key) {
  currentCategory = key;
  if (currentDeck && !currentDeck.virtual) Store.set(PREFIX + "filter:" + currentDeck.id, key);
  rebuildDeck(true);
}

/* streak: record any day the user marks a card; count consecutive days back from today */
function dayStr(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function recordStudyDay() {
  const t = dayStr(new Date());
  if (studyDays.includes(t)) return;
  studyDays.push(t);
  studyDays = studyDays.slice(-400);
  Store.set(PREFIX + "days", JSON.stringify(studyDays));
}
function computeStreak() {
  const set = new Set(studyDays);
  const d = new Date();
  if (!set.has(dayStr(d))) d.setDate(d.getDate() - 1);   // today not studied yet → count up to yesterday
  let streak = 0;
  while (set.has(dayStr(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

/* persist a card's mark to the right store: the owner deck when studying a virtual
   (cross-deck) deck, else the current deck. Keeps cross-deck progress shared. */
function persistCardMark(card) {
  if (currentDeck.virtual && card._owner) {
    const m = ownerMarks[card._owner] || (ownerMarks[card._owner] = {});
    if (marks[card.fp]) m[card.fp] = marks[card.fp]; else delete m[card.fp];
    Store.set(PREFIX + "marks:" + card._owner, JSON.stringify(m));
  } else {
    Store.set(PREFIX + "marks:" + currentDeck.id, JSON.stringify(marks));
  }
}

function markCurrent(status) {
  if (deck.length === 0 || !currentDeck) return;
  recordStudyDay();
  const card = currentDeck.cards[deck[position]];
  marks[card.fp] = (marks[card.fp] === status) ? null : status;
  if (!marks[card.fp]) delete marks[card.fp];
  persistCardMark(card);
  if (srMode && marks[card.fp]) scheduleSR(card.fp, marks[card.fp] === "known");
  if (focusLearning && status === "known") rebuildDeck(false);
  else { updateMarkButtons(); updateProgress(); }
}

/* set a mark directly (no toggle) — used by auto-grading. Deliberately skips the
   focus-rebuild so the answer + explanation stay on screen until the user moves
   on; the mark buttons / keys 1–2 still override via markCurrent. */
function setMark(status) {
  if (deck.length === 0 || !currentDeck) return;
  recordStudyDay();
  const card = currentDeck.cards[deck[position]];
  marks[card.fp] = status;
  persistCardMark(card);
  if (srMode) scheduleSR(card.fp, status === "known");
  updateMarkButtons();
  updateProgress();
}

/* SM-2-lite: a correct answer pushes the next review out (days), a wrong one
   brings it back almost immediately (~1 min, so it recurs within the session). */
function scheduleSR(term, correct) {
  const now = Date.now();
  const st = sr[term] || { ease: 2.5, reps: 0, interval: 0, due: now };
  if (correct) {
    st.reps += 1;
    if (st.reps === 1) st.interval = SR_DAY;
    else if (st.reps === 2) st.interval = 4 * SR_DAY;
    else st.interval = Math.round(st.interval * st.ease);
    st.ease = Math.min(2.8, st.ease + 0.02);
  } else {
    st.reps = 0;
    st.interval = 1;                       // ~1 minute — re-surfaces this session
    st.ease = Math.max(1.3, st.ease - 0.2);
  }
  st.due = now + st.interval * 60000;
  sr[term] = st;
  if (currentDeck) Store.set(PREFIX + "sr:" + currentDeck.id, JSON.stringify(sr));
}

/* reveal the explanation, mark answered, and auto-grade (override-able). */
function revealAndGrade(cardElement, card, correct, shown) {
  cardElement.dataset.answered = "1";
  const hint = $("qHint");
  if (hint) hint.remove();
  // the definition may start "Correct: C)" using the DATA order; options are shown
  // shuffled, so rewrite that letter to the correct option's DISPLAYED position.
  let shownCard = card;
  const opts = [...cardElement.querySelectorAll(".mcq-opt")];
  const corrPos = opts.findIndex((b) => b.classList.contains("correct"));
  if (corrPos >= 0 && card.q && card.q.kind === "mcq" && /^\s*Correct:\s*[A-Da-d]\)/.test(card.definition)) {
    shownCard = Object.assign({}, card, {
      definition: card.definition.replace(/^(\s*Correct:\s*)[A-Da-d]\)/, "$1" + String.fromCharCode(65 + corrPos) + ")"),
    });
  }
  const reveal = document.createElement("div");
  reveal.className = "mcq-reveal " + (shown ? "no" : (correct ? "ok" : "no"));
  const verdict = shown ? "↻ answer shown — still learning" : (correct ? "✓ correct" : "✗ not quite");
  reveal.innerHTML = `<div class="mcq-verdict">${verdict}</div>`
    + `<div class="answer">${explanationBlock(shownCard)}</div>`;
  cardElement.querySelector(".face.front").appendChild(reveal);
  wireExplanation(reveal.querySelector(".answer"));
  typesetMath(reveal);
  setMark(shown ? "learning" : (correct ? "known" : "learning"));   // auto-grade; override with the mark buttons
}

/* "show" on an interactive card: reveal the right answer without picking, and
   mark it still-learning (you didn't recall it). */
function showAnswer() {
  const cardElement = $("card");
  if (!cardElement) return;
  const card = currentDeck.cards[deck[position]];
  if (activeType) { submitType(); return; }    // type mode reveals via its own path
  const q = activeQuiz || card.q;
  if (!q) { toggleFlip(); return; }            // plain card: just flip
  if (cardElement.dataset.answered === "1") return;
  if (q.kind === "mcq" || q.kind === "boolean") {
    const ai = (q.kind === "boolean") ? (q.answer ? 0 : 1) : q.answer;
    cardElement.querySelectorAll(".mcq-opt").forEach((b) => { b.disabled = true; if (parseInt(b.dataset.index, 10) === ai) b.classList.add("correct"); });
  } else if (q.kind === "multi") {
    cardElement.querySelectorAll(".mcq-opt").forEach((b) => { b.disabled = true; b.classList.remove("picked"); if (q.answers.indexOf(parseInt(b.dataset.index, 10)) >= 0) b.classList.add("correct"); });
    const check = $("multiCheck"); if (check) check.remove();
  } else if (q.kind === "cloze") {
    const input = $("clozeInput"); if (input) input.disabled = true;
    fillClozeBlank(cardElement, q.answer);
    const check = $("clozeCheck"); if (check) check.remove();
  }
  revealAndGrade(cardElement, card, false, true);
}

/* single-best MCQ + true/false */
function answerSingle(index) {
  const cardElement = $("card");
  if (!cardElement || cardElement.dataset.answered === "1") return;
  const card = currentDeck.cards[deck[position]];
  const q = activeQuiz || card.q;
  if (!q || (q.kind !== "mcq" && q.kind !== "boolean") || index < 0 || index >= q.choices.length) return;
  const answerIndex = (q.kind === "boolean") ? (q.answer ? 0 : 1) : q.answer;
  const correct = index === answerIndex;
  cardElement.querySelectorAll(".mcq-opt").forEach((btn) => {   // match by TRUE index (display is shuffled)
    btn.disabled = true;
    const ti = parseInt(btn.dataset.index, 10);
    if (ti === answerIndex) btn.classList.add("correct");
    if (ti === index && !correct) btn.classList.add("wrong");
  });
  revealAndGrade(cardElement, card, correct);
}

/* multi-select: correct only when the picked set equals the answer set */
function submitMulti() {
  const cardElement = $("card");
  if (!cardElement || cardElement.dataset.answered === "1") return;
  const card = currentDeck.cards[deck[position]];
  const q = card.q;
  if (!q || q.kind !== "multi") return;
  const picked = [];
  cardElement.querySelectorAll(".mcq-opt").forEach((btn) => { if (btn.classList.contains("picked")) picked.push(parseInt(btn.dataset.index, 10)); });
  const want = q.answers;
  const correct = picked.length === want.length && want.every((i) => picked.indexOf(i) >= 0);
  cardElement.querySelectorAll(".mcq-opt").forEach((btn) => {
    btn.disabled = true;
    const ti = parseInt(btn.dataset.index, 10);
    const inAns = want.indexOf(ti) >= 0, inPick = picked.indexOf(ti) >= 0;
    if (inAns && inPick) btn.classList.add("correct");
    else if (inPick && !inAns) btn.classList.add("wrong");
    else if (inAns && !inPick) btn.classList.add("missed");
    btn.classList.remove("picked");
  });
  const check = $("multiCheck");
  if (check) check.remove();
  revealAndGrade(cardElement, card, correct);
}

/* cloze: compare the typed term to the answer (case/space/punct-insensitive) */
function submitCloze() {
  const cardElement = $("card");
  if (!cardElement || cardElement.dataset.answered === "1") return;
  const card = currentDeck.cards[deck[position]];
  const q = card.q;
  if (!q || q.kind !== "cloze") return;
  const input = $("clozeInput");
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").replace(/[.,;:%]+$/, "").trim();
  const correct = input.value.trim() !== "" && norm(input.value) === norm(q.answer);
  input.disabled = true;
  input.classList.add(correct ? "correct" : "wrong");
  fillClozeBlank(cardElement, q.answer);
  const check = $("clozeCheck");
  if (check) check.remove();
  revealAndGrade(cardElement, card, correct);
}

/* type-to-answer: normalise (lowercase, strip accents/punctuation) and compare;
   for non-latin answers (a glyph) compare the trimmed text exactly. */
function gradeTyped(input, answer) {
  const latin = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
  const i = latin(input), a = latin(answer), core = latin(String(answer).split(" (")[0]);
  if (a) return i.length > 0 && (i === a || (core && i === core));
  return input.trim() !== "" && input.trim() === String(answer).trim();   // glyph answer
}
function submitType() {
  const cardElement = $("card");
  if (!cardElement || cardElement.dataset.answered === "1" || !activeType) return;
  const card = currentDeck.cards[deck[position]];
  const input = $("typeInput");
  const val = input ? input.value : "";
  const shown = val.trim() === "";
  const correct = !shown && gradeTyped(val, activeType.answer);
  if (input) { input.disabled = true; input.classList.add(correct ? "correct" : "wrong"); if (!correct) input.value = activeType.answer; }
  const check = $("typeCheck"); if (check) check.remove();
  revealAndGrade(cardElement, card, correct, shown);
}

/* fill the cloze blank with the answer, targeting the dedicated placeholder span
   (robust to KaTeX-rendered HTML / repeated text); falls back to a plain replace. */
function fillClozeBlank(cardElement, answer) {
  const fill = `<span class="cloze-fill">${escapeHtml(answer)}</span>`;
  const blank = cardElement.querySelector(".cloze-blank");
  if (blank) { blank.outerHTML = fill; return; }   // replace the placeholder, don't nest inside it
  const sentence = cardElement.querySelector(".cloze-sentence");
  if (sentence) sentence.innerHTML = sentence.innerHTML.replace("____", fill);
}

async function resetProgress() {
  if (!currentDeck) return;
  if (!confirm("Reset progress for this deck? Clears every mark.")) return;
  marks = {};
  await Store.set(PREFIX + "marks:" + currentDeck.id, JSON.stringify(marks));
  focusLearning = false;
  rebuildDeck(true);
}

/* --------------------------- indicators ------------------------- */
function updateCounter() {
  if (deck.length) document.title = `${position + 1}/${deck.length} · ${currentDeck.name} · ${currentBrandName}`;
  else document.title = currentBrandName + " — flashcards";
}
function updateMarkButtons() {
  const card = currentDeck.cards[deck[position]];
  const status = marks[card.fp] || null;
  $("markLearn").classList.toggle("on-learn", status === "learning");
  $("markKnown").classList.toggle("on-known", status === "known");
}
function updateProgress() {
  if (!currentDeck) return;
  let known = 0, learning = 0;
  currentDeck.cards.forEach((card) => {
    if (marks[card.fp] === "known") known++;
    else if (marks[card.fp] === "learning") learning++;
  });
  const total = currentDeck.cards.length || 1;
  $("segKnown").style.width = (known / total * 100) + "%";
  $("segLearn").style.width = (learning / total * 100) + "%";
  $("cntKnown").textContent = known;
  $("cntLearn").textContent = learning;
  $("cntNew").textContent = total - known - learning;
}

/* ------------------------------ import -------------------------- */
function openImport() { $("importPanel").hidden = false; $("importError").textContent = ""; $("importText").focus(); }
function closeImport() { $("importPanel").hidden = true; $("importText").value = ""; $("importError").textContent = ""; }
function importError(message) { $("importError").textContent = message; }

/* split CSV/TSV text into rows of fields (handles quoted fields + escaped quotes) */
function parseDelimitedRows(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";
  const delim = firstLine.indexOf("\t") >= 0 ? "\t" : ",";
  const rows = []; let row = [], field = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuote = false; }
      else field += c;
    } else if (c === '"') { inQuote = true; }
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}
/* a CSV/TSV pasted/dropped deck → {name, cards}. Honours a term/definition header
   row if present, else takes column 1 = term, 2 = definition, 3 = note. */
function parseDelimited(text) {
  const rows = parseDelimitedRows(text);
  if (rows.length < 1) return null;
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (names) => head.findIndex((h) => names.indexOf(h) >= 0);
  let ti = find(["term", "front", "question", "word", "symbol", "kanji"]);
  let di = find(["definition", "back", "answer", "meaning", "reading", "translation"]);
  let ni = find(["note", "hint", "example"]);
  let start = 0;
  if (ti >= 0 && di >= 0) start = 1; else { ti = 0; di = 1; ni = 2; }   // no header → positional
  const cards = [];
  for (let r = start; r < rows.length; r++) {
    const term = (rows[r][ti] || "").trim();
    const def = (rows[r][di] || "").trim();
    if (!term || !def) continue;
    const card = { term, definition: def };
    if (ni >= 0 && rows[r][ni] && rows[r][ni].trim()) card.note = rows[r][ni].trim();
    cards.push(card);
  }
  return cards.length ? { name: "Imported deck", cards } : null;
}

function importFromText(text) {
  let raw;
  try { raw = JSON.parse(text); }
  catch (error) {
    raw = parseDelimited(text);   // not JSON? accept CSV / TSV (term,definition[,note])
    if (!raw) { importError("Couldn't parse that. Paste a deck/set as JSON, or a CSV/TSV with term,definition columns."); return; }
  }

  let deckRaws = [];
  let topicName = null;
  if (raw && Array.isArray(raw.decks)) {
    topicName = raw.topic || raw.set || raw.name || null;
    deckRaws = raw.decks.filter((d) => d && Array.isArray(d.cards));
    if (!deckRaws.length) { importError("This set has no inline decks. Pasted sets must include decks with cards (deckFiles can't be fetched)."); return; }
  } else if (raw && Array.isArray(raw.cards)) {
    deckRaws = [raw];
  } else {
    importError('Couldn\'t find a deck (needs "cards") or a set (needs "decks").'); return;
  }

  let firstId = null;
  deckRaws.forEach((d) => {
    if (topicName && !d.topic) d.topic = topicName;
    const normalized = normalizeDeck(d, "imported-" + Date.now().toString(36));
    if (!normalized.cards.length) return;
    if (library.find((x) => x.id === normalized.id)) normalized.id = normalized.id + "-" + Date.now().toString(36);
    d.id = normalized.id;
    addDeck(normalized, { imported: true, topic: normalized.topic });
    importedRaw.push(d);
    if (!firstId) firstId = normalized.id;
  });

  if (!firstId) { importError("No usable cards found. Each card needs a term and a definition."); return; }
  Store.set(PREFIX + "imported", JSON.stringify(importedRaw));
  renderNotice();
  renderDeckPicker();
  selectDeck(firstId);
  closeImport();
}

function downloadCurrentDeck() {
  if (!currentDeck) return;
  const blob = new Blob([deckToJson(currentDeck)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = currentDeck.id + ".json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function removeCurrentDeck() {
  if (!currentDeck || !currentDeck.imported) return;
  if (!confirm(`Remove imported deck "${currentDeck.name}"? Its progress is cleared too.`)) return;
  const removedId = currentDeck.id;
  importedRaw = importedRaw.filter((raw) => raw.id !== removedId);
  Store.set(PREFIX + "imported", JSON.stringify(importedRaw));
  Store.set(PREFIX + "marks:" + removedId, JSON.stringify({}));
  library = library.filter((d) => d.id !== removedId);
  renderDeckPicker();
  if (library.length) selectDeck(library[0].id);
  else { currentDeck = null; renderNoDecks(); }
}

/* ------------------------------ wiring -------------------------- */
$("prev").onclick = () => move(-1);
$("next").onclick = () => move(1);
$("flip").onclick = () => {
  const card = (currentDeck && deck.length) ? currentDeck.cards[deck[position]] : null;
  if (card && (card.q || activeQuiz || activeType)) showAnswer(); else toggleFlip();
};
$("markLearn").onclick = () => markCurrent("learning");
$("markKnown").onclick = () => markCurrent("known");
$("reset").onclick = resetProgress;
$("exportDeck").onclick = downloadCurrentDeck;
$("exportProgress").onclick = exportProgress;
$("importProgressFile").onchange = (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importProgressFromText(String(reader.result));
  reader.onerror = () => alert("Could not read that file.");
  reader.readAsText(file);
  event.target.value = "";
};
$("removeDeck").onclick = removeCurrentDeck;
$("deckBrowse").onclick = (event) => { event.stopPropagation(); $("browsePanel").hidden ? openBrowse() : closeBrowse(); };
document.addEventListener("click", (event) => { if (!event.target.closest(".picker")) closeBrowse(); });

/* ---- deck settings panel (personal, per-deck) ---- */
/* settings is a dedicated page (view); populate it from the current deck on show */
function syncSettings() {
  if (!currentDeck) return;
  $("setDeckName").textContent = currentDeck.name;
  $("setSr").checked = srMode;
  $("setShuffle").checked = shuffleMode;
  $("setDir").value = cardDir;
}
$("settingsToggle").onclick = () => showTab("settings");
$("settingsClose").onclick = () => showTab("study");
$("setSr").onchange = (e) => {
  srMode = e.target.checked;
  if (srMode) { focusLearning = false; srUser = true; Store.set(PREFIX + "sr-user", "1"); }
  if (currentDeck) Store.set(PREFIX + "sr-on:" + currentDeck.id, srMode ? "1" : "0");
  rebuildDeck(true);
};
$("setShuffle").onchange = (e) => setShuffleMode(e.target.checked);
$("setDir").onchange = (e) => {
  cardDir = e.target.value;
  if (currentDeck) Store.set(PREFIX + "dir:" + currentDeck.id, cardDir);
  rebuildDeck(false);
};

/* "add this deck to spaced repetition?" prompt (shown to SR users on undecided decks) */
$("srPromptYes").onclick = () => {
  if (!currentDeck) return;
  srMode = true; focusLearning = false;
  Store.set(PREFIX + "sr-on:" + currentDeck.id, "1");
  $("srPrompt").hidden = true;
  rebuildDeck(false);   // enable SR but stay on the current card (don't jump)
};
$("srPromptNo").onclick = () => {
  if (currentDeck) Store.set(PREFIX + "sr-on:" + currentDeck.id, "0");   // decided: no
  $("srPrompt").hidden = true;
};

$("primerStart").onclick = () => closePrimer(true);
$("primerSkip").onclick = () => closePrimer(true);
$("primerOpen").onclick = () => showPrimer();
$("primerPromptYes").onclick = async () => {
  $("primerPrompt").hidden = true;
  if (currentDeck) await Store.set(PREFIX + "primer-seen:" + primerKey(currentDeck), "1");   // decided
  showPrimer();
};
$("primerPromptNo").onclick = async () => {
  $("primerPrompt").hidden = true;
  if (currentDeck && currentDeck.primer) await Store.set(PREFIX + "primer-seen:" + primerKey(currentDeck), "1");
};

$("importToggle").onclick = () => { $("importPanel").hidden ? openImport() : closeImport(); };
$("importCancel").onclick = closeImport;
$("importLoad").onclick = () => importFromText($("importText").value);
$("importFile").onchange = (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importFromText(String(reader.result));
  reader.onerror = () => importError("Could not read that file.");
  reader.readAsText(file);
  event.target.value = "";
};

document.addEventListener("keydown", (event) => {
  const tag = event.target && event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if (exam) {                              // during an exam: number/letter keys pick the displayed option
    let disp = -1;
    if (/^[1-9]$/.test(event.key)) disp = parseInt(event.key, 10) - 1;
    else if (/^[a-zA-Z]$/.test(event.key)) disp = event.key.toUpperCase().charCodeAt(0) - 65;
    const btn = disp >= 0 ? document.querySelectorAll(".exam-opt")[disp] : null;
    if (btn) { event.preventDefault(); btn.click(); }
    return;
  }

  // interactive cards: keys answer until the card is graded (cloze uses its input)
  const cardEl = $("card");
  const current = (currentDeck && deck.length) ? currentDeck.cards[deck[position]] : null;
  const q = activeQuiz || (current && current.q);
  if (q && cardEl && cardEl.dataset.answered !== "1") {
    if (activeQuiz && activeQuiz.mode === "listen" && /^r$/i.test(event.key)) { event.preventDefault(); speakCard(current); return; }
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); showAnswer(); return; }
    if (q.kind === "mcq") {
      let disp = -1;   // a key selects the option at that DISPLAYED position; use its true index
      if (/^[1-9]$/.test(event.key)) disp = parseInt(event.key, 10) - 1;
      else if (/^[a-zA-Z]$/.test(event.key)) disp = event.key.toUpperCase().charCodeAt(0) - 65;
      const btn = disp >= 0 ? cardEl.querySelectorAll(".mcq-opt")[disp] : null;
      if (btn) { event.preventDefault(); answerSingle(parseInt(btn.dataset.index, 10)); return; }
    } else if (q.kind === "boolean") {
      if (/^t$/i.test(event.key)) { event.preventDefault(); answerSingle(0); return; }
      if (/^f$/i.test(event.key)) { event.preventDefault(); answerSingle(1); return; }
    } else if (q.kind === "multi") {
      if (/^[1-9]$/.test(event.key)) {
        const btn = cardEl.querySelectorAll(".mcq-opt")[parseInt(event.key, 10) - 1];
        if (btn) { event.preventDefault(); btn.classList.toggle("picked"); return; }
      }
      if (event.key === "Enter") { event.preventDefault(); submitMulti(); return; }
    }
  }

  switch (event.key) {
    case " ": case "Enter": {
      event.preventDefault();
      const cur = (currentDeck && deck.length) ? currentDeck.cards[deck[position]] : null;
      if (activeType) showAnswer();
      else if (cur && (cur.q || activeQuiz)) move(1);   // already-graded interactive card: advance, don't flip an empty face
      else toggleFlip();
      break;
    }
    case "ArrowLeft": move(-1); break;
    case "ArrowRight": move(1); break;
    case "1": markCurrent("learning"); break;
    case "2": markCurrent("known"); break;
    case "s": case "S": setShuffleMode(!shuffleMode); break;
  }
});

/* ------------------------------ tabs --------------------------- */
function showTab(name) {
  $("studyView").hidden = name !== "study";
  $("settingsView").hidden = name !== "settings";
  $("reviewView").hidden = name !== "review";
  $("libraryView").hidden = name !== "library";
  document.body.classList.toggle("building", name !== "study");   // hide deck switcher / settings / import off the study tab
  // the nav highlights study/review/library; settings is reached via the gear; build is its own page
  document.querySelectorAll("#tabs .tab[data-tab]").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  if (name === "settings") syncSettings();
  if (name === "library") renderLibrary();
  if (name === "review") renderReview();
}
document.querySelectorAll("#tabs .tab[data-tab]").forEach((t) => { t.onclick = () => showTab(t.dataset.tab); });
if ($("libSearch")) $("libSearch").addEventListener("input", (e) => { librarySearch = e.target.value; renderLibrary(); });

/* ----------------------------- review -------------------------- */
/* lists decks with spaced repetition ON and how many cards are due now */
async function renderReview() {
  const box = $("reviewList");
  box.innerHTML = "";

  // ---- overall stats (computed from every deck's stored marks) ----
  let known = 0, learning = 0, totalCards = 0;
  const mastery = [];
  for (const d of library) {
    let m = {};
    try { m = JSON.parse((await Store.get(PREFIX + "marks:" + d.id)) || "{}") || {}; } catch (e) { m = {}; }
    let k = 0, l = 0;
    if (d.cards) d.cards.forEach((c) => { const s = m[c.fp]; if (s === "known") k++; else if (s === "learning") l++; });
    known += k; learning += l; totalCards += deckCount(d);
    if (k + l > 0) mastery.push({ name: d.name, pct: Math.round(100 * k / deckCount(d)) });
  }
  const streak = computeStreak();
  const pct = totalCards ? Math.round(100 * known / totalCards) : 0;
  mastery.sort((a, b) => b.pct - a.pct);
  const stats = document.createElement("div");
  stats.className = "stats-panel";
  const stat = (num, lbl) => `<div class="stat"><span class="stat-num">${num}</span><span class="stat-lbl">${lbl}</span></div>`;
  stats.innerHTML = `<div class="stats-row">${stat(streak, "day streak")}${stat(known, "mastered")}${stat(learning, "learning")}${stat(learningSet.size, "decks active")}</div>`
    + `<div class="bar"><span class="seg-known" style="width:${totalCards ? 100 * known / totalCards : 0}%"></span><span class="seg-learn" style="width:${totalCards ? 100 * learning / totalCards : 0}%"></span></div>`
    + `<div class="stats-cap">${pct}% of ${totalCards} cards mastered`
    + (mastery.length ? " · top decks: " + mastery.slice(0, 3).map((d) => escapeHtml(d.name) + " " + d.pct + "%").join(" · ") : "")
    + `</div>`;
  box.appendChild(stats);
  const srHead = document.createElement("h3");
  srHead.className = "lib-subject";
  srHead.textContent = "Spaced-repetition review";
  box.appendChild(srHead);

  const now = Date.now();
  const rows = [];
  for (const d of library) {
    if ((await Store.get(PREFIX + "sr-on:" + d.id)) !== "1") continue;
    if (!d.cards) continue;  // stub not yet loaded — SR state requires card fingerprints
    let state = {};
    try { state = JSON.parse((await Store.get(PREFIX + "sr:" + d.id)) || "{}") || {}; } catch (e) { state = {}; }
    let due = 0;
    d.cards.forEach((c) => { const st = state[c.fp]; if (!st || st.due <= now) due++; });
    rows.push({ d, due });
  }
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "lib-empty";
    p.innerHTML = "No decks in spaced repetition yet — tap <b>🎓</b> on a deck in the Library, or turn SR on in <b>⚙ settings</b> while studying.";
    box.appendChild(p);
    return;
  }
  rows.sort((a, b) => b.due - a.due);
  const total = rows.reduce((s, r) => s + r.due, 0);
  const head = document.createElement("p");
  head.className = "review-total";
  head.innerHTML = `<b>${total}</b> card${total === 1 ? "" : "s"} due across ${rows.length} deck${rows.length === 1 ? "" : "s"}`;
  box.appendChild(head);
  rows.forEach(({ d, due }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "lib-card";
    item.innerHTML = `<span class="lib-name">${escapeHtml(d.name)}</span>`
      + `<span class="lib-meta">${due > 0 ? "<b>" + due + "</b> due now" : "all caught up"}${d.topic ? " · " + escapeHtml(d.topic) : ""}</span>`;
    item.onclick = () => { selectDeck(d.id); showTab("study"); };
    box.appendChild(item);
  });
}

/* ----------------------------- library ------------------------- */
/* library: subject › topic › deck. A deck shows under every topic it belongs to. */
function saveCollections() {
  Store.set(PREFIX + "mylib", JSON.stringify([...myLib]));
  Store.set(PREFIX + "learning", JSON.stringify([...learningSet]));
  Store.set(PREFIX + "saved", JSON.stringify([...savedColl]));
  Store.set(PREFIX + "studying", JSON.stringify([...studyingColl]));
}
/* ⭐ save / 🎓 currently-studying for whole topics, subjects and courses (typed keys) */
function isSaved(type, ref) { return savedColl.has(type + ":" + ref); }
function toggleSaved(type, ref) { const k = type + ":" + ref; savedColl.has(k) ? savedColl.delete(k) : savedColl.add(k); saveCollections(); renderLibrary(); renderDeckPicker(); }
function isStudying(type, ref) { return studyingColl.has(type + ":" + ref); }
function markStudying(type, ref) { if (ref && !studyingColl.has(type + ":" + ref)) { studyingColl.add(type + ":" + ref); saveCollections(); renderDeckPicker(); } }
/* ⭐ My library: a saved working set. Removing also stops learning. */
function toggleLib(id) {
  if (myLib.has(id)) { myLib.delete(id); learningSet.delete(id); Store.set(PREFIX + "sr-on:" + id, "0"); }
  else myLib.add(id);
  saveCollections(); renderLibrary(); renderDeckPicker();
}
/* 🎓 Learning: active study — turns on spaced repetition + scoring (and adds to library). */
function toggleLearning(id) {
  if (learningSet.has(id)) { learningSet.delete(id); Store.set(PREFIX + "sr-on:" + id, "0"); }
  else {
    learningSet.add(id); myLib.add(id);
    Store.set(PREFIX + "sr-on:" + id, "1"); srUser = true; Store.set(PREFIX + "sr-user", "1");
  }
  saveCollections(); renderLibrary(); renderDeckPicker();
  if (currentDeck && currentDeck.id === id) selectDeck(id);   // reflect SR change on the open deck
}
function libActionBtn(label, active, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lib-act" + (active ? " on" : "");
  b.textContent = label;
  b.title = title;
  b.onclick = (event) => { event.stopPropagation(); onClick(); };
  return b;
}

/* a virtual deck: the given decks' cards interleaved, each tagged with its owner so
   progress writes back to the real deck (shared). Used by topic/subject "study all"
   and by custom user-built courses. */
function virtualFromDecks(members, id, name, subject, topicLabel) {
  const cards = [], seen = new Set();
  members.forEach((d) => d.cards.forEach((c) => {
    const key = d.id + ":" + c.fp;   // key by owner+fp so identical content in two decks isn't dropped (and routes to the right owner)
    if (seen.has(key)) return; seen.add(key);
    cards.push(Object.assign({}, c, { _owner: d.id }));
  }));
  return {
    id, name, virtual: true, accent: (members[0] && members[0].accent) || "#00ff88",
    defaultDir: "forward", dual: false, lang: null, categories: {}, cards,
    subject: subject || null, topic: topicLabel || null,
    description: members.length + " decks · " + cards.length + " cards combined",
  };
}
function buildVirtualDeck(key, isSubject) {
  const members = library.filter((d) => isSubject
    ? deckInSubject(d, key)
    : ((d.topics && d.topics.length ? d.topics : [d.topic]).indexOf(key) >= 0));
  const v = virtualFromDecks(members, "virtual:" + (isSubject ? "subject:" : "topic:") + key,
    key + " · all decks", isSubject ? key : (topicSubjectsArr(key)[0] || null), isSubject ? "all decks" : key);
  if (isSubject) {                                  // a subject "study all" shows the subject's own primer
    const m = subjectMeta[key]; if (m) { v.primer = m.primer || null; v.primerTitle = m.primerTitle || null; }
    v._primerKey = "subject:" + key;
  } else {                                          // a topic "study all" shows the topic's own primer
    const tp = topicPrimers[key]; if (tp) { v.primer = tp.body; v.primerTitle = tp.title; }
    v._primerKey = "topic:" + key;
  }
  return v;
}
async function enterVirtual(vdeck) {
  if (!vdeck.cards.length) return;
  currentDeck = vdeck;
  marks = {}; ownerMarks = {};
  for (const oid of new Set(vdeck.cards.map((c) => c._owner))) {
    let m = {};
    try { m = JSON.parse((await Store.get(PREFIX + "marks:" + oid)) || "{}") || {}; } catch (e) { m = {}; }
    ownerMarks[oid] = m; Object.assign(marks, m);
  }
  sr = {}; srMode = false; studyMode = "flip"; cardDir = "default"; currentCategory = "all"; focusLearning = false; shuffleMode = true;
  applyBrand(vdeck); renderDeckHeader(); renderDeckPicker();
  if ($("removeDeck")) $("removeDeck").hidden = true;
  if ($("srPrompt")) $("srPrompt").hidden = true;
  await offerPrimer(vdeck);   // a topic/subject "study all" offers its own (topic/subject) primer
  buildFilters();
  rebuildDeck(true);
  showTab("study");
}
async function studyVirtual(key, isSubject) {
  markStudying(isSubject ? "subject" : "topic", key);
  Store.set(PREFIX + "lastSel", JSON.stringify({ kind: isSubject ? "subject" : "topic", ref: key }));
  const members = library.filter((d) => isSubject ? deckInSubject(d, key)
    : (d.topics && d.topics.length ? d.topics : [d.topic]).indexOf(key) >= 0);
  await Promise.all(members.map(ensureCards));
  if (!isSubject) await loadTopicPrimer(key);
  await enterVirtual(buildVirtualDeck(key, isSubject));
}
/* a COURSE is an ordered PLAYLIST referencing any level (deck / topic / subject); it is
   NOT a containment level. Expand its items to ordered, de-duplicated decks. */
function courseItems(course) { return course.items || []; }
function courseItemDecks(it) {
  if (it.type === "topic") return library.filter((d) => d.topics && d.topics.indexOf(it.ref) >= 0);
  if (it.type === "subject") return library.filter((d) => deckInSubject(d, it.ref));
  const d = library.find((x) => x.id === it.ref); return d ? [d] : [];
}
function expandCourse(course) {
  const items = courseItems(course);
  const rank = { deck: 3, topic: 2, subject: 1 };   // a deck reached by a MORE SPECIFIC item wins
  // pick the winning item per deck: highest specificity; ties → earliest item
  const winner = new Map();
  items.forEach((it, i) => {
    const r = rank[it.type] || 0;
    courseItemDecks(it).forEach((d) => { const cur = winner.get(d.id); if (!cur || r > cur.r) winner.set(d.id, { i, r }); });
  });
  // emit each deck once, at the position of its winning item, in that item's internal order
  const out = [], placed = new Set();
  items.forEach((it, i) => {
    courseItemDecks(it).forEach((d) => {
      if (placed.has(d.id)) return;
      const w = winner.get(d.id);
      if (w && w.i === i) { placed.add(d.id); out.push(d); }
    });
  });
  return out;
}
function findCourse(id) { return customCourses.find((c) => c.id === id) || authoredCourses.find((c) => c.id === id) || null; }
function courseSize(course) { return expandCourse(course).length; }

/* a deck may sit in several subjects (via topics in different subjects) — collect them all */
function topicSubjectsArr(t) { return topicSubjects[t] ? [...topicSubjects[t]] : []; }
function deckSubjects(deck) {
  const out = new Set();
  ((deck.topics && deck.topics.length) ? deck.topics : [deck.topic]).forEach((t) => topicSubjectsArr(t).forEach((s) => out.add(s)));
  if (deck.subject) out.add(deck.subject);
  return out;
}
function deckInSubject(deck, subject) { return deckSubjects(deck).has(subject); }

async function studyCourse(course) {
  const members = expandCourse(course);
  if (!members.length) return;
  await Promise.all(members.map(ensureCards));
  markStudying("course", course.id);
  Store.set(PREFIX + "lastSel", JSON.stringify({ kind: "course", ref: course.id }));
  await enterVirtual(virtualFromDecks(members, "course:" + course.id, course.name, course.subject || "Courses", course.name));
}

/* ---- custom courses: user-assembled collections of arbitrary decks ---- */
function saveCourses() { Store.set(PREFIX + "courses", JSON.stringify(customCourses)); }
/* course-builder selection: an ordered list of typed items (deck/topic/subject) */
function selIndex(type, ref) { return courseSelection.findIndex((i) => i.type === type && i.ref === ref); }
function selHas(type, ref) { return selIndex(type, ref) >= 0; }
function selToggle(type, ref) { const i = selIndex(type, ref); if (i >= 0) courseSelection.splice(i, 1); else courseSelection.push({ type, ref }); renderLibrary(); }
function createCourse(name, items) {
  const id = slugify(name) + "-" + hashStr(JSON.stringify(items)).slice(0, 4);
  customCourses = customCourses.filter((c) => c.id !== id);
  customCourses.push({ id, name, items });
  saveCourses();
}
function deleteCourse(id) { customCourses = customCourses.filter((c) => c.id !== id); saveCourses(); renderLibrary(); renderDeckPicker(); }

/* ---- exam mode: N random questions, timed, scored, with a report ---- */
function examFmtTime(ms) { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
function examQuestion(card) {                                 // → {prompt, promptGlyph, choices, answer} or null
  if (card.q && card.q.kind === "mcq") return { prompt: card.term, choices: card.q.choices.slice(), answer: card.q.answer, promptGlyph: false };
  if (card.q && card.q.kind === "boolean") return { prompt: card.term, choices: ["True", "False"], answer: card.q.answer ? 0 : 1, promptGlyph: false };
  if (!card.q) { const qz = buildQuiz(card, "forward", "quiz", false); if (qz) return { prompt: qz.promptText, choices: qz.choices, answer: qz.answer, promptGlyph: qz.promptGlyph }; }
  return null;                                                // cloze/multi or no distractors → skipped
}
function startExam() {
  if (!currentDeck) return;
  const pool = [];
  currentDeck.cards.forEach((c, i) => { if (examQuestion(c)) pool.push(i); });
  if (pool.length < 2) { alert("This deck can't form an exam yet (needs a few more cards)."); return; }
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  exam = { queue: pool.slice(0, Math.min(20, pool.length)), idx: 0, results: [], start: Date.now() };
  document.body.classList.add("exam-on");
  renderExam();
}
function renderExam() {
  if (!exam) return;
  if (exam.idx >= exam.queue.length) return finishExam();
  const card = currentDeck.cards[exam.queue[exam.idx]];
  const q = examQuestion(card);
  const order = q.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  const opts = order.map((trueIdx, disp) =>
    `<button type="button" class="mcq-opt exam-opt" data-index="${trueIdx}"><span class="mcq-key">${String.fromCharCode(65 + disp)}</span><span class="mcq-text">${linkify(escapeHtml(q.choices[trueIdx]))}</span></button>`).join("");
  host.innerHTML = `<div class="stage"><div class="card mcq exam-card">
      <div class="exam-head"><span>Question ${exam.idx + 1} / ${exam.queue.length}</span><span class="exam-clock" id="examClock">⏱ ${examFmtTime(Date.now() - exam.start)}</span></div>
      <div class="term${q.promptGlyph ? " exam-glyph" : ""}">${escapeHtml(q.prompt)}</div>
      <div class="choices">${opts}</div>
      <button type="button" class="link exam-quit" id="examQuit">quit exam</button>
    </div></div>`;
  host.querySelectorAll(".exam-opt").forEach((b) => b.addEventListener("click", () => examAnswer(parseInt(b.dataset.index, 10), q.answer, card)));
  $("examQuit").onclick = exitExam;
  typesetMath(host);
  $("controls").style.display = "none"; $("markRow").style.display = "none"; $("filters").style.display = "none";
  if ($("progressWrap")) $("progressWrap").style.display = "none";
  if (!examTimer) examTimer = setInterval(() => { const c = $("examClock"); if (c) c.textContent = "⏱ " + examFmtTime(Date.now() - exam.start); }, 1000);
}
function examAnswer(chosen, answer, card) {
  if (!exam) return;
  exam.results.push({ category: card.category || "", correct: chosen === answer });
  exam.idx++;
  renderExam();
}
function finishExam() {
  clearInterval(examTimer); examTimer = null;
  const total = exam.results.length, correct = exam.results.filter((r) => r.correct).length;
  const pct = total ? Math.round(100 * correct / total) : 0;
  const elapsed = examFmtTime(Date.now() - exam.start);
  const byCat = {};
  exam.results.forEach((r) => { const k = r.category || "—"; (byCat[k] = byCat[k] || { c: 0, n: 0 }).n++; if (r.correct) byCat[k].c++; });
  const catRows = Object.keys(byCat).map((k) => {
    const cat = currentDeck.categories[k]; const label = cat ? cat.label : (k === "—" ? "general" : k);
    return `<div class="exam-catrow"><span>${escapeHtml(label)}</span><span>${byCat[k].c}/${byCat[k].n}</span></div>`;
  }).join("");
  host.innerHTML = `<div class="stage"><div class="card exam-card exam-report">
      <div class="exam-score">${pct}%</div>
      <div class="exam-sub">${correct} / ${total} correct · ⏱ ${elapsed}</div>
      ${catRows ? `<div class="exam-cats">${catRows}</div>` : ""}
      <div class="exam-actions"><button type="button" class="solid-btn" id="examRetake">retake</button><button type="button" class="ghost-btn" id="examDone">done</button></div>
    </div></div>`;
  $("examRetake").onclick = startExam;
  $("examDone").onclick = exitExam;
}
function exitExam() {
  clearInterval(examTimer); examTimer = null; exam = null;
  document.body.classList.remove("exam-on");
  $("controls").style.display = ""; $("markRow").style.display = ""; $("filters").style.display = "";
  if ($("progressWrap")) $("progressWrap").style.display = "";
  renderCard();
}

/* ---- search: scope + language filter bars ---- */
const SEARCH_LANG_LABELS = { ar: "Arabic", el: "Greek", he: "Hebrew", ja: "Japanese", ko: "Korean", ru: "Russian", zh: "Chinese" };

function _renderSearchBars(box) {
  const scopeRow = document.createElement("div");
  scopeRow.className = "lib-filter search-scope-bar";
  [["decks", "🃏 Decks"], ["topics", "📂 Topics"], ["subjects", "🎓 Subjects"], ["courses", "🧭 Courses"], ["cards", "🗂 Cards"]].forEach(([key, label]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip toggle" + (searchScope === key ? " active" : ""); b.textContent = label;
    b.onclick = () => { searchScope = key; renderLibrary(); };
    scopeRow.appendChild(b);
  });
  box.appendChild(scopeRow);
  const langs = [...new Set(library.filter(d => d.lang).map(d => d.lang))].sort();
  if (!langs.length) return;
  const langRow = document.createElement("div");
  langRow.className = "lib-filter search-lang-bar";
  const allLang = document.createElement("button");
  allLang.type = "button"; allLang.className = "chip toggle" + (!searchLang ? " active" : ""); allLang.textContent = "All languages";
  allLang.onclick = () => { searchLang = ""; renderLibrary(); };
  langRow.appendChild(allLang);
  langs.forEach(lang => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip toggle" + (searchLang === lang ? " active" : "");
    b.textContent = SEARCH_LANG_LABELS[lang] || lang.toUpperCase();
    b.onclick = () => { searchLang = lang; renderLibrary(); };
    langRow.appendChild(b);
  });
  box.appendChild(langRow);
}

function _searchHead(box, n, label) {
  const head = document.createElement("p"); head.className = "review-total";
  head.innerHTML = `<b>${n}${n >= 200 ? "+" : ""}</b> ${label}${n === 1 ? "" : "s"}`;
  box.appendChild(head);
}
function _searchEmpty(box, msg) { const p = document.createElement("p"); p.className = "lib-empty"; p.textContent = msg; box.appendChild(p); }

function renderSearchResults(box, query) {
  _renderSearchBars(box);
  if (searchScope === "topics")        renderSearchTopics(box, query);
  else if (searchScope === "subjects") renderSearchSubjects(box, query);
  else if (searchScope === "courses")  renderSearchCourses(box, query);
  else if (searchScope === "cards")    renderSearchCards(box, query);
  else                                 renderSearchDecks(box, query);
}

function renderSearchDecks(box, query) {
  const q = query.toLowerCase();
  const matches = library.filter(d => {
    if (searchLang && d.lang !== searchLang) return false;
    return (d.name + " " + (d.description || "") + " " + (d.topic || "") + " " + (d.subject || "")).toLowerCase().includes(q);
  }).slice(0, 200);
  _searchHead(box, matches.length, "deck");
  if (!matches.length) { _searchEmpty(box, "No matching decks."); return; }
  matches.forEach(d => {
    const item = document.createElement("button");
    item.type = "button"; item.className = "lib-card";
    item.innerHTML = `<span class="lib-name">${escapeHtml(d.name)}</span>`
      + (d.description ? `<span class="lib-meta">${escapeHtml(d.description.slice(0, 90))}</span>` : "")
      + `<span class="lib-desc">${[d.subject, d.topic].filter(Boolean).map(escapeHtml).join(" · ")}</span>`;
    item.onclick = () => selectDeck(d.id).then(() => showTab("study"));
    box.appendChild(item);
  });
}

function renderSearchTopics(box, query) {
  const q = query.toLowerCase();
  const topicMap = new Map();
  library.forEach(d => {
    if (searchLang && d.lang !== searchLang) return;
    if (!d.topic) return;
    if (!topicMap.has(d.topic)) topicMap.set(d.topic, { decks: 0, subjects: new Set() });
    const entry = topicMap.get(d.topic); entry.decks++;
    (d.subjects && d.subjects.length ? d.subjects : (d.subject ? [d.subject] : [])).forEach(s => entry.subjects.add(s));
  });
  const matches = [...topicMap.entries()].filter(([name]) => name.toLowerCase().includes(q)).slice(0, 200);
  _searchHead(box, matches.length, "topic");
  if (!matches.length) { _searchEmpty(box, "No matching topics."); return; }
  matches.forEach(([name, info]) => {
    const item = document.createElement("button");
    item.type = "button"; item.className = "lib-card";
    item.innerHTML = `<span class="lib-name">${escapeHtml(name)}</span>`
      + `<span class="lib-desc">${info.decks} deck${info.decks === 1 ? "" : "s"}${info.subjects.size ? " · " + [...info.subjects].map(escapeHtml).join(", ") : ""}</span>`;
    item.onclick = () => { librarySearch = ""; $("libSearch").value = ""; libTopic = name; libPane = "main"; renderLibrary(); };
    box.appendChild(item);
  });
}

function renderSearchSubjects(box, query) {
  const q = query.toLowerCase();
  const subjectMap = new Map();
  library.forEach(d => {
    if (searchLang && d.lang !== searchLang) return;
    (d.subjects && d.subjects.length ? d.subjects : (d.subject ? [d.subject] : [])).forEach(s => subjectMap.set(s, (subjectMap.get(s) || 0) + 1));
  });
  const matches = [...subjectMap.entries()].filter(([name]) => name.toLowerCase().includes(q)).slice(0, 200);
  _searchHead(box, matches.length, "subject");
  if (!matches.length) { _searchEmpty(box, "No matching subjects."); return; }
  matches.forEach(([name, count]) => {
    const item = document.createElement("button");
    item.type = "button"; item.className = "lib-card";
    item.innerHTML = `<span class="lib-name">${escapeHtml(name)}</span>`
      + `<span class="lib-desc">${count} deck${count === 1 ? "" : "s"}</span>`;
    item.onclick = () => { librarySearch = ""; $("libSearch").value = ""; libSubj = name; libTopic = null; libPane = "nav"; renderLibrary(); };
    box.appendChild(item);
  });
}

function renderSearchCourses(box, query) {
  const q = query.toLowerCase();
  const matches = [...authoredCourses, ...customCourses]
    .filter(co => (co.name + " " + (co.description || "")).toLowerCase().includes(q)).slice(0, 200);
  _searchHead(box, matches.length, "course");
  if (!matches.length) { _searchEmpty(box, "No matching courses."); return; }
  matches.forEach(co => {
    const item = document.createElement("button");
    item.type = "button"; item.className = "lib-card";
    item.innerHTML = `<span class="lib-name">${escapeHtml(co.name)}</span>`
      + (co.description ? `<span class="lib-meta">${escapeHtml(co.description.slice(0, 90))}</span>` : "")
      + `<span class="lib-desc">${(co.items || []).length} item${(co.items || []).length === 1 ? "" : "s"}</span>`;
    item.onclick = () => { librarySearch = ""; $("libSearch").value = ""; courseView = { type: "course", key: co.id }; renderLibrary(); };
    box.appendChild(item);
  });
}

function renderSearchCards(box, query) {
  const toks = query.split(/\s+/).filter(Boolean);
  const tagToks = toks.filter((t) => t.indexOf(":") >= 0 || library.some((d) => deckTags(d).has(t)));
  const textToks = toks.filter((t) => tagToks.indexOf(t) < 0);
  const results = [], seen = new Set();
  for (const d of library) {
    if (!d.cards) continue;  // stub not yet loaded — only loaded decks are card-searchable
    if (searchLang && d.lang !== searchLang) continue;
    const tags = deckTags(d);
    if (tagToks.length && !tagToks.every((tt) => [...tags].some((tag) => tag === tt || tag.indexOf(tt) >= 0))) continue;
    for (const c of d.cards) {
      if (textToks.length) {
        const hay = (c.term + " " + c.definition + " " + (c.note || "")).toLowerCase();
        if (!textToks.every((w) => hay.indexOf(w) >= 0)) continue;
      }
      const key = d.id + ":" + c.fp.replace(/[fr]$/, "");   // collapse dual directions
      if (seen.has(key)) continue; seen.add(key);
      results.push({ d, c });
      if (results.length >= 200) break;
    }
    if (results.length >= 200) break;
  }
  _searchHead(box, results.length, "card");
  if (!results.length) { _searchEmpty(box, "No matching cards."); return; }
  results.forEach(({ d, c }) => {
    const item = document.createElement("button");
    item.type = "button"; item.className = "lib-card";
    item.innerHTML = `<span class="lib-name">${escapeHtml(c.term)}</span>`
      + `<span class="lib-meta">${escapeHtml((c.definition || "").slice(0, 90))}</span>`
      + `<span class="lib-desc">${escapeHtml(d.name)}${d.subject ? " · " + escapeHtml(d.subject) : ""}</span>`;
    item.onclick = () => studyCardByFp(d.id, c.fp);
    box.appendChild(item);
  });
}
async function studyCardByFp(deckId, fp) {
  await selectDeck(deckId);
  const i = deck.findIndex((idx) => currentDeck.cards[idx].fp === fp);
  if (i >= 0) { position = i; renderCard(); }
  showTab("study");
}

/* gated course path: ordered decks, each locked until the previous is fully mastered. */
async function renderCoursePath() {
  const box = $("libList");
  box.innerHTML = "";
  const back = document.createElement("button");
  back.type = "button"; back.className = "link"; back.textContent = "← back to library";
  back.onclick = () => { courseView = null; renderLibrary(); };
  box.appendChild(back);
  let members = [], title = "", studyKind = null, studyKey = null;
  if (courseView.type === "subject") {
    title = courseView.key;
    members = library.filter((d) => deckInSubject(d, courseView.key));   // library = manifest order
    studyKind = "subject"; studyKey = courseView.key;
  } else {
    const co = findCourse(courseView.key);
    if (co) { title = co.name; members = expandCourse(co); studyKind = "course"; studyKey = co.id; }
  }
  const h = document.createElement("h2"); h.className = "lib-subject"; h.textContent = title + " — course"; box.appendChild(h);
  const note = document.createElement("p"); note.className = "lib-desc";
  note.textContent = "Master each deck (all cards ✓) to unlock the next. Use ▶ study all in the library for a mixed review across levels.";
  box.appendChild(note);
  await Promise.all(members.map(ensureCards));
  let priorComplete = true;
  for (const d of members) {
    let m = {};
    try { m = JSON.parse((await Store.get(PREFIX + "marks:" + d.id)) || "{}") || {}; } catch (e) { m = {}; }
    const known = (d.cards || []).filter((c) => m[c.fp] === "known").length;
    const complete = deckCount(d) > 0 && known === deckCount(d);
    const unlocked = priorComplete;
    const status = complete ? "done" : (unlocked ? "current" : "locked");
    const row = document.createElement("button");
    row.type = "button"; row.className = "course-step " + status;
    row.innerHTML = `<span class="course-ico">${complete ? "✓" : (unlocked ? "▶" : "🔒")}</span>`
      + `<span class="course-deck">${escapeHtml(d.name)}</span><span class="course-prog">${known}/${deckCount(d)}</span>`;
    if (unlocked) row.onclick = () => { if (studyKind) markStudying(studyKind, studyKey); selectDeck(d.id); showTab("study"); }; else row.disabled = true;
    box.appendChild(row);
    if (!complete) priorComplete = false;
  }
}

function renderLibrary() {
  const box = $("libList");
  box.innerHTML = "";
  if (!library.length) { box.innerHTML = '<p class="lib-empty">No decks loaded yet — build or import one.</p>'; return; }
  if (courseView) { renderCoursePath(); return; }
  if (librarySearch.trim()) { renderSearchResults(box, librarySearch.trim().toLowerCase()); return; }
  if (courseBuild) { renderCourseBuilder(box); return; }
  renderLibShell(box);
}

/* the build-a-course flow keeps the flat lookup tabs (selectable rows + a save bar) */
function renderCourseBuilder(box) {
  // lookup-by-type tabs: browse the tree, or list decks / topics / subjects / courses
  const tabs = document.createElement("div");
  tabs.className = "lib-views";
  [["browse", "🗂 browse"], ["decks", "🃏 decks"], ["topics", "📂 topics"], ["subjects", "🎓 subjects"], ["courses", "🧭 courses"]].forEach(([key, label]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip toggle" + (libView === key ? " active" : ""); b.textContent = label;
    b.onclick = () => { libView = key; renderLibrary(); };
    tabs.appendChild(b);
  });
  box.appendChild(tabs);

  // ⭐/🎓 sub-filter (browse + decks only)
  {
    const bar = document.createElement("div");
    bar.className = "lib-filter";
    [["all", "📚 all"], ["lib", "⭐ my library (" + (myLib.size + savedColl.size) + ")"], ["learning", "🎓 learning (" + (learningSet.size + studyingColl.size) + ")"]].forEach(([key, label]) => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip toggle" + (libFilter === key ? " active" : ""); chip.textContent = label;
      chip.onclick = () => { libFilter = key; renderLibrary(); };
      bar.appendChild(chip);
    });
    box.appendChild(bar);
  }

  // tag lookup: click a tag to filter the current view; click again (✕) to clear
  const tagSet = new Set();
  library.forEach((d) => { (d.tags || []).forEach((t) => tagSet.add(t)); if (d.lang) tagSet.add("lang:" + d.lang); });
  if (tagSet.size) {
    const tagRow = document.createElement("div");
    tagRow.className = "tag-row";
    if (libTag) {
      const clear = document.createElement("button");
      clear.type = "button"; clear.className = "tag-chip active"; clear.textContent = "✕ " + libTag;
      clear.onclick = () => { libTag = ""; renderLibrary(); };
      tagRow.appendChild(clear);
    }
    [...tagSet].sort().forEach((t) => {
      if (t === libTag) return;
      const c = document.createElement("button");
      c.type = "button"; c.className = "tag-chip"; c.textContent = t;
      c.onclick = () => { libTag = t; renderLibrary(); };
      tagRow.appendChild(c);
    });
    box.appendChild(tagRow);
  }

  // active course-builder bar (shown across every tab so you can add decks/topics/subjects)
  if (courseBuild) {
    const courseBar = document.createElement("div");
    courseBar.className = "course-bar";
    const info = document.createElement("span");
    info.className = "course-build-info";
    info.textContent = courseSelection.length + " selected — tap decks, or ＋ a topic/subject, to add (in order)";
    const name = document.createElement("input");
    name.type = "text"; name.id = "courseName"; name.className = "course-name"; name.placeholder = "course name";
    const save = document.createElement("button");
    save.type = "button"; save.className = "solid-btn"; save.textContent = "save course";
    save.onclick = () => {
      const nm = ($("courseName").value || "").trim();
      if (!nm || !courseSelection.length) return;
      createCourse(nm, courseSelection.slice());
      courseBuild = false; courseSelection = []; libView = "courses";
      renderLibrary(); renderDeckPicker();
    };
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "link"; cancel.textContent = "cancel";
    cancel.onclick = () => { courseBuild = false; courseSelection = []; renderLibrary(); };
    courseBar.append(info, name, save, cancel);
    box.appendChild(courseBar);
  }

  if (libView === "courses") return renderCoursesView(box);
  if (libView === "topics") return renderTopicsView(box);
  if (libView === "subjects") return renderSubjectsView(box);
  if (libView === "decks") return renderDecksView(box);
  return renderBrowseTree(box);
}

/* resolve a typed container key ("topic:..|subject:..|course:..|deck:..") to {name,sub,go} */
function containerEntry(key) {
  const i = key.indexOf(":"), type = key.slice(0, i), ref = key.slice(i + 1);
  if (type === "course") { const co = findCourse(ref); return co ? { name: co.name, sub: "course", go: () => studyCourse(co) } : null; }
  if (type === "subject") return { name: ref, sub: "subject", go: () => studyVirtual(ref, true) };
  if (type === "topic") return { name: ref, sub: "topic", go: () => studyVirtual(ref, false) };
  if (type === "deck") { const d = library.find((x) => x.id === ref); return d ? { name: d.name, sub: "deck", go: () => { selectDeck(d.id); showTab("study"); } } : null; }
  return null;
}

/* responsive master-detail Library: a nav rail (continue / saved / subject→topic tree)
   beside a deck-grid detail. On narrow screens one pane shows at a time (drill-down). */
function renderLibShell(box) {
  const shell = document.createElement("div"); shell.className = "lib-shell"; shell.dataset.pane = libPane;
  const nav = document.createElement("div"); nav.className = "lib-nav";
  const main = document.createElement("div"); main.className = "lib-main";
  shell.append(nav, main); box.appendChild(shell);

  const navRow = (icon, label, sub, onClick, on, indent) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "lib-navrow" + (on ? " on" : "") + (indent ? " ind" : "");
    b.innerHTML = `<span class="nr-ic">${icon}</span><span class="nr-lab">${escapeHtml(label)}${sub ? ` <small>${escapeHtml(sub)}</small>` : ""}</span>`;
    if (onClick) b.onclick = onClick;
    return b;
  };
  const navSec = (t) => { const h = document.createElement("div"); h.className = "lib-navsec"; h.textContent = t; nav.appendChild(h); };

  // filter chips (all / saved / studying)
  const fbar = document.createElement("div"); fbar.className = "lib-filter";
  [["all", "all"], ["lib", "⭐ saved (" + (myLib.size + savedColl.size) + ")"], ["learning", "🎓 studying (" + (learningSet.size + studyingColl.size) + ")"]].forEach(([k, l]) => {
    const c = document.createElement("button"); c.type = "button"; c.className = "chip toggle" + (libFilter === k ? " active" : ""); c.textContent = l;
    c.onclick = () => { libFilter = k; renderLibrary(); }; fbar.appendChild(c);
  });
  nav.appendChild(fbar);

  // continue (currently studying)
  const cont = [...studyingColl].map(containerEntry).filter(Boolean);
  if (cont.length) { navSec("Continue"); cont.forEach((e) => nav.appendChild(navRow("▶", e.name, e.sub, () => e.go()))); }
  // review
  navSec("Review");
  nav.appendChild(navRow("⏰", "Due for review", "spaced repetition", () => showTab("review")));
  // saved
  const savedC = [...savedColl].map(containerEntry).filter(Boolean);
  const savedDecks = library.filter((d) => myLib.has(d.id));
  if (savedC.length || savedDecks.length) {
    navSec("Saved");
    savedC.forEach((e) => nav.appendChild(navRow("⭐", e.name, e.sub, () => e.go())));
    savedDecks.forEach((d) => nav.appendChild(navRow("⭐", d.name, "deck", () => { selectDeck(d.id); showTab("study"); })));
  }
  // subjects → topics tree
  navSec("Subjects");
  const subjects = [...new Set(library.flatMap((d) => [...deckSubjects(d)]))].sort((a, b) => a.localeCompare(b));
  let anySubj = false;
  subjects.forEach((s) => {
    const decks = library.filter((d) => deckInSubject(d, s) && deckMatchesTag(d, libTag) && libVisible(d));
    if (!decks.length) return; anySubj = true;
    nav.appendChild(navRow("▪", s, "", () => { const open = libSubj === s; libSubj = open ? null : s; libTopic = null; libPane = libSubj ? "main" : "nav"; renderLibrary(); }, libSubj === s));
    if (libSubj === s) {
      const topics = [...new Set(decks.flatMap((d) => (d.topics && d.topics.length) ? d.topics : [d.topic]))].sort((a, b) => a.localeCompare(b));
      topics.forEach((t) => nav.appendChild(navRow("›", t, "", () => { libTopic = t; libPane = "main"; renderLibrary(); }, libTopic === t, true)));
    }
  });
  if (!anySubj) nav.insertAdjacentHTML("beforeend", '<p class="lib-empty" style="padding:8px 12px">Nothing here — try the “all” filter.</p>');
  // build a course
  const bc = document.createElement("button"); bc.type = "button"; bc.className = "ghost-btn"; bc.style.cssText = "margin:10px;width:calc(100% - 20px)";
  bc.textContent = "＋ build a course";
  bc.onclick = () => { courseBuild = true; courseSelection = []; renderLibrary(); };
  nav.appendChild(bc);

  // ---- detail pane ----
  if (libPane === "main") {
    const back = document.createElement("button"); back.type = "button"; back.className = "lib-back"; back.textContent = "‹ back";
    back.onclick = () => { if (libTopic) { libTopic = null; renderLibrary(); } else { libPane = "nav"; renderLibrary(); } };
    main.appendChild(back);
  }
  if (libTopic) renderTopicMain(main, libSubj, libTopic);
  else if (libSubj) renderSubjectMain(main, libSubj);
  else {
    const p = document.createElement("p"); p.className = "lib-empty"; p.style.padding = "24px 16px";
    p.textContent = "Pick a subject to browse its topics and decks — or jump back in from Continue / Saved.";
    main.appendChild(p);
  }
}
function libGridCard(d) {
  const n = deckCount(d);
  const c = document.createElement("button"); c.type = "button"; c.className = "lib-gcard";
  c.innerHTML = `<span class="gc-nm">🃏 ${escapeHtml(d.name)}</span><span class="gc-mt">${n} card${n === 1 ? "" : "s"}${myLib.has(d.id) ? " · ⭐" : ""}${learningSet.has(d.id) ? " · 🎓" : ""}</span>`;
  c.onclick = () => { selectDeck(d.id); showTab("study"); };
  return c;
}
function libMainHead(main, eyebrow, title, actions) {
  const hd = document.createElement("div"); hd.className = "lib-mhd";
  hd.innerHTML = `<div class="lib-crumb">${eyebrow ? `<small>${escapeHtml(eyebrow)}</small>` : ""}<b>${escapeHtml(title)}</b></div>`;
  const act = document.createElement("div"); act.className = "lib-mact"; actions.forEach((a) => act.appendChild(a)); hd.appendChild(act);
  main.appendChild(hd);
}
function renderTopicMain(main, s, t) {
  const decks = library.filter((d) => ((d.topics && d.topics.length) ? d.topics : [d.topic]).indexOf(t) >= 0 && deckMatchesTag(d, libTag) && libVisible(d));
  libMainHead(main, s || "", t, [
    libActionBtn("⭐", isSaved("topic", t), isSaved("topic", t) ? "Remove from My library" : "Save topic", () => toggleSaved("topic", t)),
    libActionBtn("▶", false, "Study all decks in this topic, interleaved", () => studyVirtual(t, false)),
  ]);
  const g = document.createElement("div"); g.className = "lib-grid";
  decks.forEach((d) => g.appendChild(libGridCard(d)));
  main.appendChild(g);
}
function renderSubjectMain(main, s) {
  libMainHead(main, "Subject", s, [
    libActionBtn("⭐", isSaved("subject", s), isSaved("subject", s) ? "Remove from My library" : "Save subject", () => toggleSaved("subject", s)),
    libActionBtn("🎯", false, "Gated course through this subject", () => { courseView = { type: "subject", key: s }; renderLibrary(); }),
    libActionBtn("▶", false, "Study all decks in this subject, interleaved", () => studyVirtual(s, true)),
  ]);
  const decks = library.filter((d) => deckInSubject(d, s) && deckMatchesTag(d, libTag) && libVisible(d));
  const topics = [...new Set(decks.flatMap((d) => (d.topics && d.topics.length) ? d.topics : [d.topic]))].sort((a, b) => a.localeCompare(b));
  const g = document.createElement("div"); g.className = "lib-grid";
  topics.forEach((t) => {
    const td = decks.filter((d) => ((d.topics && d.topics.length) ? d.topics : [d.topic]).indexOf(t) >= 0);
    const c = document.createElement("button"); c.type = "button"; c.className = "lib-gcard";
    c.innerHTML = `<span class="gc-nm">📂 ${escapeHtml(t)}</span><span class="gc-mt">${td.length} deck${td.length === 1 ? "" : "s"}${isSaved("topic", t) ? " · ⭐" : ""}${isStudying("topic", t) ? " · 🎓" : ""}</span>`;
    c.onclick = () => { libTopic = t; libPane = "main"; renderLibrary(); };
    g.appendChild(c);
  });
  main.appendChild(g);
}

/* ---- library lookup helpers ---- */
function libVisible(d) { return libFilter === "all" || (libFilter === "lib" && myLib.has(d.id)) || (libFilter === "learning" && learningSet.has(d.id)); }
function deckMatchesTag(d, tag) { return !tag || [...deckTags(d)].some((t) => t === tag || t.indexOf(tag) >= 0); }

/* one deck card: a selectable chip in build mode, else a card + ⭐/🎓 actions */
function libDeckRow(d) {
  const n = deckCount(d), cats = d.categories ? Object.keys(d.categories).length : 0;
  const also = (d.topics && d.topics.length > 1) ? " · in " + d.topics.length + " topics" : "";
  const badges = (myLib.has(d.id) ? " · ⭐" : "") + (learningSet.has(d.id) ? " · 🎓" : "");
  const item = document.createElement("button");
  item.type = "button"; item.className = "lib-card";
  item.innerHTML = `<span class="lib-name">${escapeHtml(d.name)}</span>`
    + `<span class="lib-meta">${n} card${n === 1 ? "" : "s"}${cats > 1 ? " · " + cats + " sections" : ""}${d.imported ? " · imported" : ""}${also}${badges}</span>`
    + (d.description ? `<span class="lib-desc">${escapeHtml(d.description)}</span>` : "");
  if (courseBuild) {
    item.classList.add("selectable");
    if (selHas("deck", d.id)) item.classList.add("selected");
    item.onclick = () => selToggle("deck", d.id);
    return item;
  }
  item.onclick = () => { selectDeck(d.id); showTab("study"); };
  const row = document.createElement("div"); row.className = "lib-row";
  const actions = document.createElement("div"); actions.className = "lib-actions";
  actions.appendChild(libActionBtn("⭐", myLib.has(d.id), myLib.has(d.id) ? "Remove from My library" : "Save to My library", () => toggleLib(d.id)));
  actions.appendChild(libActionBtn("🎓", learningSet.has(d.id), learningSet.has(d.id) ? "Stop learning (turns off SR)" : "Learn this — turns on spaced repetition + scoring", () => toggleLearning(d.id)));
  row.appendChild(item); row.appendChild(actions);
  return row;
}

function renderDecksView(box) {
  const decks = library.filter((d) => libVisible(d) && deckMatchesTag(d, libTag));
  if (!decks.length) { box.insertAdjacentHTML("beforeend", '<p class="lib-empty">No decks match.</p>'); return; }
  decks.forEach((d) => box.appendChild(libDeckRow(d)));
}

function renderTopicsView(box) {
  const topics = [...new Set(library.flatMap((d) => (d.topics && d.topics.length) ? d.topics : [d.topic || "Imported / standalone"]))].sort((a, b) => a.localeCompare(b));
  let any = false;
  topics.forEach((t) => {
    const decks = library.filter((d) => ((d.topics && d.topics.length) ? d.topics : [d.topic]).indexOf(t) >= 0 && deckMatchesTag(d, libTag));
    if (!decks.length) return;
    if (libFilter === "lib" && !isSaved("topic", t)) return;
    if (libFilter === "learning" && !isStudying("topic", t)) return;
    any = true;
    const subj = topicSubjectsArr(t).join(", ");
    const badge = isStudying("topic", t) ? " · 🎓 studying" : "";
    const item = document.createElement("button");
    item.type = "button"; item.className = "lib-card";
    item.innerHTML = `<span class="lib-name">${escapeHtml(t)}</span><span class="lib-meta">${subj ? escapeHtml(subj) + " · " : ""}${decks.length} deck${decks.length === 1 ? "" : "s"} · topic${badge}</span>`;
    if (courseBuild) {
      item.classList.add("selectable"); if (selHas("topic", t)) item.classList.add("selected");
      item.onclick = () => selToggle("topic", t); box.appendChild(item); return;
    }
    item.onclick = () => studyVirtual(t, false);
    const row = document.createElement("div"); row.className = "lib-row";
    const actions = document.createElement("div"); actions.className = "lib-actions";
    actions.appendChild(libActionBtn("⭐", isSaved("topic", t), isSaved("topic", t) ? "Remove from My library" : "Save topic to My library", () => toggleSaved("topic", t)));
    actions.appendChild(libActionBtn("▶", false, "Study all decks in this topic, interleaved", () => studyVirtual(t, false)));
    row.appendChild(item); row.appendChild(actions); box.appendChild(row);
  });
  if (!any) box.insertAdjacentHTML("beforeend", '<p class="lib-empty">No topics match.</p>');
}

function renderSubjectsView(box) {
  const subjects = [...new Set(library.flatMap((d) => [...deckSubjects(d)]))].sort((a, b) => a.localeCompare(b));
  let any = false;
  subjects.forEach((s) => {
    const decks = library.filter((d) => deckInSubject(d, s) && deckMatchesTag(d, libTag));
    if (!decks.length) return;
    if (libFilter === "lib" && !isSaved("subject", s)) return;
    if (libFilter === "learning" && !isStudying("subject", s)) return;
    any = true;
    const topicN = new Set(decks.flatMap((d) => d.topics || [])).size;
    const badge = isStudying("subject", s) ? " · 🎓 studying" : "";
    const meta = topicN + " topic" + (topicN === 1 ? "" : "s") + " · " + decks.length + " deck" + (decks.length === 1 ? "" : "s") + " · subject" + badge;
    const desc = (subjectMeta[s] && subjectMeta[s].description) ? `<span class="lib-desc">${escapeHtml(subjectMeta[s].description)}</span>` : "";
    const item = document.createElement("button");
    item.type = "button"; item.className = "lib-card";
    item.innerHTML = `<span class="lib-name">${escapeHtml(s)}</span><span class="lib-meta">${meta}</span>${desc}`;
    if (courseBuild) {
      item.classList.add("selectable"); if (selHas("subject", s)) item.classList.add("selected");
      item.onclick = () => selToggle("subject", s); box.appendChild(item); return;
    }
    item.onclick = () => { courseView = { type: "subject", key: s }; renderLibrary(); };
    const row = document.createElement("div"); row.className = "lib-row";
    const actions = document.createElement("div"); actions.className = "lib-actions";
    actions.appendChild(libActionBtn("⭐", isSaved("subject", s), isSaved("subject", s) ? "Remove from My library" : "Save subject to My library", () => toggleSaved("subject", s)));
    actions.appendChild(libActionBtn("🎯", false, "Gated course through this subject", () => { courseView = { type: "subject", key: s }; renderLibrary(); }));
    actions.appendChild(libActionBtn("▶", false, "Study all decks in this subject, interleaved", () => studyVirtual(s, true)));
    row.appendChild(item); row.appendChild(actions); box.appendChild(row);
  });
  if (!any) box.insertAdjacentHTML("beforeend", '<p class="lib-empty">No subjects match.</p>');
}

function renderCoursesView(box) {
  if (!courseBuild) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ghost-btn"; b.textContent = "＋ build a course";
    b.title = "Assemble your own course from decks, topics and whole subjects (in order)";
    b.onclick = () => { courseBuild = true; courseSelection = []; renderLibrary(); };
    box.appendChild(b);
  }
  const courseRow = (co, custom) => {
    if (libFilter === "lib" && !isSaved("course", co.id)) return;
    if (libFilter === "learning" && !isStudying("course", co.id)) return;
    const n = courseSize(co);
    const badge = isStudying("course", co.id) ? " · 🎓 studying" : "";
    const row = document.createElement("div"); row.className = "lib-row";
    const item = document.createElement("button"); item.type = "button"; item.className = "lib-card";
    const meta = (co.subject ? escapeHtml(co.subject) + " · " : "") + n + " deck" + (n === 1 ? "" : "s") + (custom ? " · custom course" : " · course") + badge;
    item.innerHTML = `<span class="lib-name">${escapeHtml(co.name)}</span><span class="lib-meta">${meta}</span>`;
    item.onclick = () => { courseView = { type: "course", key: co.id }; renderLibrary(); };
    const actions = document.createElement("div"); actions.className = "lib-actions";
    actions.appendChild(libActionBtn("⭐", isSaved("course", co.id), isSaved("course", co.id) ? "Remove from My library" : "Save course to My library", () => toggleSaved("course", co.id)));
    actions.appendChild(libActionBtn("🎯", false, "Gated course (ordered, locked path)", () => { courseView = { type: "course", key: co.id }; renderLibrary(); }));
    actions.appendChild(libActionBtn("▶", false, "Study interleaved (mixed review)", () => studyCourse(co)));
    if (custom) actions.appendChild(libActionBtn("🗑", false, "Delete this course", () => { if (confirm("Delete course “" + co.name + "”?")) deleteCourse(co.id); }));
    row.appendChild(item); row.appendChild(actions); box.appendChild(row);
  };
  const shipped = authoredCourses.filter((co) => courseSize(co) > 0);
  if (shipped.length) { const h = document.createElement("h2"); h.className = "lib-subject"; h.textContent = "Courses"; box.appendChild(h); shipped.forEach((co) => courseRow(co, false)); }
  if (customCourses.length) { const h = document.createElement("h2"); h.className = "lib-subject"; h.textContent = "My courses"; box.appendChild(h); customCourses.forEach((co) => courseRow(co, true)); }
  if (!shipped.length && !customCourses.length && !courseBuild) box.insertAdjacentHTML("beforeend", '<p class="lib-empty">No courses yet — tap “＋ build a course”.</p>');
}

function renderBrowseTree(box) {
  const topicDecks = new Map();
  library.forEach((d) => {
    if (!(libVisible(d) && deckMatchesTag(d, libTag))) return;
    const topics = (d.topics && d.topics.length) ? d.topics : [d.topic || "Imported / standalone"];
    topics.forEach((t) => { if (!topicDecks.has(t)) topicDecks.set(t, []); topicDecks.get(t).push(d); });
  });
  if (!topicDecks.size) {
    const empty = document.createElement("p"); empty.className = "lib-empty";
    empty.textContent = libTag ? "Nothing tagged “" + libTag + "”." : (libFilter === "lib" ? "Nothing saved yet — tap ⭐ on a deck to add it." : libFilter === "learning" ? "No decks marked for learning — tap 🎓 to start (turns on spaced repetition)." : "No decks.");
    box.appendChild(empty); return;
  }
  const bySubject = new Map();
  for (const t of topicDecks.keys()) { const subs = topicSubjectsArr(t); (subs.length ? subs : [""]).forEach((s) => { if (!bySubject.has(s)) bySubject.set(s, []); bySubject.get(s).push(t); }); }
  const subjects = [...bySubject.keys()].sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b));
  subjects.forEach((subject) => {
    if (subject) {
      const sh = document.createElement("h2"); sh.className = "lib-subject lib-subject-row";
      sh.innerHTML = `<span>${escapeHtml(subject)}</span>`;
      if (courseBuild) {
        const addS = document.createElement("button"); addS.type = "button";
        addS.className = "link lib-studyall" + (selHas("subject", subject) ? " sel" : "");
        addS.textContent = selHas("subject", subject) ? "✓ subject" : "＋ subject";
        addS.title = "Add the whole subject to the course"; addS.onclick = () => selToggle("subject", subject); sh.appendChild(addS);
      } else {
        const course = document.createElement("button"); course.type = "button"; course.className = "link lib-studyall"; course.textContent = "▶ course";
        course.title = "Ordered, gated path through " + subject; course.onclick = () => { courseView = { type: "subject", key: subject }; renderLibrary(); }; sh.appendChild(course);
        const all = document.createElement("button"); all.type = "button"; all.className = "link lib-studyall"; all.textContent = "▶ study all";
        all.title = "Study every deck in " + subject + " interleaved"; all.onclick = () => studyVirtual(subject, true); sh.appendChild(all);
      }
      box.appendChild(sh);
    }
    bySubject.get(subject).forEach((topic) => {
      const decks = topicDecks.get(topic);
      const section = document.createElement("div"); section.className = "lib-set";
      const head = document.createElement("div"); head.className = "lib-set-head";
      const heading = document.createElement("h3"); heading.textContent = topic; head.appendChild(heading);
      if (courseBuild && topic !== "Imported / standalone") {
        const addT = document.createElement("button"); addT.type = "button";
        addT.className = "link lib-pack" + (selHas("topic", topic) ? " sel" : "");
        addT.textContent = selHas("topic", topic) ? "✓ topic" : "＋ topic";
        addT.title = "Add the whole topic to the course"; addT.onclick = (event) => { event.stopPropagation(); selToggle("topic", topic); }; head.appendChild(addT);
      }
      if (!courseBuild && topic !== "Imported / standalone") {
        if (decks.length > 1) { const sa = document.createElement("button"); sa.type = "button"; sa.className = "link lib-pack"; sa.textContent = "▶ all"; sa.title = "Study all decks in this topic, interleaved"; sa.onclick = (event) => { event.stopPropagation(); studyVirtual(topic, false); }; head.appendChild(sa); }
        const dl = document.createElement("button"); dl.type = "button"; dl.className = "link lib-pack"; dl.textContent = "⤓ pack"; dl.title = "Download all decks in this topic as one importable pack"; dl.onclick = (event) => { event.stopPropagation(); downloadPack(topic, decks); }; head.appendChild(dl);
      }
      section.appendChild(head);
      decks.forEach((d) => section.appendChild(libDeckRow(d)));
      box.appendChild(section);
    });
  });
}

/* ---- session bundle: decks + progress + settings, all in one file ---- */
async function exportSession() {
  const data = { type: "lernkarto-session", version: 1, exportedAt: new Date().toISOString(), srUser, myLib: [...myLib], learning: [...learningSet], decks: importedRaw, progress: { marks: {}, sr: {} }, settings: {} };
  for (const d of library) {
    const m = await Store.get(PREFIX + "marks:" + d.id);
    if (m) { try { const o = JSON.parse(m); if (o && Object.keys(o).length) data.progress.marks[d.id] = o; } catch (e) { /* skip */ } }
    const s = await Store.get(PREFIX + "sr:" + d.id);
    if (s) { try { const o = JSON.parse(s); if (o && Object.keys(o).length) data.progress.sr[d.id] = o; } catch (e) { /* skip */ } }
    const srOn = await Store.get(PREFIX + "sr-on:" + d.id), dir = await Store.get(PREFIX + "dir:" + d.id), shuf = await Store.get(PREFIX + "shuffle:" + d.id);
    const st = {};
    if (srOn === "1" || srOn === "0") st.srOn = srOn;
    if (dir) st.dir = dir;
    if (shuf === "1" || shuf === "0") st.shuffle = shuf;
    if (Object.keys(st).length) data.settings[d.id] = st;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "lernkarto-session.json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  if ($("bundleStatus")) $("bundleStatus").textContent = "saved " + library.length + " decks + progress";
}

async function importSessionFromText(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { if ($("bundleStatus")) $("bundleStatus").textContent = "that isn't valid JSON"; return; }
  const p = (data && data.progress) || {};
  for (const [id, o] of Object.entries(p.marks || {})) await Store.set(PREFIX + "marks:" + id, JSON.stringify(o));
  for (const [id, o] of Object.entries(p.sr || {})) await Store.set(PREFIX + "sr:" + id, JSON.stringify(o));
  for (const [id, st] of Object.entries((data && data.settings) || {})) {
    if (st.srOn != null) await Store.set(PREFIX + "sr-on:" + id, st.srOn);
    if (st.dir) await Store.set(PREFIX + "dir:" + id, st.dir);
    if (st.shuffle != null) await Store.set(PREFIX + "shuffle:" + id, st.shuffle);
  }
  if (data && data.srUser) { srUser = true; await Store.set(PREFIX + "sr-user", "1"); }
  if (data && Array.isArray(data.myLib)) { myLib = new Set(data.myLib); }
  if (data && Array.isArray(data.learning)) { learningSet = new Set(data.learning); }
  if (data && (data.myLib || data.learning)) saveCollections();
  if (data && Array.isArray(data.decks) && data.decks.length) {
    // only import decks not already loaded — re-importing renames ids and would
    // duplicate decks on repeat restore (progress was already restored above).
    const fresh = data.decks.filter((d) => d && d.id && !library.find((x) => x.id === d.id));
    if (fresh.length) importFromText(JSON.stringify({ decks: fresh }));   // adds + persists (and selects one)
    else if (currentDeck) { await selectDeck(currentDeck.id); }
  } else if (currentDeck) { await selectDeck(currentDeck.id); }
  renderLibrary();
  if ($("bundleStatus")) $("bundleStatus").textContent = "session restored";
}

$("bundleSave").onclick = exportSession;
$("bundleFile").onchange = (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importSessionFromText(String(reader.result));
  reader.readAsText(file);
  event.target.value = "";
};

/* --------------------------- go ----------------------------- */
/* import a deck queued by build.html via localStorage */
const PENDING_BUILD_KEY = PREFIX + "pending-build";
function loadPendingBuild() {
  try {
    const raw = localStorage.getItem(PENDING_BUILD_KEY);
    if (!raw) return;
    localStorage.removeItem(PENDING_BUILD_KEY);
    importFromText(raw);
  } catch (e) { /* storage unavailable */ }
}


loadLibrary().then(loadPendingBuild);
