const CACHE_NAME = 'overtime-report-v2';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json'
];

// インストール時
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
    );
});

// フェッチ時 (Network First strategy)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // ネットワークから成功したらキャッシュを更新して返す
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                const responseToCache = response.clone();
                caches.open(CACHE_NAME)
                    .then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                return response;
            })
            .catch(() => {
                // ネットワーク失敗時はキャッシュを使用
                return caches.match(event.request);
            })
    );
});

// アクティベート時（古いキャッシュ削除）
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
