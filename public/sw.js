// オフライン用のキャッシュ（建築CAD）。アプリ本体を端末に保存し、電波がなくても開けるようにする。
const CACHE = 'kenchiku-cad-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((hit) => {
      // 取れたら先にキャッシュを返し、裏で新しい版を取り直して保存する
      const net = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
      if (hit) {
        net.catch(() => {});
        return hit;
      }
      // 初回で未保存のページは、電波がなければ本体の HTML を返す
      return net.catch(() => caches.match('./index.html'));
    }),
  );
});
