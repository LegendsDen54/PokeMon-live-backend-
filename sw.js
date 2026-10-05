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

self.addEventListener(
  "notificationclick",
  event => {

    event.notification.close();


    const targetUrl =
      event.notification
        ?.data
        ?.url ||
      "/";


    event.waitUntil(

      clients
        .matchAll({

          type:
            "window",

          includeUncontrolled:
            true

        })

        .then(
          async windowClients => {

            for (
              const client
              of windowClients
            ) {

              if (
                "focus" in client
              ) {

                try {

                  if (
                    "navigate" in client &&
                    targetUrl
                  ) {

                    await client
                      .navigate(
                        targetUrl
                      );

                  }

                } catch (error) {

                  console.log(
                    "[SW] Existing window navigation failed:",
                    error
                  );

                }


                return client.focus();

              }

            }


            if (
              clients.openWindow
            ) {

              return clients
                .openWindow(
                  targetUrl
                );

            }


            return null;

          }
        )

    );

  }
);


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
