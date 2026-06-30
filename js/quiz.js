"use strict";
/* quiz.js — student-facing timed quiz engine.
   Reads config from URL hash: quiz.html#<base64(JSON)>
   Config schema: { title, decks, count, time, shuffle, noBack, showWeight,
                    mailto, fields, ejs: {service, template, key} }
   decks entries: string id (weight 1) or {id, weight}. */

const QS_KEY = "lernkarto:quiz-session";

let QCfg    = null;
let QCards  = [];     // [{card, weight, deckId}]
let QAns    = {};     // cardIdx → answer value
let QCur    = 0;
let QStart  = null;   // Date.now() when quiz began
let QTimInt = null;
let QStud   = {};     // {firstName, lastName, email, ...extraFields}
let QDone   = false;

function $(id) { return document.getElementById(id); }

/* ── config from URL ── */
function decodeConfig() {
  const hash = location.hash.slice(1);
  if (!hash) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(hash)))); }
  catch (e) { return null; }
}

function normDeck(entry) {
  if (typeof entry === "string") return { id: entry, weight: 1 };
  return { id: String(entry.id), weight: Number(entry.weight) > 0 ? Number(entry.weight) : 1 };
}

/* ── screens ── */
function showScreen(id) {
  ["qzLoading","qzErr","qzReg","qzQuiz","qzDone"].forEach(s => {
    const el = $(s); if (el) el.hidden = (s !== id);
  });
}

/* ── timer ── */
function pad2(n) { return String(Math.max(0, n)).padStart(2, "0"); }
function fmtTime(s) { s = Math.max(0, Math.round(s)); return pad2(Math.floor(s/60)) + ":" + pad2(s % 60); }

function startTimer() {
  const end = QStart + QCfg.time * 1000;
  function tick() {
    const rem = (end - Date.now()) / 1000;
    const el = $("qzTimer");
    if (el) { el.textContent = fmtTime(rem); el.classList.toggle("warn", rem <= 60); }
    if (rem <= 0) { clearInterval(QTimInt); doSubmit(true); } else saveSession();
  }
  tick();
  QTimInt = setInterval(tick, 1000);
}

/* ── session persistence (survives accidental refresh) ── */
function saveSession() {
  try {
    sessionStorage.setItem(QS_KEY, JSON.stringify({
      hash: location.hash, cards: QCards, ans: QAns,
      cur: QCur, start: QStart, stud: QStud,
    }));
  } catch (e) {}
}

function restoreSession() {
  try {
    const raw = sessionStorage.getItem(QS_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s || s.hash !== location.hash || !s.start || !s.cards) return false;
    if (s.start + QCfg.time * 1000 <= Date.now()) return false; // already timed out
    QCards = s.cards; QAns = s.ans || {}; QCur = s.cur || 0;
    QStart = s.start; QStud = s.stud || {};
    return true;
  } catch (e) { return false; }
}

/* ── shuffle ── */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── safe HTML escape (no KaTeX in quiz) ── */
function esc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ── render one question ── */
function renderQ(idx) {
  const entry = QCards[idx];
  const card  = entry.card;
  const type  = card.type || "flip";

  // progress
  const n = $("qzCurrNum"), t = $("qzTotNum"), bar = $("qzPBar");
  if (n) n.textContent = idx + 1;
  if (t) t.textContent = QCards.length;
  if (bar) bar.style.width = ((idx + 1) / QCards.length * 100) + "%";

  // question header
  const qEl = $("qzQ");
  if (qEl) {
    let html = `<span class="qz-badge">${esc(type.toUpperCase())}</span>`;
    if (QCfg.showWeight && entry.weight !== 1) {
      html += `<span class="qz-wt">×${entry.weight}</span>`;
    }
    html += `<div class="qz-qtext">${esc(card.term)}</div>`;
    qEl.innerHTML = html;
  }

  // answer area
  const area = $("qzAns");
  if (!area) return;
  area.innerHTML = "";
  const stored = QAns[idx];

  if (type === "mcq") {
    (card.choices || []).forEach((ch, ci) => {
      const lbl = buildChoice("radio", "qa", ci, stored === ci, ch,
        () => { QAns[idx] = ci; refreshSelClass(area, ci); saveSession(); });
      area.appendChild(lbl);
    });
  } else if (type === "multi") {
    const stored2 = Array.isArray(stored) ? stored : [];
    (card.choices || []).forEach((ch, ci) => {
      const lbl = buildChoice("checkbox", null, ci, stored2.includes(ci), ch, (inp) => {
        const arr = Array.isArray(QAns[idx]) ? QAns[idx].slice() : [];
        if (inp.checked) { if (!arr.includes(ci)) arr.push(ci); }
        else { const p = arr.indexOf(ci); if (p >= 0) arr.splice(p, 1); }
        arr.sort((a, b) => a - b);
        QAns[idx] = arr;
        lbl.classList.toggle("sel", inp.checked);
        saveSession();
      });
      area.appendChild(lbl);
    });
  } else if (type === "truefalse" || type === "boolean") {
    [true, false].forEach(val => {
      const lbl = buildChoice("radio", "qa", val, stored === val, val ? "True" : "False",
        () => { QAns[idx] = val; refreshSelClass(area, val); saveSession(); });
      area.appendChild(lbl);
    });
  } else {
    // flip / cloze: text area
    const ta = document.createElement("textarea");
    ta.className = "qz-textarea";
    ta.rows = 4;
    ta.placeholder = type === "cloze" ? "fill in the blank…" : "your answer…";
    ta.value = typeof stored === "string" ? stored : "";
    ta.addEventListener("input", () => { QAns[idx] = ta.value; saveSession(); });
    area.appendChild(ta);
  }

  // nav button state
  const prev = $("qzPrev"), next = $("qzNext"), sub = $("qzSubmit");
  const last = (idx === QCards.length - 1);
  if (prev) { prev.hidden = !!QCfg.noBack; prev.disabled = (idx === 0); }
  if (next) next.hidden = last;
  if (sub)  sub.hidden  = !last;
}

function buildChoice(type, name, value, checked, label, onChange) {
  const lbl = document.createElement("label");
  lbl.className = "qz-choice" + (checked ? " sel" : "");
  const inp = document.createElement("input");
  inp.type = type;
  if (name) inp.name = name;
  inp.value = String(value);
  inp.checked = checked;
  inp.addEventListener("change", () => onChange(inp));
  lbl.appendChild(inp);
  const sp = document.createElement("span");
  sp.textContent = label;
  lbl.appendChild(sp);
  return lbl;
}

function refreshSelClass(area, selectedVal) {
  area.querySelectorAll(".qz-choice").forEach((lbl, i) => {
    const inp = lbl.querySelector("input");
    lbl.classList.toggle("sel", inp && inp.checked);
  });
}

/* ── submission ── */
async function doSubmit(timedOut) {
  if (QDone) return;
  QDone = true;
  clearInterval(QTimInt);
  showScreen("qzDone");
  sessionStorage.removeItem(QS_KEY);

  const timeSecs = QStart
    ? Math.min(QCfg.time, Math.round((Date.now() - QStart) / 1000))
    : QCfg.time;

  // per-card result objects
  const results = QCards.map((entry, i) => {
    const card  = entry.card;
    const type  = card.type || "flip";
    const raw   = QAns[i];
    const auto  = ["mcq","multi","truefalse","boolean"].includes(type);

    const studentAns = (() => {
      if (type === "mcq") return raw != null ? (card.choices||[])[raw] ?? "(no answer)" : "(no answer)";
      if (type === "multi") return Array.isArray(raw) && raw.length ? raw.map(ai=>(card.choices||[])[ai]).join(", ") : "(no answer)";
      if (type === "truefalse"||type === "boolean") return raw != null ? (raw ? "True" : "False") : "(no answer)";
      return typeof raw === "string" && raw.trim() ? raw.trim() : "(no answer)";
    })();

    const correctAns = (() => {
      if (type === "mcq") return (card.choices||[])[card.answer] ?? "";
      if (type === "multi") return (card.answers||[]).map(ai=>(card.choices||[])[ai]).join(", ");
      if (type === "truefalse"||type === "boolean") return card.answer ? "True" : "False";
      return card.definition || "";
    })();

    const correct = auto ? (() => {
      if (type === "mcq") return raw === card.answer;
      if (type === "multi") {
        const exp = (card.answers||[]).slice().sort((a,b)=>a-b);
        const got = Array.isArray(raw) ? raw.slice().sort((a,b)=>a-b) : [];
        return JSON.stringify(exp) === JSON.stringify(got);
      }
      if (type === "truefalse"||type === "boolean") return raw === card.answer;
      return false;
    })() : null;

    return { n: i+1, type, term: card.term, studentAns, correctAns, correct, auto, weight: entry.weight };
  });

  // weighted score (auto-gradeable only)
  const autoR    = results.filter(r => r.auto);
  const maxScore = autoR.reduce((s, r) => s + r.weight, 0);
  const score    = autoR.filter(r => r.correct).reduce((s, r) => s + r.weight, 0);
  const manual   = results.filter(r => !r.auto).length;
  const scoreStr = maxScore > 0
    ? `${score}/${maxScore}` + (manual ? ` auto-graded (+ ${manual} open answer${manual!==1?"s":""} require manual review)` : "")
    : `${manual} open answer${manual!==1?"s":""} — manual review required`;

  // extra student fields for email table
  const extraRows = Object.entries(QStud)
    .filter(([k]) => !["firstName","lastName","email"].includes(k))
    .map(([k,v]) => `<tr><td style="padding:4px 10px 4px 0;color:#7f867a">${esc(k)}</td><td style="padding:4px 10px">${esc(v)}</td></tr>`)
    .join("");

  // question result rows
  const qRows = results.map(r => {
    const mark = r.auto ? (r.correct ? "✓" : "✗") : "?";
    const mc   = r.auto ? (r.correct ? "#0BDA51" : "#FF6B6B") : "#9B8E8E";
    const wtTxt = r.weight !== 1 ? ` ×${r.weight}` : "";
    return `<tr>
<td style="padding:6px 10px;border:1px solid #2c2c2c;white-space:nowrap"><b>${r.n}</b></td>
<td style="padding:6px 10px;border:1px solid #2c2c2c;color:#565d52;font-size:11px">${esc(r.type.toUpperCase())}${wtTxt}</td>
<td style="padding:6px 10px;border:1px solid #2c2c2c">${esc(r.term)}</td>
<td style="padding:6px 10px;border:1px solid #2c2c2c">${esc(r.studentAns)}</td>
<td style="padding:6px 10px;border:1px solid #2c2c2c;color:#565d52">${r.auto ? esc(r.correctAns) : "—"}</td>
<td style="padding:6px 10px;border:1px solid #2c2c2c;text-align:center;color:${mc};font-weight:700">${mark}</td>
</tr>`;
  }).join("");

  const emailHtml = `<div style="font-family:monospace;background:#0d0d0d;color:#dfe3da;padding:28px;border-radius:8px;max-width:800px">
<h2 style="color:#00ff88;margin:0 0 18px;letter-spacing:.04em">Quiz results — ${esc(QCfg.title||"lernkarto quiz")}</h2>
<table style="border-collapse:collapse;margin-bottom:16px">
<tr><td style="padding:4px 10px 4px 0;color:#7f867a">Name</td><td style="padding:4px 10px">${esc(QStud.firstName)} ${esc(QStud.lastName)}</td></tr>
<tr><td style="padding:4px 10px 4px 0;color:#7f867a">Email</td><td style="padding:4px 10px">${esc(QStud.email)}</td></tr>
${extraRows}
<tr><td style="padding:4px 10px 4px 0;color:#7f867a">Date</td><td style="padding:4px 10px">${new Date().toISOString().slice(0,10)}</td></tr>
<tr><td style="padding:4px 10px 4px 0;color:#7f867a">Time taken</td><td style="padding:4px 10px">${fmtTime(timeSecs)} / ${fmtTime(QCfg.time)}${timedOut?" (time expired)":""}</td></tr>
<tr><td style="padding:4px 10px 4px 0;color:#7f867a">Score</td><td style="padding:4px 10px;font-weight:700;color:#00ff88">${esc(scoreStr)}</td></tr>
</table>
<table style="width:100%;border-collapse:collapse;font-size:13px">
<tr style="background:#1a1c1a">
<th style="padding:7px 10px;border:1px solid #2c2c2c;text-align:left;color:#7f867a">#</th>
<th style="padding:7px 10px;border:1px solid #2c2c2c;text-align:left;color:#7f867a">type</th>
<th style="padding:7px 10px;border:1px solid #2c2c2c;text-align:left;color:#7f867a">question</th>
<th style="padding:7px 10px;border:1px solid #2c2c2c;text-align:left;color:#7f867a">student's answer</th>
<th style="padding:7px 10px;border:1px solid #2c2c2c;text-align:left;color:#7f867a">correct answer</th>
<th style="padding:7px 10px;border:1px solid #2c2c2c;color:#7f867a">✓/✗</th>
</tr>
${qRows}
</table>
<p style="margin:16px 0 0;font-size:10px;color:#565d52">sent by lernkarto quiz engine</p>
</div>`;

  // send via EmailJS if configured
  if (QCfg.ejs && QCfg.ejs.service && QCfg.ejs.template && QCfg.ejs.key) {
    try {
      await loadEmailJS();
      emailjs.init({ publicKey: QCfg.ejs.key });
      await emailjs.send(QCfg.ejs.service, QCfg.ejs.template, {
        to_email:     QCfg.mailto || "",
        reply_to:     QStud.email,
        quiz_title:   QCfg.title || "lernkarto quiz",
        student_name: `${QStud.firstName} ${QStud.lastName}`,
        student_email: QStud.email,
        score:        scoreStr,
        time_taken:   `${fmtTime(timeSecs)} / ${fmtTime(QCfg.time)}`,
        message:      emailHtml,
      });
    } catch (err) {
      console.error("EmailJS:", err);
    }
  }
}

function loadEmailJS() {
  return new Promise((resolve, reject) => {
    if (typeof emailjs !== "undefined") { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("EmailJS failed to load"));
    document.head.appendChild(s);
  });
}

/* ── init ── */
async function init() {
  if ($("appVersion")) $("appVersion").textContent = "v" + APP_VERSION;

  QCfg = decodeConfig();
  if (!QCfg || !QCfg.decks) {
    $("qzErrMsg").textContent = "No quiz configuration found in the URL. Use the link provided by your quiz organizer.";
    showScreen("qzErr");
    return;
  }

  const deckEntries = (Array.isArray(QCfg.decks) ? QCfg.decks : [QCfg.decks]).map(normDeck);

  // restore session before fetching (fast path)
  if (restoreSession()) {
    showScreen("qzQuiz");
    renderQ(QCur);
    startTimer();
    return;
  }

  // load decks
  let allCards = [];
  try {
    const decks = await Promise.all(
      deckEntries.map(e =>
        fetch("data/decks/" + e.id + ".json").then(r => {
          if (!r.ok) throw new Error("Deck '" + e.id + "' not found");
          return r.json();
        })
      )
    );
    decks.forEach((deck, di) => {
      const weight = deckEntries[di].weight;
      (deck.cards || []).forEach(card => allCards.push({ card, weight, deckId: deckEntries[di].id }));
    });
  } catch (e) {
    $("qzErrMsg").textContent = "Failed to load quiz: " + e.message;
    showScreen("qzErr");
    return;
  }

  // optional category filter
  if (Array.isArray(QCfg.categories) && QCfg.categories.length) {
    const cats = QCfg.categories.map(c => c.toLowerCase());
    allCards = allCards.filter(e => e.card.category && cats.includes(e.card.category.toLowerCase()));
  }
  if (!allCards.length) {
    $("qzErrMsg").textContent = "No cards match the quiz configuration.";
    showScreen("qzErr");
    return;
  }

  // sample
  const ordered = QCfg.shuffle === false ? allCards : shuffle(allCards);
  const count   = QCfg.count != null ? Math.min(Number(QCfg.count), allCards.length) : allCards.length;
  QCards = ordered.slice(0, count);

  // registration screen
  $("qzTitle").textContent = QCfg.title || "lernkarto quiz";
  const m = Math.floor((QCfg.time || 0) / 60);
  $("qzSubtitle").textContent =
    QCards.length + " question" + (QCards.length !== 1 ? "s" : "") +
    " · " + m + " minute" + (m !== 1 ? "s" : "");

  // extra student fields
  const extra = $("qzExtra");
  if (extra && Array.isArray(QCfg.fields)) {
    QCfg.fields.forEach(f => {
      const lbl = document.createElement("label");
      lbl.className = "bfield";
      const sp = document.createElement("span"); sp.textContent = String(f).toLowerCase();
      const inp = document.createElement("input"); inp.type = "text"; inp.dataset.qf = f;
      lbl.appendChild(sp); lbl.appendChild(inp);
      extra.appendChild(lbl);
    });
  }

  $("qzRegForm").addEventListener("submit", e => {
    e.preventDefault();
    const first = $("qzFirst").value.trim();
    const last  = $("qzLast").value.trim();
    const mail  = $("qzMail").value.trim();
    const errEl = $("qzRegErr");
    if (!first || !last || !mail) {
      if (errEl) { errEl.textContent = "Please fill in all required fields."; errEl.style.display = "block"; }
      return;
    }
    if (errEl) errEl.style.display = "none";
    QStud = { firstName: first, lastName: last, email: mail };
    if (extra) extra.querySelectorAll("input[data-qf]").forEach(inp => {
      QStud[inp.dataset.qf] = inp.value.trim();
    });
    QStart = Date.now();
    QCur   = 0;
    QAns   = {};
    saveSession();
    showScreen("qzQuiz");
    renderQ(0);
    startTimer();
  });

  showScreen("qzReg");
}

document.addEventListener("DOMContentLoaded", () => {
  const prev    = $("qzPrev");
  const next    = $("qzNext");
  const submitB = $("qzSubmit");

  if (prev) prev.addEventListener("click", () => {
    if (!QCfg || QCfg.noBack) return;
    if (QCur > 0) { QCur--; saveSession(); renderQ(QCur); }
  });
  if (next) next.addEventListener("click", () => {
    if (QCur < QCards.length - 1) { QCur++; saveSession(); renderQ(QCur); }
  });
  if (submitB) submitB.addEventListener("click", () => {
    if (confirm("Submit your answers? This cannot be undone.")) doSubmit(false);
  });

  init();
});
