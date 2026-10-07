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
        true,

      requireInteraction:
        true,

      data: {

        url:
          data.url ||
          data.productUrl ||
          "/",

        retailer:
          data.retailer ||
          null,

        product:
          data.product ||
          data.name ||
          null

      }

    };


    event.waitUntil(

      self.registration
        .showNotification(
          title,
          options
        )

    );

  }
);


/* ========================================
   NOTIFICATION CLICK
======================================== */

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target;
  try { target=new URL(event.notification?.data?.url || '/',self.location.origin); }
  catch { target=new URL('/',self.location.origin); }
  if(!['https:','http:'].includes(target.protocol))target=new URL('/',self.location.origin);
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const app=windows.find(client=>new URL(client.url).origin===self.location.origin);
    if(target.origin!==self.location.origin){
      // Keep the installed monitor document intact while opening a retailer.
      if(app)app.postMessage({type:'MONITOR_RESUME'});
      return self.clients.openWindow(target.href);
    }
    if(app){
      const navigated=await app.navigate(target.href).catch(()=>null);
      return (navigated || app).focus();
    }
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
