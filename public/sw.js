/* SmartTrainner: trabajo sin conexión (service worker).
   - Páginas ("/" y "/r/CODIGO"): primero la red; sin señal, la última guardada.
   - Código de la app (/app.<huella>.js), React de unpkg, fuentes e íconos: de la caché,
     porque con la misma dirección nunca cambian.
   - Rutina del alumno (GET /api/alumno/...): primero la red; sin señal, la última que vio.
   - Nada más de /api se guarda: los datos del entrenador no quedan en el dispositivo.
   Si se cambia la forma de guardar, subir VERSION para que se borre lo viejo. */
const VERSION = 'v1';
const PAGINAS = 'st-paginas-' + VERSION;
const ESTATICOS = 'st-estaticos-' + VERSION;
const DATOS = 'st-datos-' + VERSION;
const ESPERA_RED = 6000;   // con poca señal, a los 6 segundos se muestra lo guardado

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const vigentes = [PAGINAS, ESTATICOS, DATOS];
    for (const k of await caches.keys()) if (!vigentes.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const conTiempo = (promesa, ms) => Promise.race([promesa,
  new Promise((_, no) => setTimeout(() => no(new Error('sin respuesta')), ms))]);

// Marca la respuesta guardada para que la página avise que no hay conexión.
async function marcar(r) {
  const h = new Headers(r.headers);
  h.set('X-Sin-Conexion', '1');
  return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: h });
}

async function redPrimero(req, nombre, clave) {
  const cache = await caches.open(nombre);
  const guardada = await cache.match(clave);
  const red = fetch(req).then(r => {
    if (r.ok) cache.put(clave, r.clone());
    return r;
  });
  if (!guardada) return red;
  try { return await conTiempo(red, ESPERA_RED); }
  catch { return marcar(guardada); }
}

async function cachePrimero(req) {
  const cache = await caches.open(ESTATICOS);
  const guardada = await cache.match(req);
  if (guardada) return guardada;
  const r = await fetch(req);
  if (r.ok) {
    const url = new URL(req.url);
    // Una versión nueva del código reemplaza a la anterior.
    if (/^\/app\.[a-f0-9]+\.js$/.test(url.pathname))
      for (const k of await cache.keys())
        if (/\/app\.[a-f0-9]+\.js$/.test(new URL(k.url).pathname)) await cache.delete(k);
    await cache.put(req, r.clone());
  }
  return r;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const propio = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    // Solo las páginas sin datos en la dirección (nada de ?recuperar=...).
    if (propio && !url.search && (url.pathname === '/' || /^\/r\/[a-f0-9]{10,32}$/.test(url.pathname)))
      e.respondWith(redPrimero(req, PAGINAS, url.origin + url.pathname));
    return;
  }
  if (propio) {
    if (/^\/app\.[a-f0-9]+\.js$/.test(url.pathname) || url.pathname.startsWith('/icons/') ||
        url.pathname.startsWith('/vendor/'))
      e.respondWith(cachePrimero(req));
    else if (/^\/api\/alumno\/[a-f0-9]{10,32}(\/logo)?$/.test(url.pathname))
      e.respondWith(redPrimero(req, DATOS, req.url));
    return;
  }
  if (['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname))
    e.respondWith(cachePrimero(req));
});
