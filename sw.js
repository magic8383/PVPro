// PVPro Service Worker – Version kommt aus version.js (Single Source of Truth)
importScripts('./version.js');

const CACHE_NAME = 'pvpro-cache-v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '7.0');
const OFFLINE_FALLBACK = './index.html';
const STATIC_ASSETS = [
    './',
    './index.html',
    './version.js',
    './tailwind.config.js',
    './app.js',
    './database.js',
    './content.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap'
];

// Install: Jedes Asset einzeln cachen – ein fehlendes CDN darf
// den Offline-Modus nicht mehr komplett verhindern.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            const results = await Promise.allSettled(
                STATIC_ASSETS.map((url) => cache.add(url))
            );
            const failed = results.filter((r) => r.status === 'rejected').length;
            if (failed > 0) console.warn(`PVPro SW: ${failed} Assets konnten nicht gecacht werden.`);
            return self.skipWaiting();
        })
    );
});

// Activate: Alte Caches aufräumen
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                    return null;
                })
            );
        }).then(() => self.clients.claim())
    );
});

function isApiRequest(url) {
    return url.hostname.includes('nominatim.openstreetmap.org')
        || url.hostname.includes('pvgis.mb10.org')
        || url.hostname.endsWith('europa.eu');
}

// Fetch: Network-first für APIs, navigationssicherer Fallback,
// Stale-While-Revalidate für App-Assets.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    // Externe APIs -> Netzwerk, sonst JSON-Offline-Antwort (app.js hat Fallback-Engine)
    if (isApiRequest(url)) {
        event.respondWith(
            fetch(event.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
                headers: { 'Content-Type': 'application/json' }
            }))
        );
        return;
    }

    // Navigation (Seitenaufruf/Reload) -> Netzwerk, sonst gecachte App-Shell
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.ok) {
                        const copy = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(OFFLINE_FALLBACK, copy));
                    }
                    return networkResponse;
                })
                .catch(() => caches.match(OFFLINE_FALLBACK, { ignoreSearch: true }))
        );
        return;
    }

    // App-Assets & CDNs -> Cache-first mit Hintergrund-Update
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 &&
                    (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
                }
                return networkResponse;
            }).catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});
