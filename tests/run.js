#!/usr/bin/env node
/* Zero-dependency test runner for the lernkarto engine.
 *
 * app.js is a browser script (not a module), so we load it into a Node `vm`
 * context with a minimal stubbed DOM. Top-level `function` declarations land on
 * the context's global, which lets us unit-test the pure data-layer functions
 * (fingerprints, card parsing, deck normalisation, grading, CSV import, tags,
 * virtual decks) without a browser.
 *
 *   node tests/run.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* ---- minimal DOM / browser stubs (enough for app.js to load) ---- */
function noopEl() {
  const store = {};
  return new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === "style" || p === "dataset") return (t[p] = t[p] || {});
      if (p === "classList") return (t[p] = t[p] || { add() {}, remove() {}, toggle() {}, contains() { return false; } });
      if (p === "children" || p === "files") return [];
      if (p === "querySelectorAll") return () => [];
      if (p === "querySelector" || p === "closest") return () => null;
      if (p === "appendChild") return (c) => c;
      if (p === "hidden" || p === "checked" || p === "disabled") return false;
      if (["value", "textContent", "innerHTML", "className", "href", "download"].includes(p)) return t[p] || "";
      return () => undefined;             // any other method → no-op
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}
const documentStub = {
  getElementById: () => noopEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => noopEl(),
  addEventListener: () => {},
  body: noopEl(),
};
const localStore = new Map();
const sandbox = {
  console, setTimeout, clearTimeout, Promise, Date, Math, JSON, RegExp, Object, Array, String, Number, Boolean, Set, Map, Error, parseInt, parseFloat, isNaN,
  document: documentStub,
  navigator: { language: "en", serviceWorker: { getRegistrations: async () => [] } },
  location: { reload() {}, href: "" },
  localStorage: {
    getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
    setItem: (k, v) => localStore.set(k, String(v)),
    removeItem: (k) => localStore.delete(k),
  },
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "" }),
  Audio: class { play() { return Promise.resolve(); } addEventListener() {} },
  Blob: class {},
  URL: { createObjectURL: () => "", revokeObjectURL() {} },
  SpeechSynthesisUtterance: class {},
  speechSynthesis: { getVoices: () => [], speak() {}, cancel() {} },
  renderMathInElement: () => {},
  katex: { render: () => {} },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  alert: () => {}, confirm: () => true,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

// Load scripts in the same order the browser does: schema.js first, then app.js.
// (graphs.js is a development extract that duplicates the graph code already in app.js
//  and is not loaded by index.html, so it is not included here.)
const ctx = vm.createContext(sandbox);
["schema.js", "app.js"].forEach(name => {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", name), "utf8");
  vm.runInContext(src, ctx, { filename: name });
});

/* ---- tiny assertion harness ---- */
let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
const fn = (name) => { const f = ctx[name]; if (typeof f !== "function") { fail++; fails.push(`MISSING function ${name}`); return () => undefined; } return f; };

/* ---- tests ---- */
// hashStr / cardFingerprint
const hashStr = fn("hashStr"), cardFingerprint = fn("cardFingerprint");
ok(hashStr("abc") === hashStr("abc"), "hashStr deterministic");
ok(hashStr("abc") !== hashStr("abd"), "hashStr distinguishes input");
const cardA = { term: "VaR", definition: "loss quantile", sub: "", formula: "", note: "", image: "", answerImage: "" };
const cardB = { ...cardA, definition: "different" };
ok(cardFingerprint(cardA) === cardFingerprint(cardA), "cardFingerprint stable");
ok(cardFingerprint(cardA) !== cardFingerprint(cardB), "cardFingerprint changes with content");

// normalizeDir
const normalizeDir = fn("normalizeDir");
eq(normalizeDir("reverse"), "reverse", "normalizeDir reverse");
eq(normalizeDir("rev"), "reverse", "normalizeDir rev");
eq(normalizeDir("shuffle"), "shuffle", "normalizeDir shuffle");
eq(normalizeDir("both"), "shuffle", "normalizeDir both→shuffle");
eq(normalizeDir("forward"), "forward", "normalizeDir forward");
eq(normalizeDir(""), null, "normalizeDir empty→null");

// parseInteractive (via normalizeDeck so card.q is populated)
const normalizeDeck = fn("normalizeDeck");
const mixed = normalizeDeck({
  name: "T", cards: [
    { term: "Q?", sub: "A) one    B) two    C) three    D) four", definition: "Correct: B) two. because." },
    { type: "truefalse", answer: true, term: "sky is blue", definition: "yes" },
    { type: "cloze", term: "the {{answer}} is hidden", definition: "x" },
    { type: "multi", choices: ["a", "b", "c"], answers: [0, 2], term: "pick", definition: "y" },
    { term: "plain", definition: "flip card" },
  ],
}, "t");
eq(mixed.cards.length, 5, "normalizeDeck keeps all valid cards");
eq(mixed.cards[0].q.kind, "mcq", "parse mcq kind");
eq(mixed.cards[0].q.answer, 1, "parse mcq correct index (B=1)");
eq(mixed.cards[0].q.choices.length, 4, "parse mcq 4 choices");
eq(mixed.cards[1].q.kind, "boolean", "parse truefalse kind");
eq(mixed.cards[1].q.answer, true, "parse truefalse answer");
eq(mixed.cards[2].q.kind, "cloze", "parse cloze kind");
eq(mixed.cards[2].q.answer, "answer", "parse cloze answer");
eq(mixed.cards[3].q.kind, "multi", "parse multi kind");
eq(mixed.cards[3].q.answers, [0, 2], "parse multi answers");
ok(!mixed.cards[4].q, "plain flip has no q");
ok(mixed.cards.every((c) => c.fp), "every card gets a fingerprint");

// dual expansion + tags
const dual = normalizeDeck({ name: "D", dual: true, tags: ["Foo", "BAR"], cards: [{ term: "あ", definition: "a" }, { term: "い", definition: "i" }] }, "d");
eq(dual.cards.length, 4, "dual deck doubles cards (2→4)");
eq(dual.cards.filter((c) => c.dir === "forward").length, 2, "dual: 2 forward");
eq(dual.cards.filter((c) => c.dir === "reverse").length, 2, "dual: 2 reverse");
ok(new Set(dual.cards.map((c) => c.fp)).size === 4, "dual: 4 distinct fingerprints");
eq(dual.tags, ["foo", "bar"], "tags lowercased");

// gradeTyped
const gradeTyped = fn("gradeTyped");
ok(gradeTyped("a", "a (as in 'car')"), "gradeTyped strips parenthetical");
ok(gradeTyped("KA", "ka"), "gradeTyped case-insensitive");
ok(gradeTyped("e", "é"), "gradeTyped accent-insensitive");
ok(!gradeTyped("x", "ka"), "gradeTyped rejects wrong");
ok(!gradeTyped("", "ka"), "gradeTyped rejects empty");
ok(gradeTyped("あ", "あ"), "gradeTyped exact glyph match");
ok(!gradeTyped("い", "あ"), "gradeTyped rejects wrong glyph");

// parseDelimited (CSV / TSV import)
const parseDelimited = fn("parseDelimited");
const csv = parseDelimited("term,definition\nあ,a\nか,ka");
eq(csv.cards.length, 2, "CSV with header → 2 cards");
eq(csv.cards[0].term, "あ", "CSV term");
eq(csv.cards[0].definition, "a", "CSV definition");
const tsv = parseDelimited("dog\tinu\ncat\tneko");
eq(tsv.cards.length, 2, "headerless TSV → 2 cards");
eq([tsv.cards[1].term, tsv.cards[1].definition], ["cat", "neko"], "TSV positional");
const quoted = parseDelimited('term,definition\n"a, b",x');
eq(quoted.cards[0].term, "a, b", "CSV quoted field with comma");

// deckTags
const deckTags = fn("deckTags");
const tagged = deckTags({ tags: ["risk"], lang: "ja", subject: "Languages", topic: "Kana", topics: ["Kana"] });
ok(tagged.has("risk"), "deckTags explicit");
ok(tagged.has("lang:ja"), "deckTags lang");
ok(tagged.has("languages"), "deckTags subject (lowercased)");
ok(tagged.has("kana"), "deckTags topic");
ok(!tagged.has("my-upload"), "deckTags no my-upload for non-imported deck");
ok(deckTags({ imported: true, tags: [] }).has("my-upload"), "deckTags my-upload set for imported deck");

// normalizeDeck: graph / frontGraph fields preserved
const withGraph = normalizeDeck({ name: "G", cards: [
  { term: "t", definition: "d", graph: { type: "normal", params: { mu: 0, sigma: 1 }, controls: ["mu", "sigma"] } },
  { term: "plain", definition: "no graph" },
  { term: "q", definition: "a", frontGraph: { type: "normal", params: { mu: 0, sigma: 1 }, controls: [] } },
]}, "g");
ok(withGraph.cards[0].graph !== null, "normalizeDeck preserves card.graph when present");
eq(withGraph.cards[0].graph.type, "normal", "normalizeDeck preserves graph.type");
ok(withGraph.cards[1].graph === null, "normalizeDeck sets graph=null when absent");
ok(withGraph.cards[2].frontGraph !== null, "normalizeDeck preserves card.frontGraph when present");
eq(withGraph.cards[2].frontGraph.type, "normal", "normalizeDeck preserves frontGraph.type");
ok(withGraph.cards[0].frontGraph === null, "normalizeDeck sets frontGraph=null when absent");
ok(withGraph.cards[1].frontGraph === null, "normalizeDeck sets frontGraph=null on plain card");

// mdToHtml: ```graph fences become .primer-graph placeholder divs
const mdToHtml = fn("mdToHtml");
const mdOut = mdToHtml('## Heading\n```graph\n{"type":"normal","params":{"mu":0,"sigma":1},"controls":["mu"]}\n```\nparagraph');
ok(mdOut.includes('class="primer-graph"'), "mdToHtml emits primer-graph div for graph fence");
ok(mdOut.includes("data-spec="), "mdToHtml sets data-spec on primer-graph div");
ok(!mdOut.includes("```graph"), "mdToHtml consumes the graph fence (no raw backticks left)");
ok(mdOut.includes("<h3>"), "mdToHtml still processes other markdown after graph fence");
ok(mdOut.includes("<p>"), "mdToHtml still processes paragraphs after graph fence");
const mdNoGraph = mdToHtml("## Title\njust text");
ok(!mdNoGraph.includes("primer-graph"), "mdToHtml leaves non-graph content untouched");

// virtualFromDecks — owner tagging + owner-keyed dedup (shared fp across decks kept)
const virtualFromDecks = fn("virtualFromDecks");
const dkA = { id: "A", accent: "#fff", cards: [{ fp: "x1", term: "t", definition: "d" }, { fp: "shared", term: "s", definition: "d" }] };
const dkB = { id: "B", cards: [{ fp: "y1", term: "u", definition: "e" }, { fp: "shared", term: "s2", definition: "e" }] };
const v = virtualFromDecks([dkA, dkB], "course:1", "My course");
eq(v.cards.length, 4, "virtual keeps shared-fp cards from both owners (owner-keyed dedup)");
ok(v.cards.every((c) => c._owner === "A" || c._owner === "B"), "virtual cards carry _owner");
eq(v.cards.filter((c) => c.fp === "shared").map((c) => c._owner).sort(), ["A", "B"], "shared fp routes to both owners");
ok(v.virtual === true, "virtual flag set");

/* ---- manifest consistency ---- */
// data/manifest.json must be in sync with the actual files in data/{topics,subjects,courses,decks}/
const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "manifest.json"), "utf8"));

// topics: manifest → file exists + every deckFile it references exists
const topicFileSet = new Set(manifest.topics || []);
const parsedTopics = {};   // cache to avoid re-reading for orphan check below
(manifest.topics || []).forEach((tf) => {
  const tp = path.join(ROOT, "data", "topics", tf);
  ok(fs.existsSync(tp), `data/topics/${tf} listed in manifest exists`);
  if (fs.existsSync(tp)) {
    const topic = JSON.parse(fs.readFileSync(tp, "utf8"));
    parsedTopics[tf] = topic;
    const missing = (topic.deckFiles || []).filter((df) => !fs.existsSync(path.join(ROOT, "data", "decks", df)));
    ok(missing.length === 0, `${tf}: all deckFiles exist${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}`);
  }
});
// topics: no file in data/topics/ is absent from the manifest (would be silently ignored by the app)
fs.readdirSync(path.join(ROOT, "data", "topics")).filter((f) => f.endsWith(".json"))
  .forEach((f) => ok(topicFileSet.has(f), `data/topics/${f} is listed in manifest.topics`));

// subjects: manifest → file exists + has name field
const subjectFileSet = new Set(manifest.subjects || []);
(manifest.subjects || []).forEach((sf) => {
  const sp = path.join(ROOT, "data", "subjects", sf);
  ok(fs.existsSync(sp), `data/subjects/${sf} listed in manifest exists`);
  if (fs.existsSync(sp)) {
    const subj = JSON.parse(fs.readFileSync(sp, "utf8"));
    ok(typeof subj.name === "string" && subj.name.length > 0, `${sf}: has name field`);
  }
});
// subjects: no file in data/subjects/ absent from manifest
fs.readdirSync(path.join(ROOT, "data", "subjects")).filter((f) => f.endsWith(".json"))
  .forEach((f) => ok(subjectFileSet.has(f), `data/subjects/${f} is listed in manifest.subjects`));

// courses: manifest → file exists + has id field
const courseFileSet = new Set(manifest.courses || []);
(manifest.courses || []).forEach((cf) => {
  const cp = path.join(ROOT, "data", "courses", cf);
  ok(fs.existsSync(cp), `data/courses/${cf} listed in manifest exists`);
  if (fs.existsSync(cp)) {
    const course = JSON.parse(fs.readFileSync(cp, "utf8"));
    ok(typeof course.id === "string" && course.id.length > 0, `${cf}: has id field`);
  }
});
// courses: no file in data/courses/ absent from manifest
fs.readdirSync(path.join(ROOT, "data", "courses")).filter((f) => f.endsWith(".json"))
  .forEach((f) => ok(courseFileSet.has(f), `data/courses/${f} is listed in manifest.courses`));

// orphan decks: every .json in data/decks/ must be referenced by at least one topic
const referencedDecks = new Set(Object.values(parsedTopics).flatMap((t) => t.deckFiles || []));
const orphanDecks = fs.readdirSync(path.join(ROOT, "data", "decks")).filter((f) => f.endsWith(".json") && !referencedDecks.has(f));
ok(orphanDecks.length === 0, `no orphan decks in data/decks/${orphanDecks.length ? " (orphans: " + orphanDecks.join(", ") + ")" : ""}`);

/* ---- report ---- */
console.log(`\n${pass} passed, ${fail} failed  (${pass + fail} assertions)`);
if (fail) { console.log("\nFAILURES:"); fails.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
console.log("✓ all green");
