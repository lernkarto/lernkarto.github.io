"use strict";
/* ---- constants & text helpers ---- */
/* Loaded first. Defines globals used by graphs.js, primer.js, and app.js. */

const APP_VERSION = "0.3.1";

/* neon accents auto-assigned to categories without a colour */
const PALETTE = [
  "#00ff88", "#00e0d0", "#9bff66", "#ffcc55", "#ff66cc",
  "#66aaff", "#ff6b6b", "#b794ff", "#2ee6b6", "#ff9f55",
];
const DEFAULT_ACCENT = "#00ff88";

/* branding: a generic default that the loaded content (manifest / set / deck)
   can override via a `brand` object { name, tagline, accent, mark(SVG) }. */
const DEFAULT_BRAND = { name: "lernkarto", tagline: "flashcards", accent: DEFAULT_ACCENT, mark: null };

/* ----------------------------- helpers -------------------------- */
function slugify(text) {
  return String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
}
function titleCase(text) {
  return String(text).replace(/[-_]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(text) { return escapeHtml(text).replace(/"/g, "&quot;"); }

/* expand author-placed [[term]] markers into underlined spans with tooltip.
   Returns {html, refs} — html is the safe string, refs is [{term, def}].
   Only terms explicitly present in `glossary` are expanded; unknown markers
   are left as literal text so typos are visible to the author. */
function applyGlossary(rawText, glossary) {
  if (!rawText || !glossary || !Object.keys(glossary).length) {
    return { html: escapeHtml(rawText || ""), refs: [] };
  }
  const refs = [], seen = new Set();
  const html = String(rawText).split(/(\[\[[^\]]+\]\])/).map((p) => {
    const m = p.match(/^\[\[([^\]]+)\]\]$/);
    if (!m) return escapeHtml(p);
    const term = m[1], def = glossary[term];
    if (!def) return escapeHtml(p);
    if (!seen.has(term)) { refs.push({ term, def }); seen.add(term); }
    return `<span class="gloss-term" data-gloss="${escapeAttr(def)}">${escapeHtml(term)}</span>`;
  }).join("");
  return { html, refs };
}

/* turn bare http(s) URLs in already-escaped text into tappable links.
   Runs AFTER escapeHtml, so any "&" is already "&amp;" — valid in href and
   text alike. Trailing sentence punctuation is left outside the link. */
function linkify(escaped) {
  return String(escaped).replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}])/g,
    (url) => `<a class="card-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
}

/* render any LaTeX inside an element (KaTeX auto-render, if present) */
function typesetMath(element) {
  if (!element || !window.renderMathInElement) return;
  try {
    window.renderMathInElement(element, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
      ],
      throwOnError: false,
    });
  } catch (error) { /* leave raw text on failure */ }
}

/* ---------------- multiple-choice parsing ----------------
   Single-best MCQ. Authoring may give card.choices (array) + card.answer
   (index or letter); otherwise we parse the shipped text format:
   sub = "A) ...  B) ...", definition = "Correct: X) ...". Returns
   {choices:[text], answer:index} or null for a plain (flip) card. */
function letterToIndex(value) {
  const m = String(value).trim().match(/^([A-Za-z])/);
  return m ? m[1].toUpperCase().charCodeAt(0) - 65 : -1;
}
function parseMcq(norm, raw) {
  if (raw && Array.isArray(raw.choices) && raw.choices.length >= 2) {
    let answer = raw.answer;
    if (typeof answer === "string") answer = letterToIndex(answer);
    if (Number.isInteger(answer) && answer >= 0 && answer < raw.choices.length)
      return { choices: raw.choices.map((t) => String(t).trim()), answer };
    return null;
  }
  const correct = norm.definition.match(/^\s*Correct:\s*([A-Da-d])\)/);
  if (!correct || !norm.sub) return null;
  const choices = [];
  const re = /([A-Da-d])\)\s*([\s\S]*?)(?=\s{2,}[A-Da-d]\)|$)/g;
  let m;
  while ((m = re.exec(norm.sub)) !== null) {
    const text = m[2].trim();
    if (text) choices.push(text);
  }
  if (choices.length < 2) return null;
  const answer = correct[1].toUpperCase().charCodeAt(0) - 65;
  if (answer < 0 || answer >= choices.length) return null;
  return { choices, answer };
}

/* coerce ["A","C"] / "A,C" / [0,2] / "0,2" -> sorted unique indices */
function toIndexList(value, len) {
  const arr = Array.isArray(value) ? value : String(value == null ? "" : value).split(/[,\s]+/);
  const out = [];
  arr.forEach((v) => {
    let i = (typeof v === "number") ? v : (/^\d+$/.test(String(v).trim()) ? parseInt(v, 10) : letterToIndex(v));
    if (Number.isInteger(i) && i >= 0 && i < len && out.indexOf(i) < 0) out.push(i);
  });
  return out.sort((a, b) => a - b);
}

/* Resolve a card's interactive kind, or null for a plain flip card.
   kinds: mcq (single best) · multi (select all) · boolean (true/false) · cloze. */
function parseInteractive(norm, raw) {
  const type = (raw && raw.type) ? String(raw.type).toLowerCase().replace(/[^a-z]/g, "") : "";

  // CLOZE — term carries {{answer}} (or explicit type + answer)
  const clozeMatch = norm.term.match(/\{\{(.+?)\}\}/);
  if (type === "cloze" || clozeMatch) {
    const answer = clozeMatch ? clozeMatch[1].trim() : String((raw && raw.answer) || "").trim();
    if (answer) {
      const display = norm.term.replace(/\{\{.+?\}\}/, " ____ ").replace(/\s+/g, " ").trim();
      return { kind: "cloze", answer, display: display || norm.term };
    }
  }

  // TRUE / FALSE — the statement is the term
  if (type === "truefalse" || type === "boolean" || type === "tf") {
    let a = (raw && raw.answer);
    if (typeof a === "string") a = /^(t|true|yes|1)$/i.test(a.trim());
    return { kind: "boolean", answer: !!a, choices: ["True", "False"] };
  }

  // MULTI-SELECT — choices + answers (a set)
  if (type === "multi" || type === "multiselect" || (raw && Array.isArray(raw.answers))) {
    if (raw && Array.isArray(raw.choices) && raw.choices.length >= 2) {
      const answers = toIndexList(raw.answers != null ? raw.answers : raw.answer, raw.choices.length);
      if (answers.length) return { kind: "multi", choices: raw.choices.map((t) => String(t).trim()), answers };
    }
    return null;
  }

  // SINGLE-BEST MCQ — explicit choices/answer or the shipped text form
  const single = parseMcq(norm, raw);
  if (single) return { kind: "mcq", choices: single.choices, answer: single.answer };
  return null;
}

/* short, stable hash (djb2 -> base36) for content fingerprints / version ids */
function hashStr(text) {
  let h = 5381;
  const s = String(text);
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
/* per-card content fingerprint — progress is keyed to this, so editing a card
   makes it "new/unseen" while unchanged cards keep their history, and a shared
   deck (no progress in the file) loads clean. */
function cardFingerprint(card) {
  return hashStr([card.term, card.definition, card.sub, card.formula,
    card.image, card.answerImage, JSON.stringify(card.q || null)].join(""));
}
/* per-card asking direction override: forward (name→desc) | reverse | shuffle */
function normalizeDir(value) {
  const v = String(value || "").toLowerCase();
  if (/rev|desc.*name|back/.test(v)) return "reverse";
  if (/shuf|both|rand/.test(v)) return "shuffle";
  if (/fwd|forward|name.*desc/.test(v)) return "forward";
  return null;
}

/* ---------------- deck normalization (the schema) ---------------- */
/* Required: name, cards[].term, cards[].definition.
   Optional: id, author, description, color (deck accent), topic (group label),
   categories{key:{label,color}}, and per card category/sub/formula/note/image/
   answerImage/direction. front/back accepted as term/definition; LaTeX anywhere. */
function normalizeDeck(raw, fallbackId) {
  const name = (raw && raw.name) ? String(raw.name) : "Untitled deck";
  const id = (raw && raw.id) ? slugify(raw.id) : (slugify(name) || slugify(fallbackId || "deck"));
  const accent = (raw && raw.color) ? String(raw.color) : DEFAULT_ACCENT;

  const rawCategories = (raw && raw.categories) || {};
  const usedKeys = new Set(Object.keys(rawCategories));
  const rawCards = (raw && Array.isArray(raw.cards)) ? raw.cards : [];
  rawCards.forEach((card) => { if (card && card.category) usedKeys.add(String(card.category)); });

  const categories = {};
  let paletteIndex = 0;
  usedKeys.forEach((key) => {
    const definition = rawCategories[key] || {};
    const color = definition.color || PALETTE[paletteIndex++ % PALETTE.length];
    categories[key] = { label: definition.label || titleCase(key), color };
  });

  const cards = rawCards.map((card) => {
    const normalized = {
      term: String((card && (card.term || card.front)) || "").trim(),
      definition: String((card && (card.definition || card.back || (card.type ? "" : card.answer))) || "").trim(),
      summary: String((card && (card.summary || card.tldr)) || "").trim(),
      sub: String((card && (card.sub || card.subtitle)) || "").trim(),
      formula: String((card && (card.formula || card.example)) || "").trim(),
      note: String((card && (card.note || card.hint)) || "").trim(),
      image: String((card && (card.image || card.img)) || "").trim(),
      answerImage: String((card && (card.answerImage || card.answerImg || card.backImage)) || "").trim(),
      category: (card && card.category) ? String(card.category) : null,
      type: (card && card.type) ? String(card.type) : null,
      dir: normalizeDir(card && (card.direction || card.ask)),
      audio: String((card && (card.audio || card.sound)) || "").trim(),   // optional pronunciation file
      lang: (card && card.lang) ? String(card.lang) : null,               // BCP-47 for TTS (else deck.lang)
      say: String((card && card.say) || "").trim(),                       // text for TTS to speak (else term) — e.g. a kanji's kana reading
      graph: (card && card.graph && typeof card.graph === "object") ? card.graph : null,
      frontGraph: (card && card.frontGraph && typeof card.frontGraph === "object") ? card.frontGraph : null,
    };
    normalized.q = parseInteractive(normalized, card);
    normalized.fp = cardFingerprint(normalized);   // progress key (per-card content)
    return normalized;
  }).filter((card) => card.term && card.definition);

  // "dual" decks (glyph alphabets): study each card BOTH ways as separate, independently
  // tracked items — symbol→sound (forward) AND sound→symbol (reverse). You only master the
  // card once you've passed both. Interactive cards aren't directional, so they pass through.
  const dual = !!(raw && raw.dual);
  let finalCards = cards;
  if (dual) {
    const forward = [], reverse = [], other = [];
    cards.forEach((c) => {
      if (c.q) { other.push(c); return; }   // interactive cards aren't directional
      forward.push(Object.assign({}, c, { dir: "forward", fp: c.fp + "f" }));
      reverse.push(Object.assign({}, c, { dir: "reverse", fp: c.fp + "r" }));
    });
    finalCards = other.concat(forward, reverse);   // recognition pass, then recall pass (shuffle mixes them)
  }

  const author = (raw && raw.author) ? String(raw.author) : null;
  return {
    id, name, author, dual,
    slug: id,                                            // human part of the identity
    uid: hashStr(name + "|" + finalCards.map((c) => c.fp).join(",")),   // version id (content-derived)
    defaultDir: normalizeDir(raw && (raw.direction || raw.defaultDirection)) || "forward",
    description: (raw && raw.description) ? String(raw.description) : "",
    accent,
    topic: (raw && (raw.topic || raw.set)) ? String(raw.topic || raw.set) : null,   // primary topic ("set" = legacy alias)
    subject: (raw && raw.subject) ? String(Array.isArray(raw.subject) ? raw.subject[0] : raw.subject) : null,   // primary subject grouping (above topic)
    subjects: (raw && Array.isArray(raw.subjects)) ? raw.subjects.map(String) : ((raw && raw.subject) ? (Array.isArray(raw.subject) ? raw.subject.map(String) : [String(raw.subject)]) : []),  // a deck may sit in several subjects
    brand: (raw && raw.brand && typeof raw.brand === "object") ? raw.brand : null,
    source: (raw && raw.source) ? String(raw.source) : null,        // where the deck came from (e.g. a URL)
    license: (raw && raw.license) ? String(raw.license) : null,     // e.g. "CC BY-SA 4.0"
    attribution: (raw && raw.attribution) ? String(raw.attribution) : null,
    primer: (raw && raw.primer) ? String(raw.primer) : null,         // skippable one-pager recap (light markdown)
    primerTitle: (raw && raw.primerTitle) ? String(raw.primerTitle) : null,
    lang: (raw && raw.lang) ? String(raw.lang) : null,               // BCP-47 — enables the 🔊 speak button (TTS)
    tags: Array.isArray(raw && raw.tags) ? raw.tags.map((t) => String(t).toLowerCase()) : [],
    glossary: (raw && raw.glossary && typeof raw.glossary === "object" && !Array.isArray(raw.glossary)) ? raw.glossary : {},
    categories, cards: finalCards,
  };
}

/* all searchable tags for a deck: explicit tags + implicit lang / subject / topics / my-upload */
function deckTags(deck) {
  const t = new Set((deck.tags || []).map((x) => x.toLowerCase()));
  if (deck.lang) t.add("lang:" + deck.lang.toLowerCase());
  if (deck.subject) t.add(deck.subject.toLowerCase());
  (deck.topics && deck.topics.length ? deck.topics : [deck.topic]).forEach((x) => { if (x) t.add(x.toLowerCase()); });
  if (deck.imported) t.add("my-upload");
  return t;
}

/* normalized deck -> clean JSON (export / contributing) */
function deckToJson(deck) { return JSON.stringify(deckToObject(deck), null, 2); }
function deckToObject(deck) {
  const result = { id: deck.id, name: deck.name };
  if (deck.author) result.author = deck.author;
  if (deck.defaultDir && deck.defaultDir !== "forward") result.direction = deck.defaultDir;
  if (deck.source) result.source = deck.source;
  if (deck.license) result.license = deck.license;
  if (deck.attribution) result.attribution = deck.attribution;
  if (deck.primer) result.primer = deck.primer;
  if (deck.primerTitle) result.primerTitle = deck.primerTitle;
  if (deck.lang) result.lang = deck.lang;
  if (deck.tags && deck.tags.length) result.tags = deck.tags;
  if (deck.dual) result.dual = true;
  if (deck.description) result.description = deck.description;
  if (deck.accent && deck.accent !== DEFAULT_ACCENT) result.color = deck.accent;
  if (deck.topic) result.topic = deck.topic;
  if (deck.subjects && deck.subjects.length > 1) result.subjects = deck.subjects;
  else if (deck.subject) result.subject = deck.subject;
  if (Object.keys(deck.categories).length) {
    result.categories = {};
    Object.keys(deck.categories).forEach((key) => {
      result.categories[key] = { label: deck.categories[key].label, color: deck.categories[key].color };
    });
  }
  // a dual deck is stored expanded (2 items/card); export the unique originals + the flag
  result.cards = (deck.dual ? deck.cards.filter((c) => c.dir === "forward") : deck.cards).map((card) => {
    const out = { term: card.term };
    if (card.type) out.type = card.type;
    // structured interactive fields (skip when already encoded in the legacy sub form)
    if (card.q && !card.sub) {
      if (card.q.kind === "mcq") { out.choices = card.q.choices; out.answer = card.q.answer; }
      else if (card.q.kind === "multi") { out.choices = card.q.choices; out.answers = card.q.answers; }
      else if (card.q.kind === "boolean") { out.answer = card.q.answer; }
      // cloze: the answer lives in the {{...}} marker inside term
    }
    if (card.summary) out.summary = card.summary;
    out.definition = card.definition;
    if (card.image) out.image = card.image;
    if (card.answerImage) out.answerImage = card.answerImage;
    if (card.dir && !deck.dual) out.direction = card.dir;   // dual pins direction itself
    if (card.category) out.category = card.category;
    if (card.sub) out.sub = card.sub;
    if (card.formula) out.formula = card.formula;
    if (card.note) out.note = card.note;
    if (card.audio) out.audio = card.audio;
    if (card.lang) out.lang = card.lang;
    if (card.say) out.say = card.say;
    return out;
  });
  return result;
}
