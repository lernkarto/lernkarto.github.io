"use strict";
/* quiz-build.js — organizer-facing quiz link builder.
   Loads catalogue stubs for deck picker; encodes config as base64 JSON in URL hash. */

function $(id) { return document.getElementById(id); }

let catalogue = [];   // [{id, name, count, description}]

/* ── catalogue loader ── */
async function loadCatalogue() {
  try {
    const r = await fetch("data/catalogue.json");
    if (!r.ok) return;
    const c = await r.json();
    catalogue = Array.isArray(c.decks) ? c.decks : [];
  } catch (e) { /* catalogue optional — deck IDs can be typed manually */ }
}

/* ── deck row ── */
function makeDeckRow() {
  const row = document.createElement("div");
  row.className = "qb-deck-row";

  // deck ID / name field + catalogue picker
  const idWrap = document.createElement("div");
  idWrap.className = "bfield qb-cat-wrap";
  const idLbl = document.createElement("span"); idLbl.textContent = "deck id";
  const idInp = document.createElement("input"); idInp.type = "text"; idInp.placeholder = "e.g. aptitude-probability";
  idInp.className = "qb-deck-id";
  idWrap.appendChild(idLbl); idWrap.appendChild(idInp);

  // catalogue panel
  const panel = document.createElement("div");
  panel.className = "qb-cat-panel"; panel.hidden = true;
  const search = document.createElement("input");
  search.className = "qb-cat-search"; search.type = "text"; search.placeholder = "search decks…";
  const list = document.createElement("div");
  panel.appendChild(search); panel.appendChild(list);
  idWrap.appendChild(panel);

  function renderCatList(q) {
    list.innerHTML = "";
    const lower = q.toLowerCase();
    const items = catalogue.filter(d =>
      !q || d.name.toLowerCase().includes(lower) || d.id.toLowerCase().includes(lower)
    ).slice(0, 40);
    if (!items.length) {
      const p = document.createElement("p");
      p.style.cssText = "font-size:12px;color:var(--text-faint);padding:8px 10px;margin:0";
      p.textContent = catalogue.length ? "no matches" : "catalogue unavailable — type id manually";
      list.appendChild(p);
      return;
    }
    items.forEach(d => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "qb-cat-item";
      btn.innerHTML = `<span>${escHtml(d.name)}</span><span class="qb-cat-n">${d.count||""} cards</span>`;
      btn.addEventListener("click", () => {
        idInp.value = d.id;
        panel.hidden = true;
      });
      list.appendChild(btn);
    });
  }

  idInp.addEventListener("focus", () => {
    renderCatList(idInp.value);
    panel.hidden = false;
  });
  search.addEventListener("input", () => renderCatList(search.value));

  // close panel on outside click
  document.addEventListener("click", e => {
    if (!idWrap.contains(e.target)) panel.hidden = true;
  }, { capture: false });

  // weight field
  const wtWrap = document.createElement("div");
  wtWrap.className = "bfield qb-wt-field";
  const wtLbl = document.createElement("span"); wtLbl.textContent = "weight";
  const wtInp = document.createElement("input"); wtInp.type = "number";
  wtInp.className = "qb-deck-weight"; wtInp.min = "1"; wtInp.value = "1"; wtInp.placeholder = "1";
  wtWrap.appendChild(wtLbl); wtWrap.appendChild(wtInp);

  // remove button
  const rm = document.createElement("button");
  rm.type = "button"; rm.className = "qb-rm"; rm.title = "remove deck"; rm.textContent = "✕";
  rm.addEventListener("click", () => row.remove());

  row.appendChild(idWrap);
  row.appendChild(wtWrap);
  row.appendChild(rm);
  return row;
}

function addDeckRow() {
  $("qbDeckList").appendChild(makeDeckRow());
}

/* ── extra field row ── */
function addFieldRow(value) {
  const row = document.createElement("div");
  row.className = "qb-field-row";
  const inp = document.createElement("input");
  inp.type = "text"; inp.placeholder = "e.g. Company or Position";
  inp.className = "bfield"; inp.style.margin = "0";
  if (value) inp.value = value;
  const rm = document.createElement("button");
  rm.type = "button"; rm.className = "qb-rm"; rm.title = "remove field"; rm.textContent = "✕";
  rm.addEventListener("click", () => row.remove());
  row.appendChild(inp); row.appendChild(rm);
  $("qbFieldList").appendChild(row);
}

/* ── encode / decode ── */
function encodeConfig(cfg) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
}

/* ── generate ── */
function generate() {
  const errEl = $("qbErr");
  errEl.textContent = "";

  const title = $("qbTitle").value.trim();
  const count = parseInt($("qbCount").value, 10) || 20;
  const timeMins = parseFloat($("qbTime").value) || 30;
  const shuffle  = $("qbShuffle").checked;
  const noBack   = $("qbNoBack").checked;
  const showWeight = $("qbShowWt").checked;
  const mailto   = $("qbMailto").value.trim();

  // collect deck entries
  const deckRows = $("qbDeckList").querySelectorAll(".qb-deck-row");
  if (!deckRows.length) { errEl.textContent = "Add at least one deck."; return; }

  const decks = [];
  let anyWeighted = false;
  for (const row of deckRows) {
    const id = row.querySelector(".qb-deck-id").value.trim();
    if (!id) { errEl.textContent = "Each deck row needs an id."; return; }
    const w = parseInt(row.querySelector(".qb-deck-weight").value, 10) || 1;
    if (w !== 1) anyWeighted = true;
    decks.push(w === 1 ? id : { id, weight: w });
  }

  // extra fields
  const fields = [];
  $("qbFieldList").querySelectorAll("input[type=text]").forEach(inp => {
    const v = inp.value.trim(); if (v) fields.push(v);
  });

  // emailjs
  const ejsSvc = $("qbEjsSvc").value.trim();
  const ejsTpl = $("qbEjsTpl").value.trim();
  const ejsKey = $("qbEjsKey").value.trim();

  const cfg = {
    title: title || "lernkarto quiz",
    decks,
    count,
    time: Math.round(timeMins * 60),
  };
  if (!shuffle)    cfg.shuffle   = false;
  if (noBack)      cfg.noBack    = true;
  if (showWeight)  cfg.showWeight = true;
  if (mailto)      cfg.mailto    = mailto;
  if (fields.length) cfg.fields  = fields;
  if (ejsSvc && ejsTpl && ejsKey) cfg.ejs = { service: ejsSvc, template: ejsTpl, key: ejsKey };

  const hash = encodeConfig(cfg);
  const url  = location.origin + location.pathname.replace("quiz-build.html","") + "quiz.html#" + hash;

  $("qbUrl").value = url;
  $("qbOpen").href = url;
  $("qbOut").style.display = "block";
}

/* ── helpers ── */
function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ── init ── */
document.addEventListener("DOMContentLoaded", async () => {
  if ($("appVersion")) $("appVersion").textContent = "v" + APP_VERSION;

  await loadCatalogue();

  addDeckRow();  // start with one deck row

  $("qbAddDeck").addEventListener("click", addDeckRow);
  $("qbAddField").addEventListener("click", () => addFieldRow(""));
  $("qbGenerate").addEventListener("click", generate);

  $("qbCopy").addEventListener("click", () => {
    const url = $("qbUrl").value;
    if (!url) return;
    navigator.clipboard && navigator.clipboard.writeText(url);
    const msg = $("qbCopyMsg");
    msg.textContent = "copied!";
    setTimeout(() => { msg.textContent = ""; }, 1500);
  });

  // show/hide showWeight checkbox when all weights are 1
  // (it's only meaningful when decks have different weights)
  const showWtWrap = $("qbShowWtWrap");
  $("qbDeckList").addEventListener("input", () => {
    const hasWeighted = [...$("qbDeckList").querySelectorAll(".qb-deck-weight")]
      .some(inp => parseInt(inp.value,10) > 1);
    if (showWtWrap) showWtWrap.style.opacity = hasWeighted ? "1" : ".4";
  });
  $("qbDeckList").addEventListener("click", () => {
    const hasWeighted = [...$("qbDeckList").querySelectorAll(".qb-deck-weight")]
      .some(inp => parseInt(inp.value,10) > 1);
    if (showWtWrap) showWtWrap.style.opacity = hasWeighted ? "1" : ".4";
  });
});
