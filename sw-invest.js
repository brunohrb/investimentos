const CACHE_NAME = 'investimentos-v6';

// Só cacheia assets estáticos — NUNCA o HTML principal
const STATIC_ASSETS = [
  'logo.png'
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
  // Apaga TODOS os caches antigos e assume controle imediato
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
      // Força recarga dos clients ativos para pegar a nova versão do HTML
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => {
        try { c.navigate(c.url); } catch (e) {}
      });
    })()
  );
});

// Permite que o HTML peça SKIP_WAITING via postMessage
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
