self.addEventListener(
  "install",
  event => {

    self.skipWaiting();

  }
);


self.addEventListener(
  "activate",
  event => {

    event.waitUntil(
      self.clients.claim()
    );

  }
);


self.addEventListener(
  "push",
  event => {

    let data = {};

    try{

      data =
        event.data
          ? event.data.json()
          : {};

    }
    catch(error){

      try{

        data = {
          body:
            event.data
              ? event.data.text()
              : "Pokémon restock detected."
        };

      }
      catch(secondError){

        data = {
          body:
            "Pokémon restock detected."
        };

      }

    }


    const title =

      data.title ||

      "🔥 Pokémon Restock Detected!";


    const options = {

      body:
        data.body ||
        "A monitored Pokémon product is available.",

      icon:
        data.icon ||
        "/hero.jpg",

      badge:
        data.badge ||
        "/hero.jpg",

      tag:
        data.tag ||
        "pokemon-restock",

      renotify:
        true,

      data:{

        url:
          data.url ||
          "/"

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

          type:"window",

          includeUncontrolled:true

        })

        .then(

          windowClients => {

            for (
              const client
              of windowClients
            ){

              try{

                const clientUrl =

                  new URL(
                    client.url
                  );

                const target =

                  new URL(
                    targetUrl,
                    self.location.origin
                  );

                if (
                  clientUrl.origin ===
                  target.origin
                ){

                  client.navigate(
                    target.href
                  );

                  return client.focus();

                }

              }
              catch(error){

              }

            }


            if (
              clients.openWindow
            ){

              return clients.openWindow(
                targetUrl
              );

            }

          }

        )

    );

  }
);
