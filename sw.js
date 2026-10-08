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
    target=new URL(alert.url || '/',self.location.origin);
    if(target.protocol!=='https:')target=new URL('/',self.location.origin);
  } catch {
    target=new URL('/',self.location.origin);
  }
  // Stock notifications open their app tab. Verified Walmart drawing alerts
  // retain their required direct drawing-page destination.
  const drawing=target.hostname==='www.walmart.com' && target.pathname==='/shop/collectibles/draw';
  const retailer=alert.game==='onepiece'?(alert.product?'onepiece':'onepiecenews'):alert.retailer;
  if(!drawing && ['all','walmart','target','pokemoncenter','sams','costco','bestbuy','barnes','dollargeneral','onepiece','onepiecenews'].includes(retailer)){
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
