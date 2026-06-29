/* lernkarto service worker — makes the hosted app installable + offline.
   App shell is precached; decks, topics, subjects, courses and KaTeX fonts are cached at runtime
   (stale-while-revalidate). Bump CACHE to ship a new shell. */
const CACHE = "lernkarto-v40";
const CORE = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./vendor/katex/katex.min.css",
  "./vendor/katex/katex.min.js",
  "./vendor/katex/contrib/auto-render.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    // Precache the WHOLE library on install so one online load = fully offline (e.g. iPhone PWA).
    try {
      const extra = ["./data/manifest.json"];
      const manifest = await (await fetch("./data/manifest.json", { cache: "no-store" })).json();
      const decks = new Set();
      for (const t of (manifest.topics || manifest.sets || [])) {
        const url = "./data/topics/" + t; extra.push(url);
        try {
          const tj = await (await fetch(url, { cache: "no-store" })).json();
          (tj.deckFiles || []).forEach((d) => decks.add("./data/decks/" + d));
        } catch (e) { /* skip a bad topic */ }
      }
      (manifest.subjects || []).forEach((sf) => extra.push("./data/subjects/" + sf));
      (manifest.courses || []).forEach((cf) => extra.push("./data/courses/" + cf));
      // c.add each (allSettled) so one missing file (e.g. private overlay) doesn't fail the install
      await Promise.allSettled(extra.concat([...decks]).map((u) => c.add(u)));
    } catch (e) { /* no manifest (single-file build) — the app shell alone is enough */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        // cache successful same-origin responses for next time
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);              // offline: fall back to cache
      return cached || network;            // cache-first; refresh in the background
    })
  );
});
