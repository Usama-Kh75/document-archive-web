'use strict';
const CACHE_PREFIX='document-archive-web:'+new URL(self.registration.scope).pathname+':';
const CACHE=CACHE_PREFIX+'1.2.2';
const ASSETS=['./','./index.html','./app.js','./core.js','./style.css','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(ASSETS);await self.skipWaiting();})));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
 const canonical=new URL(url.href);canonical.search='';canonical.hash='';
 const known=ASSETS.some(path=>new URL(path,self.registration.scope).href===canonical.href);
 if(!known)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(event.request.mode==='navigate'){
   try{const fresh=await fetch(event.request);if(fresh.ok)await cache.put(canonical.href,fresh.clone());return fresh;}
   catch{const offline=await cache.match(canonical.href);if(offline)return offline;throw Error('Page unavailable offline');}
  }
  return (await cache.match(canonical.href))||fetch(event.request);
 })());
});
