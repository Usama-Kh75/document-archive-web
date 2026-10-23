'use strict';
const CACHE_PREFIX='document-archive-web:'+new URL(self.registration.scope).pathname+':';
const CACHE=CACHE_PREFIX+'1.2.1';
const ASSETS=['./','./index.html','./app.js','./core.js','./style.css','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
 const canonical=new URL(url.href);canonical.search='';canonical.hash='';
 const known=ASSETS.some(path=>new URL(path,self.registration.scope).href===canonical.href);
 if(!known)return;
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(canonical.href))||fetch(event.request)));
});
