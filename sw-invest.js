const CACHE_NAME = 'investimentos-v3';

// Só cacheia assets estáticos — NUNCA o HTML principal
const STATIC_ASSETS = [
  '/pessoal/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Apaga TODOS os caches antigos
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Deixa passar tudo que não seja do próprio domínio
  if (
    url.includes('supabase.co') ||
    url.includes('cdn.jsdelivr') ||
    url.includes('cdnjs.') ||
    url.includes('brapi.dev') ||
    url.includes('pluggy') ||
    url.includes('fonts.googleapis') ||
    url.includes('fonts.gstatic')
  ) {
    return;
  }

  // HTML: sempre busca na rede (nunca cacheia)
  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Outros assets: network-first com fallback pro cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
