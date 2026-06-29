"use strict";
/* ---- interactive card graphs ----
   Reads currentDeck.accent at render time (set by app.js before any graph is drawn).
   Add new recipes here; no other file needs to change for a new recipe. */

function linspace(a, b, n) {
  const step = (b - a) / (n - 1);
  return Array.from({ length: n }, (_, i) => a + i * step);
}
function gaussianPdf(x, mu, sigma) {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}
// Abramowitz & Stegun 26.2.17 — max error < 7.5e-8
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x > 0 ? 1 - p : p;
}
function poissonPmf(k, lam) {
  if (lam <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lam) - lam;
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}
function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}
function svgText(x, y, text, extra) {
  const t = svgEl("text", Object.assign({ x, y, "text-anchor": "middle", "font-size": "9", fill: "#888" }, extra));
  t.textContent = text;
  return t;
}
function makeScaleFn(dataMin, dataMax, svgMin, svgMax) {
  const span = dataMax - dataMin || 1;
  return (v) => svgMin + (v - dataMin) / span * (svgMax - svgMin);
}

const GRAPH_W = 300, GRAPH_H = 140;
const GRAPH_PAD = { l: 20, r: 10, t: 18, b: 26 };

const GRAPH_RECIPES = {
  normal: {
    defaults: { mu: 0, sigma: 1 },
    controls: ["mu", "sigma"],
    ranges: { mu: [-3, 3, 0.1], sigma: [0.2, 2, 0.05] },
    render(svg, p) {
      const { mu, sigma } = p;
      const xMin = -5, xMax = 5;   // fixed window so the bell visibly moves + reshapes
      const yMax = gaussianPdf(mu, mu, sigma) * 1.25;
      const sx = makeScaleFn(xMin, xMax, GRAPH_PAD.l, GRAPH_W - GRAPH_PAD.r);
      const sy = makeScaleFn(0, yMax, GRAPH_H - GRAPH_PAD.b, GRAPH_PAD.t);
      const y0 = sy(0);
      const xs = linspace(xMin, xMax, 200);
      const pts = xs.map(x => `${sx(x).toFixed(1)},${sy(gaussianPdf(x, mu, sigma)).toFixed(1)}`).join(" ");
      svg.appendChild(svgEl("polyline", { points: pts, fill: "none", stroke: "var(--graph-accent,#00e0d0)", "stroke-width": "2" }));
      const mx = sx(mu);
      if (mx >= GRAPH_PAD.l && mx <= GRAPH_W - GRAPH_PAD.r) {
        svg.appendChild(svgEl("line", { x1: mx.toFixed(1), x2: mx.toFixed(1), y1: y0, y2: GRAPH_PAD.t, stroke: "var(--graph-accent,#00e0d0)", "stroke-width": "1", "stroke-dasharray": "4 3", opacity: "0.5" }));
      }
      svg.appendChild(svgEl("line", { x1: GRAPH_PAD.l, x2: GRAPH_W - GRAPH_PAD.r, y1: y0, y2: y0, stroke: "#555", "stroke-width": "0.5" }));
      [-4, -2, 0, 2, 4].forEach(val => {
        const x = sx(val);
        svg.appendChild(svgEl("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: y0, y2: y0 + 3, stroke: "#555", "stroke-width": "0.5" }));
        svg.appendChild(svgText(x.toFixed(1), y0 + 13, String(val)));
      });
      svg.appendChild(svgText(GRAPH_W - GRAPH_PAD.r, GRAPH_PAD.t - 5, `μ=${mu.toFixed(1)}  σ=${sigma.toFixed(2)}`, { "text-anchor": "end", fill: "#aaa" }));
    },
  },
  poisson: {
    defaults: { lambda: 3 },
    controls: ["lambda"],
    ranges: { lambda: [0.5, 15, 0.5] },
    render(svg, p) {
      const { lambda } = p;
      const kMax = Math.min(Math.max(Math.ceil(lambda * 3 + 2), 12), 30);
      const ks = Array.from({ length: kMax + 1 }, (_, i) => i);
      const pmfs = ks.map(k => poissonPmf(k, lambda));
      const yMax = Math.max(...pmfs) * 1.3;
      const sx = makeScaleFn(-0.5, kMax + 0.5, GRAPH_PAD.l, GRAPH_W - GRAPH_PAD.r);
      const sy = makeScaleFn(0, yMax, GRAPH_H - GRAPH_PAD.b, GRAPH_PAD.t);
      const y0 = sy(0);
      const barW = Math.max(2, (sx(1) - sx(0)) * 0.65);
      ks.forEach((k, i) => {
        if (pmfs[i] < 1e-6) return;
        svg.appendChild(svgEl("rect", {
          x: (sx(k) - barW / 2).toFixed(1), y: sy(pmfs[i]).toFixed(1),
          width: barW.toFixed(1), height: Math.max(0, y0 - sy(pmfs[i])).toFixed(1),
          fill: "var(--graph-accent,#00e0d0)", opacity: "0.7",
        }));
      });
      const lx = sx(lambda).toFixed(1);
      svg.appendChild(svgEl("line", { x1: lx, x2: lx, y1: y0, y2: GRAPH_PAD.t, stroke: "var(--graph-accent,#00e0d0)", "stroke-width": "1", "stroke-dasharray": "3 2", opacity: "0.6" }));
      svg.appendChild(svgEl("line", { x1: GRAPH_PAD.l, x2: GRAPH_W - GRAPH_PAD.r, y1: y0, y2: y0, stroke: "#555", "stroke-width": "0.5" }));
      const ticks = new Set([0, Math.round(lambda), kMax]);
      ticks.forEach(k => {
        if (k < 0 || k > kMax) return;
        const x = sx(k);
        svg.appendChild(svgEl("line", { x1: x, x2: x, y1: y0, y2: y0 + 3, stroke: "#555", "stroke-width": "0.5" }));
        svg.appendChild(svgText(x.toFixed(1), y0 + 13, String(k)));
      });
      svg.appendChild(svgText(GRAPH_W - GRAPH_PAD.r, GRAPH_PAD.t - 5, `λ=${lambda.toFixed(1)}`, { "text-anchor": "end", fill: "#aaa" }));
    },
  },
  /* Two-sided: shade within ±k sigma; annotation shows the covered fraction */
  "normal-within": {
    defaults: { k: 1 },
    controls: ["k"],
    ranges: { k: [0, 4, 0.05] },
    render(svg, p) {
      const k = Math.min(Math.abs(p.k), 4);
      const xMin = -4, xMax = 4;
      const yMax = gaussianPdf(0, 0, 1) * 1.3;
      const sx = makeScaleFn(xMin, xMax, GRAPH_PAD.l, GRAPH_W - GRAPH_PAD.r);
      const sy = makeScaleFn(0, yMax, GRAPH_H - GRAPH_PAD.b, GRAPH_PAD.t);
      const y0 = sy(0);
      // Shaded region
      if (k > 0) {
        const shadeXs = linspace(-k, k, 120);
        const shadePts = [`${sx(-k).toFixed(1)},${y0}`,
          ...shadeXs.map(x => `${sx(x).toFixed(1)},${sy(gaussianPdf(x, 0, 1)).toFixed(1)}`),
          `${sx(k).toFixed(1)},${y0}`].join(" ");
        svg.appendChild(svgEl("polygon", { points: shadePts, fill: "var(--graph-accent,#00e0d0)", opacity: "0.22" }));
      }
      svg.appendChild(svgEl("line", { x1: GRAPH_PAD.l, x2: GRAPH_W - GRAPH_PAD.r, y1: y0, y2: y0, stroke: "#555", "stroke-width": "0.5" }));
      // Reference grid lines at ±1σ … ±3σ
      [-3, -2, -1, 0, 1, 2, 3].forEach(s => {
        const x = sx(s);
        svg.appendChild(svgEl("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: y0, y2: GRAPH_PAD.t, stroke: "#2a2a2a", "stroke-width": "0.5", "stroke-dasharray": "3 3" }));
        svg.appendChild(svgEl("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: y0, y2: (y0 + 4).toFixed(1), stroke: "#555", "stroke-width": "0.5" }));
        svg.appendChild(svgText(x.toFixed(1), (y0 + 13).toFixed(1), s === 0 ? "0" : `${s}σ`, { "font-size": "8" }));
      });
      // Bell curve
      const pts = linspace(xMin, xMax, 200).map(x => `${sx(x).toFixed(1)},${sy(gaussianPdf(x, 0, 1)).toFixed(1)}`).join(" ");
      svg.appendChild(svgEl("polyline", { points: pts, fill: "none", stroke: "var(--graph-accent,#00e0d0)", "stroke-width": "2" }));
      // Moving boundary at ±k
      if (k > 0) {
        [-k, k].forEach(kv => {
          const x = sx(kv);
          if (x >= GRAPH_PAD.l && x <= GRAPH_W - GRAPH_PAD.r)
            svg.appendChild(svgEl("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: y0, y2: GRAPH_PAD.t, stroke: "var(--graph-accent,#00e0d0)", "stroke-width": "1.5" }));
        });
      }
      const pct = (2 * normalCdf(k) - 1) * 100;
      svg.appendChild(svgText(GRAPH_W - GRAPH_PAD.r, GRAPH_PAD.t - 5, `±${k.toFixed(2)}σ → ${pct.toFixed(1)}%`, { "text-anchor": "end", fill: "#aaa", "font-size": "10" }));
    },
  },
  /* One-sided CDF: shade from −∞ to k sigma; annotation shows Φ(k) */
  "normal-cdf": {
    defaults: { k: 0 },
    controls: ["k"],
    ranges: { k: [-4, 4, 0.05] },
    render(svg, p) {
      const k = Math.max(Math.min(p.k, 4), -4);
      const xMin = -4, xMax = 4;
      const yMax = gaussianPdf(0, 0, 1) * 1.3;
      const sx = makeScaleFn(xMin, xMax, GRAPH_PAD.l, GRAPH_W - GRAPH_PAD.r);
      const sy = makeScaleFn(0, yMax, GRAPH_H - GRAPH_PAD.b, GRAPH_PAD.t);
      const y0 = sy(0);
      // Shaded region from xMin to k
      const shadeEnd = Math.min(k, xMax);
      const shadeXs = linspace(xMin, shadeEnd, 120);
      const shadePts = [`${sx(xMin).toFixed(1)},${y0}`,
        ...shadeXs.map(x => `${sx(x).toFixed(1)},${sy(gaussianPdf(x, 0, 1)).toFixed(1)}`),
        `${sx(shadeEnd).toFixed(1)},${y0}`].join(" ");
      svg.appendChild(svgEl("polygon", { points: shadePts, fill: "var(--graph-accent,#00e0d0)", opacity: "0.22" }));
      svg.appendChild(svgEl("line", { x1: GRAPH_PAD.l, x2: GRAPH_W - GRAPH_PAD.r, y1: y0, y2: y0, stroke: "#555", "stroke-width": "0.5" }));
      [-3, -2, -1, 0, 1, 2, 3].forEach(s => {
        const x = sx(s);
        svg.appendChild(svgEl("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: y0, y2: GRAPH_PAD.t, stroke: "#2a2a2a", "stroke-width": "0.5", "stroke-dasharray": "3 3" }));
        svg.appendChild(svgEl("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: y0, y2: (y0 + 4).toFixed(1), stroke: "#555", "stroke-width": "0.5" }));
        svg.appendChild(svgText(x.toFixed(1), (y0 + 13).toFixed(1), s === 0 ? "0" : `${s}σ`, { "font-size": "8" }));
      });
      const pts = linspace(xMin, xMax, 200).map(x => `${sx(x).toFixed(1)},${sy(gaussianPdf(x, 0, 1)).toFixed(1)}`).join(" ");
      svg.appendChild(svgEl("polyline", { points: pts, fill: "none", stroke: "var(--graph-accent,#00e0d0)", "stroke-width": "2" }));
      // Moving boundary at k
      if (k > xMin && k < xMax) {
        const x = sx(k);
        svg.appendChild(svgEl("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: y0, y2: GRAPH_PAD.t, stroke: "var(--graph-accent,#00e0d0)", "stroke-width": "1.5" }));
      }
      const pct = normalCdf(k) * 100;
      const kSign = k >= 0 ? "+" : "";
      svg.appendChild(svgText(GRAPH_W - GRAPH_PAD.r, GRAPH_PAD.t - 5, `Φ(${kSign}${k.toFixed(2)}σ) = ${pct.toFixed(1)}%`, { "text-anchor": "end", fill: "#aaa", "font-size": "9" }));
    },
  },
  /* H₀ vs H₁ overlap: threshold slider shows α (right tail H₀) and β (left tail H₁) live */
  "normal-hypothesis": {
    defaults: { threshold: 1.5, delta: 2 },
    controls: ["threshold", "delta"],
    ranges: { threshold: [-3, 6, 0.05], delta: [0.5, 4, 0.1] },
    render(svg, p) {
      const delta = Math.max(0.5, p.delta);
      const threshold = p.threshold;
      const xMin = -4, xMax = delta + 4;
      const yMax = gaussianPdf(0, 0, 1) * 1.35;
      const sx = makeScaleFn(xMin, xMax, GRAPH_PAD.l, GRAPH_W - GRAPH_PAD.r);
      const sy = makeScaleFn(0, yMax, GRAPH_H - GRAPH_PAD.b, GRAPH_PAD.t);
      const y0 = sy(0);
      // α: right tail of H₀ beyond the threshold
      const aStart = Math.max(threshold, xMin);
      if (aStart < xMax) {
        const aXs = linspace(aStart, xMax, 80);
        const aPts = [`${sx(aStart).toFixed(1)},${y0}`,
          ...aXs.map(x => `${sx(x).toFixed(1)},${sy(gaussianPdf(x, 0, 1)).toFixed(1)}`),
          `${sx(xMax).toFixed(1)},${y0}`].join(" ");
        svg.appendChild(svgEl("polygon", { points: aPts, fill: "#FF6B6B", opacity: "0.4" }));
      }
      // β: left tail of H₁ before the threshold
      const bEnd = Math.min(threshold, xMax);
      if (bEnd > xMin) {
        const bXs = linspace(xMin, bEnd, 80);
        const bPts = [`${sx(xMin).toFixed(1)},${y0}`,
          ...bXs.map(x => `${sx(x).toFixed(1)},${sy(gaussianPdf(x, delta, 1)).toFixed(1)}`),
          `${sx(bEnd).toFixed(1)},${y0}`].join(" ");
        svg.appendChild(svgEl("polygon", { points: bPts, fill: "#66aaff", opacity: "0.35" }));
      }
      svg.appendChild(svgEl("line", { x1: GRAPH_PAD.l, x2: GRAPH_W - GRAPH_PAD.r, y1: y0, y2: y0, stroke: "#555", "stroke-width": "0.5" }));
      // H₀ bell (coral)
      const h0Pts = linspace(xMin, xMax, 200).map(x => `${sx(x).toFixed(1)},${sy(gaussianPdf(x, 0, 1)).toFixed(1)}`).join(" ");
      svg.appendChild(svgEl("polyline", { points: h0Pts, fill: "none", stroke: "#FF6B6B", "stroke-width": "2" }));
      // H₁ bell (blue)
      const h1Pts = linspace(xMin, xMax, 200).map(x => `${sx(x).toFixed(1)},${sy(gaussianPdf(x, delta, 1)).toFixed(1)}`).join(" ");
      svg.appendChild(svgEl("polyline", { points: h1Pts, fill: "none", stroke: "#66aaff", "stroke-width": "2" }));
      // Decision boundary
      const tx = sx(threshold);
      if (tx >= GRAPH_PAD.l && tx <= GRAPH_W - GRAPH_PAD.r)
        svg.appendChild(svgEl("line", { x1: tx.toFixed(1), x2: tx.toFixed(1), y1: y0, y2: GRAPH_PAD.t, stroke: "#ccc", "stroke-width": "1.5", "stroke-dasharray": "4 3" }));
      // Axis labels for μ₀ and μ₁
      [[0, "μ₀"], [delta, "μ₁"]].forEach(([val, lbl]) => {
        const x = sx(val);
        if (x < GRAPH_PAD.l || x > GRAPH_W - GRAPH_PAD.r) return;
        svg.appendChild(svgEl("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: y0, y2: (y0 + 4).toFixed(1), stroke: "#555", "stroke-width": "0.5" }));
        svg.appendChild(svgText(x.toFixed(1), (y0 + 13).toFixed(1), lbl, { "font-size": "8" }));
      });
      const alpha = (1 - normalCdf(threshold)) * 100;
      const beta = normalCdf(threshold - delta) * 100;
      const power = 100 - beta;
      const statLabel = svgEl("text", { x: GRAPH_W - GRAPH_PAD.r, y: GRAPH_PAD.t - 5, "text-anchor": "end", "font-size": "8.5" });
      [["α=" + alpha.toFixed(1) + "%", "#FF6B6B"], ["  β=" + beta.toFixed(1) + "%", "#66aaff"], ["  power=" + power.toFixed(1) + "%", "#aaa"]].forEach(([txt, col]) => {
        const s = svgEl("tspan", { fill: col, "font-weight": "bold" });
        s.textContent = txt;
        statLabel.appendChild(s);
      });
      svg.appendChild(statLabel);
    },
  },
};

/* shared core: render a graph spec into an already-created wrapper div */
function buildGraph(spec, wrapper) {
  const recipe = GRAPH_RECIPES[spec && spec.type];
  if (!recipe) return;
  wrapper.className = "card-graph";
  wrapper.style.setProperty("--graph-accent", (currentDeck && currentDeck.accent) || "#00e0d0");
  const params = Object.assign({}, recipe.defaults || {}, spec.params || {});
  function redraw() {
    const svg = svgEl("svg", { viewBox: `0 0 ${GRAPH_W} ${GRAPH_H}`, width: "100%", style: "display:block" });
    recipe.render(svg, params);
    const old = wrapper.querySelector("svg");
    if (old) old.replaceWith(svg); else wrapper.prepend(svg);
  }
  redraw();
  const controlKeys = spec.controls || recipe.controls || [];
  controlKeys.forEach(key => {
    const rng = (spec.ranges && spec.ranges[key]) || (recipe.ranges && recipe.ranges[key]) || [-5, 5, 0.1];
    const [min, max, step] = rng;
    const row = document.createElement("div");
    row.className = "graph-ctrl-row";
    const val = document.createElement("span");
    val.className = "graph-ctrl-val";
    val.textContent = Number(params[key]).toFixed(step < 0.1 ? 2 : 1);
    const lbl = document.createElement("label");
    lbl.className = "graph-ctrl-lbl";
    lbl.textContent = key + " = ";
    lbl.appendChild(val);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "graph-slider";
    Object.assign(slider, { min, max, step, value: params[key] });
    slider.addEventListener("input", (e) => {
      params[key] = parseFloat(e.target.value);
      val.textContent = params[key].toFixed(step < 0.1 ? 2 : 1);
      redraw();
    });
    // Wheel over a range input changes its value instead of scrolling the container.
    // Forward to the nearest scrollable ancestor so the card/primer face can still scroll.
    slider.addEventListener("wheel", (e) => {
      e.preventDefault();
      let el = slider.parentElement;
      while (el && el !== document.documentElement) {
        if (/(auto|scroll)/.test(window.getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) {
          el.scrollTop += e.deltaY; return;
        }
        el = el.parentElement;
      }
      window.scrollBy(0, e.deltaY);
    }, { passive: false });
    row.appendChild(lbl);
    row.appendChild(slider);
    wrapper.appendChild(row);
  });
}

function injectCardGraph(spec, cardEl) {
  const recipe = GRAPH_RECIPES[spec && spec.type];
  if (!recipe) return;
  const answerEl = cardEl.querySelector(".back .answer");
  if (!answerEl) return;
  const wrapper = document.createElement("div");
  // insert before .note so refs/citations always stay at the bottom
  const noteEl = answerEl.querySelector(".note");
  if (noteEl) answerEl.insertBefore(wrapper, noteEl); else answerEl.appendChild(wrapper);
  buildGraph(spec, wrapper);
}

function injectFrontGraph(spec, cardEl) {
  const recipe = GRAPH_RECIPES[spec && spec.type];
  if (!recipe) return;
  const frontEl = cardEl.querySelector(".face.front");
  if (!frontEl) return;
  const wrapper = document.createElement("div");
  // insert before .hint so the graph appears above the "tap to reveal" cue
  const hintEl = frontEl.querySelector(".hint");
  if (hintEl) frontEl.insertBefore(wrapper, hintEl); else frontEl.appendChild(wrapper);
  buildGraph(spec, wrapper);
}
