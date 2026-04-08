const CACHE_NAME = 'investimentos-v2';
const STATIC_ASSETS = [
  '/pessoal/investimentos',
  '/pessoal/logo.png',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700;800&display=swap'
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
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Deixa passar requisições externas sem interceptar
  if (
    event.request.url.includes('supabase.co') ||
    event.request.url.includes('cdn.jsdelivr') ||
    event.request.url.includes('cdnjs.') ||
    event.request.url.includes('brapi.dev') ||
    event.request.url.includes('pluggy') ||
    event.request.url.includes('fonts.googleapis') ||
    event.request.url.includes('fonts.gstatic')
  ) {
    return;
  }

  // Network-first: sempre busca versão mais recente, usa cache só se offline
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
