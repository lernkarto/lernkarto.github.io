#!/usr/bin/env node
// Generates data/catalogue.json — a lightweight index of all server-side decks.
// Run: node scripts/build-catalogue.js
// Re-run whenever a deck file is added, removed, or its metadata changes.
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const manifest = readJson(path.join(DATA, "manifest.json"));
const topicFiles = Array.isArray(manifest.topics || manifest.sets)
  ? (manifest.topics || manifest.sets) : [];

// deck id → entry (merged across all topic files that reference it)
const byId = new Map();
// topic name → topic file (for lazy primer loading)
const topicToFile = {};

for (const topicFile of topicFiles) {
  const topicPath = path.join(DATA, "topics", topicFile);
  if (!fs.existsSync(topicPath)) {
    console.warn("missing topic file:", topicFile);
    continue;
  }
  const t = readJson(topicPath);
  const topicName = t.topic || t.set || t.name || null;
  if (topicName && !topicToFile[topicName]) topicToFile[topicName] = topicFile;

  const subjects = Array.isArray(t.subject) ? t.subject.map(String)
    : (t.subject ? [String(t.subject)] : []);

  for (const deckFile of (t.deckFiles || [])) {
    const deckPath = path.join(DATA, "decks", deckFile);
    if (!fs.existsSync(deckPath)) {
      console.warn("missing deck file:", deckFile, "(topic:", topicFile + ")");
      continue;
    }

    const d = readJson(deckPath);
    const id = String(d.id || deckFile.replace(/\.json$/, ""));

    if (byId.has(id)) {
      // deck already seen — just merge topic/subject memberships
      const e = byId.get(id);
      if (topicName && !e.topics.includes(topicName)) e.topics.push(topicName);
      subjects.forEach((s) => { if (!e.subjects.includes(s)) e.subjects.push(s); });
      continue;
    }

    const rawCount = Array.isArray(d.cards) ? d.cards.length : 0;
    // dual decks study each card twice (forward + reverse); approximate — interactive cards
    // don't double, but the difference is small and corrected after first load.
    const count = d.dual ? rawCount * 2 : rawCount;

    byId.set(id, {
      id,
      name: d.name || "Untitled",
      color: d.color || null,
      description: d.description || "",
      count,
      tags: Array.isArray(d.tags) ? d.tags : [],
      lang: d.lang || null,
      dual: !!d.dual,
      primerTitle: d.primerTitle || null,
      hasPrimer: !!(d.primer),
      source: d.source || null,
      license: d.license || null,
      attribution: d.attribution || null,
      topics: topicName ? [topicName] : [],
      subjects: [...subjects],
    });
  }
}

const unreferenced = fs.readdirSync(path.join(DATA, "decks"))
  .filter((f) => f.endsWith(".json") && !byId.has(f.replace(/\.json$/, "")));
if (unreferenced.length) {
  console.warn(unreferenced.length, "deck file(s) not referenced by any topic:", unreferenced.join(", "));
}

const out = { decks: [...byId.values()], topicToFile };
fs.writeFileSync(path.join(DATA, "catalogue.json"), JSON.stringify(out));
console.log("catalogue:", byId.size, "decks,", Object.keys(topicToFile).length, "topics →", path.join(DATA, "catalogue.json"));
