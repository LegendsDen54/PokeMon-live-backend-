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
  const alert=event.notification.data || {};
  if(alert.url==='https://www.walmart.com/shop/collectibles/draw'){event.waitUntil(self.clients.openWindow(alert.url));return;}
  const target=new URL('/',self.location.origin);
  target.hash='notification='+encodeURIComponent(JSON.stringify({title:alert.title || event.notification.title,body:alert.body || event.notification.body,url:alert.url,retailer:alert.retailer,receivedAt:alert.receivedAt}));
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const app=windows.find(client=>new URL(client.url).origin===self.location.origin);
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
