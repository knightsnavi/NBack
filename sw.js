/* NBack Trainer service worker: offline app shell + daily reminder check. */
const VERSION = 'nback-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/styles.css',
  './js/app.js', './js/game.js', './js/audio.js', './js/posture.js', './js/storage.js',
  './js/stats.js', './js/achievements.js', './js/charts.js', './js/reminders.js',
  './audio/C.mp3', './audio/H.mp3', './audio/K.mp3', './audio/L.mp3',
  './audio/Q.mp3', './audio/R.mp3', './audio/S.mp3', './audio/T.mp3',
  './assets/icon.svg', './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-512.png', './assets/badge.png',
];
const CONFIG_CACHE = 'nback-config';
const CONFIG_URL = new URL('reminder-config.json', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== CONFIG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(cache => cache.put(req, copy));
      }
      return res;
    })),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'CHECK_REMINDER') event.waitUntil(checkReminder());
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'nback-reminder') event.waitUntil(checkReminder());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow(self.registration.scope);
  }));
});

function localDayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function readConfig() {
  try {
    const cache = await caches.open(CONFIG_CACHE);
    const res = await cache.match(CONFIG_URL);
    return res ? await res.json() : null;
  } catch {
    return null;
  }
}

async function writeConfig(cfg) {
  try {
    const cache = await caches.open(CONFIG_CACHE);
    await cache.put(CONFIG_URL, new Response(JSON.stringify(cfg), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* ignore */ }
}

async function checkReminder() {
  const cfg = await readConfig();
  if (!cfg || !cfg.enabled) return;
  const now = new Date();
  const today = localDayKey(now);
  if (cfg.lastSessionDay === today || cfg.lastNotifiedDay === today) return;
  const [h, m] = String(cfg.time || '19:00').split(':').map(Number);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  if (minutesNow < h * 60 + m) return;
  await self.registration.showNotification('Time to train', {
    body: 'A quick N-back session keeps your streak alive.',
    icon: 'assets/icon-192.png',
    badge: 'assets/badge.png',
    tag: 'nback-daily',
    data: { url: './' },
  });
  await writeConfig({ ...cfg, lastNotifiedDay: today });
}
