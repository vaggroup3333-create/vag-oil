const VERSION='__CASHIER_BUILD_VERSION__';
const CACHE='vag-cashier-shell-'+VERSION;
const ASSETS=/*__CASHIER_ASSETS__*/[];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(['/vag-oil/cashier','/vag-oil/vendor/zxing-0.21.3.min.js?v=0.52.1','/vag-oil/fonts/Roboto-Variable.ttf','/vag-oil/cashier.webmanifest','/vag-oil/cashier-icon.svg','/vag-oil/vag-icon-192.png','/vag-oil/vag-icon-512.png','/vag-oil/vag-icon-180.png',...ASSETS.map(path=>'/vag-oil'+path)])})()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/vag-oil/api/'))return;
 if(request.mode==='navigate'&&url.pathname==='/vag-oil/cashier'){
  event.respondWith((async()=>{try{const response=await fetch(request);if(!response.ok)throw Error('Unavailable');const cache=await caches.open(CACHE);await cache.put('/vag-oil/cashier',response.clone());return response}catch{return await caches.match('/vag-oil/cashier')||new Response('Откройте кассу с интернетом для первой подготовки.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}})}})());return;
 }
 if(url.pathname.startsWith('/vag-oil/_next/static/')||['/vag-oil/vendor/zxing-0.21.3.min.js','/vag-oil/fonts/Roboto-Variable.ttf','/vag-oil/cashier.webmanifest','/vag-oil/cashier-icon.svg','/vag-oil/vag-icon-192.png','/vag-oil/vag-icon-512.png','/vag-oil/vag-icon-180.png'].includes(url.pathname))event.respondWith((async()=>{const cached=await caches.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok){const cache=await caches.open(CACHE);await cache.put(request,response.clone())}return response})());
});
