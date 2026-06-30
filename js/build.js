"use strict";
/* build.js — standalone deck builder page (build.html).
   Depends on schema.js (loaded first) for escapeHtml, slugify,
   normalizeDeck, parseInteractive, letterToIndex. */

const PENDING_KEY = "lernkarto:pending-build";

function $(id) { return document.getElementById(id); }

/* ---- helpers ---- */
function bLines(text) { return String(text).split("\n").map((s) => s.trim()).filter(Boolean); }
function bParseCorrect(str, len) {
  return String(str || "").split(/[,\s]+/).map((t) => {
    t = t.trim(); if (!t) return -1;
    return /^\d+$/.test(t) ? parseInt(t, 10) - 1 : letterToIndex(t);
  }).filter((i) => i >= 0 && i < len);
}

const B_FIELDS = {
  flip: '<label class="bfield"><span>one-liner (optional)</span><input class="bSummary" type="text" placeholder="concept in one line"></label>'
      + '<label class="bfield"><span>answer / explanation</span><textarea class="bDef" rows="3"></textarea></label>',
  mcq: '<label class="bfield"><span>choices (one per line)</span><textarea class="bChoices" rows="4"></textarea></label>'
      + '<label class="bfield"><span>correct (e.g. B or 2)</span><input class="bCorrect" type="text" placeholder="B"></label>'
      + '<label class="bfield"><span>one-liner (optional)</span><input class="bSummary" type="text"></label>'
      + '<label class="bfield"><span>explanation</span><textarea class="bDef" rows="2"></textarea></label>',
  truefalse: '<label class="bfield"><span>answer</span><select class="bBool"><option value="true">True</option><option value="false">False</option></select></label>'
      + '<label class="bfield"><span>one-liner (optional)</span><input class="bSummary" type="text"></label>'
      + '<label class="bfield"><span>explanation</span><textarea class="bDef" rows="2"></textarea></label>',
  multi: '<label class="bfield"><span>choices (one per line)</span><textarea class="bChoices" rows="4"></textarea></label>'
      + '<label class="bfield"><span>correct — all that apply (e.g. A,C,D)</span><input class="bCorrect" type="text" placeholder="A,C"></label>'
      + '<label class="bfield"><span>one-liner (optional)</span><input class="bSummary" type="text"></label>'
      + '<label class="bfield"><span>explanation</span><textarea class="bDef" rows="2"></textarea></label>',
  cloze: '<label class="bfield"><span>one-liner (optional)</span><input class="bSummary" type="text"></label>'
      + '<label class="bfield"><span>explanation</span><textarea class="bDef" rows="2"></textarea></label>',
};
const B_TERM_PLACEHOLDER = {
  flip: "term / front", mcq: "question", truefalse: "a statement that is true or false",
  multi: "question (select all that apply)", cloze: "sentence with the answer wrapped as {{answer}}",
};

function bRenderFields(row) {
  const type = row.querySelector(".bType").value;
  row.querySelector(".bfields").innerHTML = B_FIELDS[type];
  row.querySelector(".bTerm").placeholder = B_TERM_PLACEHOLDER[type];
}

function bAddCard() {
  const row = document.createElement("div");
  row.className = "bcard";
  row.innerHTML =
    '<div class="bcard-head">'
    + '<select class="bType"><option value="flip">Flip</option><option value="mcq">Multiple choice</option>'
    + '<option value="truefalse">True / False</option><option value="multi">Multi-select</option>'
    + '<option value="cloze">Cloze (fill-the-blank)</option></select>'
    + '<button type="button" class="bRemove" title="remove card">✕</button></div>'
    + '<textarea class="bTerm" rows="2"></textarea>'
    + '<div class="bfields"></div>'
    + '<div class="brow"><input class="bCat" type="text" placeholder="category (optional)">'
    + '<input class="bNote" type="text" placeholder="note / source (optional)"></div>';
  $("bCards").appendChild(row);
  row.querySelector(".bType").onchange = () => { bRenderFields(row); bSync(); };
  row.querySelector(".bRemove").onclick = () => { row.remove(); bSync(); };
  bRenderFields(row);
  bSync();
  return row;
}

function bAddCardFrom(card) {
  const row = bAddCard();
  const norm = {
    term: String((card.term || card.front) || "").trim(),
    definition: String((card.definition || card.back) || "").trim(),
    sub: String(card.sub || "").trim(),
  };
  const q = parseInteractive(norm, card);
  const kind = q ? q.kind : "flip";
  const sel = row.querySelector(".bType");
  sel.value = (kind === "boolean") ? "truefalse" : kind;
  bRenderFields(row);
  const set = (s, v) => { const el = row.querySelector(s); if (el && v != null) el.value = v; };
  set(".bTerm", norm.term);
  if (card.summary || card.tldr) set(".bSummary", card.summary || card.tldr);
  set(".bDef", norm.definition);
  if (kind === "mcq") { set(".bChoices", q.choices.join("\n")); set(".bCorrect", String(q.answer + 1)); }
  else if (kind === "multi") { set(".bChoices", q.choices.join("\n")); set(".bCorrect", q.answers.map((i) => i + 1).join(",")); }
  else if (kind === "boolean") { set(".bBool", String(q.answer)); }
  set(".bCat", card.category || "");
  set(".bNote", card.note || card.hint || "");
  return row;
}

let bMeta = {};

function bLoadIntoEditor(raw) {
  let d = raw;
  if (raw && Array.isArray(raw.decks)) d = raw.decks.find((x) => x && Array.isArray(x.cards));
  if (!d || !Array.isArray(d.cards)) { $("bError").textContent = "That file has no deck with cards."; return; }
  $("bDeckName").value = d.name || "";
  $("bDeckDesc").value = d.description || "";
  bMeta = { source: d.source || "", license: d.license || "", attribution: d.attribution || "" };
  $("bCards").innerHTML = "";
  d.cards.forEach((card) => bAddCardFrom(card));
  if (!$("bCards").children.length) bAddCard();
  $("bError").textContent = "";
  bSync();
}

function bDeckObject() {
  const deck = { name: ($("bDeckName").value.trim() || "Untitled deck") };
  const desc = $("bDeckDesc").value.trim();
  if (desc) deck.description = desc;
  if (bMeta.source) deck.source = bMeta.source;
  if (bMeta.license) deck.license = bMeta.license;
  if (bMeta.attribution) deck.attribution = bMeta.attribution;
  deck.cards = [];
  $("bCards").querySelectorAll(".bcard").forEach((row) => {
    const type = row.querySelector(".bType").value;
    const term = row.querySelector(".bTerm").value.trim();
    if (!term) return;
    const q = (sel) => { const el = row.querySelector(sel); return el ? el.value.trim() : ""; };
    const card = {};
    if (type !== "flip") card.type = type;
    card.term = term;
    if (type === "mcq") {
      card.choices = bLines(q(".bChoices"));
      const correctIdx = bParseCorrect(q(".bCorrect"), card.choices.length);
      card.answer = correctIdx.length ? correctIdx[0] : 0;
    } else if (type === "multi") {
      card.choices = bLines(q(".bChoices"));
      card.answers = bParseCorrect(q(".bCorrect"), card.choices.length);
    } else if (type === "truefalse") {
      card.answer = q(".bBool") === "true";
    }
    const summary = q(".bSummary");
    if (summary) card.summary = summary;
    card.definition = q(".bDef");
    const cat = q(".bCat");
    if (cat) card.category = cat;
    const note = q(".bNote");
    if (note) card.note = note;
    deck.cards.push(card);
  });
  return deck;
}

function bSync() { $("bJson").value = JSON.stringify(bDeckObject(), null, 2); }

/* ---- Wikipedia draft ---- */
function wikiTitleFrom(input) {
  const m = String(input).match(/wikipedia\.org\/wiki\/([^?#]+)/i);
  return (m ? decodeURIComponent(m[1]) : String(input)).replace(/_/g, " ").trim();
}

async function wikiFetch() {
  const input = $("bWikiUrl").value.trim();
  if (!input) return;
  const title = wikiTitleFrom(input);
  const status = $("bWikiStatus");
  status.textContent = "fetching “" + title + "” …";
  try {
    const res = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title),
      { headers: { accept: "application/json" } }
    );
    if (!res.ok) throw new Error(String(res.status));
    const s = await res.json();
    const pageUrl = (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page)
      || ("https://en.wikipedia.org/wiki/" + encodeURIComponent(title));
    const rev = s.revision ? (", revision " + s.revision) : "";
    bLoadIntoEditor({
      name: s.title || title,
      description: "Draft from Wikipedia — review and expand before sharing.",
      source: pageUrl,
      license: "CC BY-SA 4.0",
      attribution: '\u201c' + (s.title || title) + '\u201d on Wikipedia, by Wikipedia contributors' + rev + ' — ' + pageUrl + ' (CC BY-SA 4.0).',
      cards: [{ term: s.title || title, definition: s.extract || "", note: "Source: " + pageUrl }],
    });
    status.innerHTML = "drafted from <b>" + escapeHtml(s.title || title) + "</b> \xb7 CC BY-SA attribution auto-filled. "
      + "Expand the cards below — an in-app LLM step (planned) will generate the full deck.";
  } catch (e) {
    status.textContent = "couldn’t fetch that article — check the title/URL (needs internet; CORS-permitted Wikipedia API).";
  }
}

/* ---- event wiring ---- */
$("bWikiFetch").onclick = wikiFetch;
$("bAddCard").onclick = bAddCard;
$("bFile").onchange = (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { bLoadIntoEditor(JSON.parse(String(reader.result))); }
    catch (e) { $("bError").textContent = "That isn’t valid JSON."; }
  };
  reader.onerror = () => { $("bError").textContent = "Could not read that file."; };
  reader.readAsText(file);
  event.target.value = "";
};
document.querySelector(".build-grid").addEventListener("input", bSync);
$("bDeckName").addEventListener("input", bSync);

$("bCopy").onclick = () => {
  if (navigator.clipboard) navigator.clipboard.writeText($("bJson").value);
  $("bError").textContent = "copied to clipboard";
  setTimeout(() => { $("bError").textContent = ""; }, 1500);
};

$("bDownload").onclick = () => {
  const obj = bDeckObject();
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = slugify(obj.name) + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

$("bLoad").onclick = () => {
  const obj = bDeckObject();
  const usable = obj.cards.filter((c) => c.term && c.definition);
  if (!usable.length) { $("bError").textContent = "Each card needs a term and an answer/explanation."; return; }
  $("bError").textContent = "";
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(obj)); } catch (e) { /* storage full */ }
  location.href = "./";
};

/* start with one empty card */
bAddCard();
if ($("appVersion")) $("appVersion").textContent = "v" + APP_VERSION;
