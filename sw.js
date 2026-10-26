/* ========================================
   POKÉMON RESTOCK MONITOR
   SERVICE WORKER
======================================== */


self.addEventListener(
  "install",
  event => {

    console.log(
      "[SW] Pokémon Restock Monitor installed"
    );


    self.skipWaiting();

  }
);


self.addEventListener(
  "activate",
  event => {

    console.log(
      "[SW] Pokémon Restock Monitor activated"
    );


    event.waitUntil(
      self.clients.claim()
    );

  }
);


/* ========================================
   PUSH NOTIFICATIONS
======================================== */

let sourcePushQueue=Promise.resolve();
self.addEventListener(
  "push",
  event => {

    console.log(
      "[SW] Push received"
    );


    let data = {};


    try {

      if (event.data) {

        data =
          event.data.json();

      }

    } catch (error) {

      console.error(
        "[SW] Could not parse JSON:",
        error
      );


      try {

        data = {

          body:
            event.data
              ? event.data.text()
              : "Pokémon restock detected."

        };

      } catch {

        data = {};

      }

    }


    const title =
      data.title ||
      "🔥 Pokémon Restock Alert";


    const options = {

      body:
        data.body ||
        data.message ||
        "A Pokémon product may be available.",

      icon:
        data.icon ||
        "/hero.jpg",

      badge:
        data.badge ||
        "/hero.jpg",

      tag:
        data.tag ||
        "pokemon-restock-alert",

      renotify:
        !data.eventId,

      requireInteraction:
        true,

      data: {
        title,
        body: data.body || data.message || "A Pokémon product may be available.",
        receivedAt: new Date().toISOString(),

        url:
          data.url ||
          data.productUrl ||
          "/",
        sourceUrl: data.sourceUrl || null,

        retailer:
          data.retailer ||
          null,

        game: data.game || null,

        product:
          data.product ||
          data.name ||
          null

      }

    };


    event.waitUntil(

      (sourcePushQueue=sourcePushQueue.catch(()=>{}).then(async()=>{
        // Persist an event receipt so repeated delivery cannot buzz the same device again.
        if(data.eventId){
          try{
            const cache=await caches.open('source-push-receipts-v1');
            const key=new Request(new URL('/__source_push_receipt/'+encodeURIComponent(data.eventId),self.location.origin));
            const previous=await cache.match(key);
            if(previous && Date.now()-Number(await previous.text())<90*60000)return;
            await cache.put(key,new Response(String(Date.now())));
            const keys=await cache.keys();
            for(const old of keys.slice(0,Math.max(0,keys.length-200)))await cache.delete(old);
          }catch{/* Server delivery claims still protect clients without cache storage. */}
        }
        await self.registration.showNotification(title,options);
      }))

    );

  }
);


/* ========================================
   NOTIFICATION CLICK
======================================== */

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const alert=event.notification.data || {};
  let target;
  try {
    target=new URL(alert.sourceUrl || alert.url || '/',self.location.origin);
    if(target.protocol!=='https:')target=new URL('/',self.location.origin);
  } catch {
    target=new URL('/',self.location.origin);
  }
  // Preserve the exact external source. Private inventory completions keep
  // their original same-origin product/ZIP route.
  const drawing=target.hostname==='www.walmart.com' && target.pathname==='/shop/collectibles/draw';
  const retailer=alert.game==='onepiece'?(alert.product?'onepiece':'onepiecenews'):alert.retailer;
  if(target.origin===self.location.origin && !drawing && ['all','walmart','target','pokemoncenter','sams','costco','bestbuy','barnes','dollargeneral','onepiece','onepiecenews'].includes(retailer)){
    const destination=new URL('/',self.location.origin);
    destination.searchParams.set('retailer',retailer);
    if(target.origin===self.location.origin)for(const key of ['productId','zip','upc']){
      if(target.searchParams.has(key))destination.searchParams.set(key,target.searchParams.get(key));
    }
    destination.hash='notification='+encodeURIComponent(JSON.stringify({...alert,retailer,clickedAt:new Date().toISOString()}));
    target=destination;
  }
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    // Always navigate app notifications, even when its URL already matches:
    // users may have switched tabs inside that window since the last tap.
    const exact=windows.find(client=>client.url===target.href);
    if(exact && target.origin!==self.location.origin)return exact.focus();
    if(target.origin===self.location.origin){
      const app=windows.find(client=>new URL(client.url).origin===self.location.origin);
      if(app){
        const navigated=await app.navigate(target.href).catch(()=>null);
        if(navigated)return navigated.focus();
      }
    }
    // Call openWindow inside the notification click lifetime so mobile browsers
    // retain the user action needed to open the actual retailer destination.
    return self.clients.openWindow(target.href);
  })());
});

// A failed app navigation must offer recovery instead of a white browser page.
// Never cache private reports or replace external-source responses.
self.addEventListener('fetch',event=>{
  const requested=new URL(event.request.url);
  if(event.request.destination==='image'&&requested.origin===self.location.origin&&
      (requested.pathname==='/api/product-image'||requested.pathname.startsWith('/product-images/'))){
    event.respondWith((async()=>{
      const cache=await caches.open('verified-product-images-v1');
      const cached=await cache.match(event.request);
      if(cached)return cached;
      const response=await fetch(event.request);
      if(response.ok&&/^image\//i.test(response.headers.get('content-type')||'')){
        await cache.put(event.request,response.clone());
        const keys=await cache.keys();for(const old of keys.slice(0,Math.max(0,keys.length-40)))await cache.delete(old);
      }
      return response;
    })());
    return;
  }
  if(event.request.mode!=='navigate'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(!response.ok)throw Error('Monitor unavailable');
    return response;
  }).catch(()=>new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monitor connection interrupted</title><body style="background:#101827;color:#fff;font:18px system-ui;padding:32px"><h1>Monitor could not load</h1><p>Your connection or the monitor server is temporarily unavailable. Your saved search has not been changed.</p><button onclick="location.reload()" style="font:inherit;padding:12px">Try again</button><p><a style="color:#f5cc53" href="/">Open monitor home</a></p></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});

/* ========================================
   MESSAGE HANDLER
======================================== */

self.addEventListener(
  "message",
  event => {

    if (
      event.data?.type ===
      "SKIP_WAITING"
    ) {

      self.skipWaiting();

    }

  }
);
