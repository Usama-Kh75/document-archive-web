'use strict';
const CACHE_PREFIX='document-archive-web:'+new URL(self.registration.scope).pathname+':';
// The build digest changes with any served file, so every change installs a new worker.
const CACHE=CACHE_PREFIX+'1.2.4-c29cde2c4a86';
const ASSETS=['./','./index.html','./app.js','./core.js','./style.css','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(ASSETS.map(path=>new Request(path,{cache:'reload'})));await self.skipWaiting();})));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
 const canonical=new URL(url.href);canonical.search='';canonical.hash='';
 const known=ASSETS.some(path=>new URL(path,self.registration.scope).href===canonical.href);
 if(!known)return;
 // Pages and scripts come from the same release cache, so they never mix versions;
 // a new release reaches the page as a new worker followed by a reload.
 event.respondWith((async()=>(await (await caches.open(CACHE)).match(canonical.href))||fetch(event.request))());
});
