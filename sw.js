const CACHE='turno-shell-__BUILD__';
const SHELL=['/barbero','/assets/app.css','/assets/app.js','/assets/admin.js','/assets/shared.js','/assets/favicon.svg','/offline.html'];
const allowed=new Set([...SHELL,'/assets/client.js','/assets/qrcode.js']);
const sensitive=request=>{
 const url=new URL(request.url);
 return url.pathname==='/api'||url.pathname.startsWith('/api/')||url.searchParams.has('t')||
  request.headers.has('Authorization')||request.headers.has('X-Turno-Token');
};
const cacheable=response=>response.ok&&!response.redirected&&
 ![...response.headers.keys()].some(name=>name.includes('token')||name==='set-cookie');
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  for(const path of SHELL){
   const response=await fetch(path,{cache:'reload',redirect:'error'});
   if(!cacheable(response))throw Error('No se pudo preparar la app.');
   await cache.put(path,response);
  }
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('turno-shell-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==location.origin||sensitive(request))return;
 if(request.mode!=='navigate'&&!allowed.has(url.pathname))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   const response=await fetch(request,{cache:'no-cache'});
   if(request.mode!=='navigate'&&allowed.has(url.pathname)&&cacheable(response)){
    try{await cache.put(request,response.clone());}catch{}
   }
   return response;
  }catch{
   if(request.mode==='navigate')return (await cache.match('/offline.html'))||Response.error();
   return (await cache.match(request))||Response.error();
  }
 })());
});
