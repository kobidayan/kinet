/* CORE-X — service worker (v2.66)
   שומר בטלפון את "הקליפה" של השלט: הדפים, mqtt.js, האייקונים והגופן.
   כל פתיחה מקבלת מיד את מה ששמור, ובמקביל נבדק ברקע אם יש גרסה חדשה ב-GitHub.
   אם app.html או remote.html השתנו — הם נשמרים, והשלט מציג "גרסה חדשה מוכנה — רענן".
   התעבורה ל-MQTT (WebSocket) לא עוברת כאן בכלל: השליטה בתאורה תמיד חיה.
   כשמעלים גרסה חדשה לא חייבים לשנות את הקובץ הזה. משנים את VERSION רק כדי לנקות שמירה ישנה לגמרי. */
const VERSION = 'corex-1';
const FONTS = 'corex-fonts';
const SHELL = ['app.html', 'remote.html', 'client.html', 'admin.html', 'mqtt.min.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'icon-32.png', 'jsqr.min.js'];
const PAGES = ['app.html', 'remote.html'];

self.addEventListener('install', (e) => {
  // כל קובץ בנפרד: קובץ אחד שחסר בשרת לא מפיל את ההתקנה
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) =>
    fetch(new Request(u, { cache: 'reload' })).then((r) => { if (r.ok) return c.put(u, r); }).catch(() => {})
  ))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function shellKey(url) {
  const base = new URL(self.registration.scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
  const p = url.pathname.slice(base.pathname.length);
  return SHELL.includes(p) ? p : null;
}

async function notify() {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  cs.forEach((c) => c.postMessage({ t: 'updated' }));
}

// מה ששמור — מיד. ברקע: מורידים את הגרסה שבשרת ומעדכנים את השמירה לפעם הבאה
async function fromShell(key, event) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key);
  const net = fetch(key, { cache: 'no-cache' }).then(async (r) => {
    if (!r || !r.ok) return r;
    if (PAGES.includes(key)) {
      const old = await cache.match(key);
      const [a, b] = await Promise.all([old ? old.text() : Promise.resolve(null), r.clone().text()]);
      if (a !== b) { await cache.put(key, r.clone()); if (a !== null) notify(); }
    } else {
      await cache.put(key, r.clone());
    }
    return r;
  }).catch(() => null);
  if (cached) { event.waitUntil(net); return cached; }
  const r = await net;
  return r || Response.error();
}

async function fonts(req, event) {
  const cache = await caches.open(FONTS);
  const cached = await cache.match(req);
  const net = fetch(req).then((r) => { if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone()); return r; }).catch(() => null);
  if (cached) { event.waitUntil(net); return cached; }
  return (await net) || Response.error();
}

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const key = shellKey(url);
  if (key) { e.respondWith(fromShell(key, e)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { e.respondWith(fonts(req, e)); return; }
  // כל השאר (CDN גיבוי, הלוח עצמו) — ישר לרשת, בלי לגעת
});
