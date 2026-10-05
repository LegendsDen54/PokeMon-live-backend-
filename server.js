require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");

const {
  runCheck,
  getLatest,
  saveResult,
  getScannerState
} = require("./monitor");

const walmart = require("./walmart");
const push = require("./push");
const discovery = require("./discovery");
const products = require("./products.json");
const multiStore = require("./multi-store");

const {
  createWalmartScheduler
} = require("./walmart-scheduler");

const walmartWatchlist =
  require("./walmart-watchlist");

const walmart30thDiscovery =
  require("./walmart-30th-discovery");


const app = express();


/* ========================================
   ENVIRONMENT
======================================== */

const port =
  Number(process.env.PORT || 8080);

const allowedOrigin =
  process.env.ALLOWED_ORIGIN || "*";

const runOnStartup =
  String(
    process.env.RUN_ON_STARTUP || "false"
  ).toLowerCase() === "true";

const enableFullPolling =
  String(
    process.env.ENABLE_FULL_POLLING || "false"
  ).toLowerCase() === "true";

const enableDiscovery =
  String(
    process.env.ENABLE_DISCOVERY || "false"
  ).toLowerCase() === "true";

const pollSeconds =
  Math.max(
    60,
    Number(
      process.env.POLL_SECONDS || 60
    )
  );

const discoveryMinutes =
  Math.max(
    5,
    Number(
      process.env.DISCOVERY_MINUTES || 5
    )
  );

const manualScanToken =
  process.env.MANUAL_SCAN_TOKEN || "";

const walmartWakeToken =
  process.env.WALMART_WAKE_TOKEN || "";


/* ========================================
   EXPRESS
======================================== */

app.use(
  cors({
    origin:
      allowedOrigin === "*"
        ? true
        : allowedOrigin
  })
);

app.use(
  express.json()
);


/* ========================================
   WALMART SCAN
======================================== */

async function runScheduledScan() {

  try {

    console.log(
      "Starting Walmart catalog scan..."
    );

    const catalogResult =
      await runCheck();

    let discovery30th =
      null;

    try {

      discovery30th =
        await walmart30thDiscovery
          .runDiscovery();

      console.log(
        "Walmart 30th discovery finished:",
        {
          count:
            discovery30th?.count || 0,

          directCount:
            discovery30th?.directCount || 0,

          availableDirectCount:
            discovery30th
              ?.availableDirectCount || 0
        }
      );

    } catch (error) {

      console.error(
        "Walmart 30th discovery failed:",
        error.message
      );

      discovery30th = {
        ok: false,
        error: error.message
      };

    }

    const result = {
      ...catalogResult,
      discovery30th
    };

    console.log(
      "Walmart catalog scan finished:",
      result
    );

    return result;

  } catch (error) {

    console.error(
      "Walmart catalog scan failed:",
      error
    );

    throw error;

  }

}


/* ========================================
   SCHEDULER
======================================== */

const walmartScheduler =
  createWalmartScheduler({
    runScan:
      runScheduledScan
  });


/* ========================================
   TOKEN HELPERS
======================================== */

function hasValidManualToken(req) {

  if (!manualScanToken) {
    return false;
  }

  const supplied =
    req.get("x-monitor-token") ||
    req.body?.token ||
    "";

  return (
    supplied ===
    manualScanToken
  );

}


function hasValidWakeToken(req) {

  if (!walmartWakeToken) {
    return false;
  }

  const auth =
    String(
      req.get("authorization") || ""
    );

  const bearer =
    auth
      .toLowerCase()
      .startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";

  const supplied =
    req.get("x-wake-token") ||
    bearer ||
    req.query?.token ||
    "";

  return (
    supplied ===
    walmartWakeToken
  );

}


/* ========================================
   FRONTEND
======================================== */

app.get(
  "/",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);


/* ========================================
   HERO IMAGE
======================================== */

app.get(
  "/hero.jpg",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "hero.jpg"
      )
    );

  }
);


/* ========================================
   MANIFEST
======================================== */

app.get(
  "/manifest.json",
  (req, res) => {

    res.setHeader(
      "Content-Type",
      "application/manifest+json"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache"
    );

    res.sendFile(
      path.join(
        __dirname,
        "manifest.json"
      )
    );

  }
);


/* ========================================
   SERVICE WORKER
======================================== */

app.get(
  "/sw.js",
  (req, res) => {

    res.setHeader(
      "Content-Type",
      "application/javascript; charset=utf-8"
    );

    res.setHeader(
      "Service-Worker-Allowed",
      "/"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate"
    );

    res.sendFile(
      path.join(
        __dirname,
        "sw.js"
      )
    );

  }
);


/* ========================================
   BACKEND STATUS
======================================== */

app.get(
  "/api/backend",
  (req, res) => {

    res.json({

      name:
        "Pokemon Live Monitor Backend",

      ok:
        true,

      provider:
        process.env.DATA_PROVIDER ||
        "mock",

      automaticScanning:
        enableFullPolling,

      pollSeconds:
        enableFullPolling
          ? pollSeconds
          : null,

      automaticDiscovery:
        enableDiscovery,

      discoveryMinutes:
        enableDiscovery
          ? discoveryMinutes
          : null,

      scheduledWalmartScanning:
        walmartScheduler
          .getStatus(),

      walmartProvider:
        walmart
          .getProviderInfo?.() ||
        null,

      walmart30thDiscovery:
        walmart30thDiscovery
          .getState(),

      marketplaceEndpoint:
        "/api/marketplace",

      providers:
        multiStore
          .getProviderStates(),

      push:
        push.getPushStatus()

    });

  }
);


app.get(
  "/health",
  (req, res) => {

    res.json({

      ok:
        true,

      time:
        new Date()
          .toISOString(),

      automaticScanning:
        enableFullPolling,

      pollSeconds:
        enableFullPolling
          ? pollSeconds
          : null,

      automaticDiscovery:
        enableDiscovery,

      discoveryMinutes:
        enableDiscovery
          ? discoveryMinutes
          : null,

      walmartSchedule:
        walmartScheduler
          .getStatus(),

      walmartProvider:
        walmart
          .getProviderInfo?.() ||
        null,

      walmart30thDiscovery:
        walmart30thDiscovery
          .getState(),

      providers:
        multiStore
          .getProviderStates(),

      push:
        push.getPushStatus()

    });

  }
);


/* ========================================
   PUSH PUBLIC KEY
======================================== */

app.get(
  "/api/push/public-key",
  (req, res) => {

    const publicKey =
      push.getPublicKey();

    if (!publicKey) {

      return res
        .status(503)
        .json({

          ok:
            false,

          error:
            "Web Push is not configured"

        });

    }

    res.json({

      ok:
        true,

      publicKey

    });

  }
);


/* ========================================
   PUSH STATUS
======================================== */

app.get(
  "/api/push/status",
  (req, res) => {

    res.json(
      push.getPushStatus()
    );

  }
);


/* ========================================
   PUSH TEST
======================================== */

app.get(
  "/api/push/test",
  async (req, res) => {

    try {

      const result =
        await push
          .sendTestAlert();

      res.json({

        ok:
          true,

        test:
          "web-push",

        walmartApiCalled:
          false,

        ...result

      });

    } catch (error) {

      console.error(
        "Push test failed:",
        error
      );

      res
        .status(500)
        .json({

          ok:
            false,

          test:
            "web-push",

          walmartApiCalled:
            false,

          error:
            error.message

        });

    }

  }
);


/* ========================================
   PUSH SUBSCRIBE
======================================== */

app.post(
  "/api/push/subscribe",
  async (req, res) => {

    try {

      const result =
        await push
          .addSubscription(
            req.body
          );

      res.json({

        ...result,

        message:
          "Push subscription saved permanently"

      });

    } catch (error) {

      console.error(
        "Push subscription failed:",
        error
      );

      res
        .status(400)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


/* ========================================
   PUSH UNSUBSCRIBE
======================================== */

app.post(
  "/api/push/unsubscribe",
  async (req, res) => {

    try {

      const endpoint =
        req.body?.endpoint;

      if (!endpoint) {

        return res
          .status(400)
          .json({

            ok:
              false,

            error:
              "Subscription endpoint required"

          });

      }

      res.json(

        await push
          .removeSubscription(
            endpoint
          )

      );

    } catch (error) {

      console.error(
        "Push unsubscribe failed:",
        error
      );

      res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


/* ========================================
   SCANNER
======================================== */

app.get(
  "/api/scanner",
  (req, res) => {

    res.json({

      ...getScannerState(),

      automaticPolling:
        enableFullPolling,

      pollSeconds:
        enableFullPolling
          ? pollSeconds
          : null,

      automaticDiscovery:
        enableDiscovery,

      discoveryMinutes:
        enableDiscovery
          ? discoveryMinutes
          : null,

      walmartSchedule:
        walmartScheduler
          .getStatus()

    });

  }
);


/* ========================================
   STATUS
======================================== */

app.get(
  "/api/status",
  (req, res) => {

    const data =
      getLatest();

    res.json({

      ok:
        true,

      lastRun:
        data.lastRun,

      running:
        data.running,

      count:
        data.items.length,

      items:
        data.items,

      scanner:
        getScannerState(),

      providers:
        multiStore
          .getProviderStates(),

      automaticScanning:
        enableFullPolling,

      pollSeconds:
        enableFullPolling
          ? pollSeconds
          : null,

      automaticDiscovery:
        enableDiscovery,

      discoveryMinutes:
        enableDiscovery
          ? discoveryMinutes
          : null,

      walmartSchedule:
        walmartScheduler
          .getStatus(),

      walmartProvider:
        walmart
          .getProviderInfo?.() ||
        null,

      upcoming:
        walmart
          .getUpcoming?.() ||
        [],

      walmartWatchlist:
        walmartWatchlist
          .mergeUpcomingWithWatchlist(

            walmart
              .getUpcoming?.() ||
            []

          ),

      walmart30thDiscovery:
        walmart30thDiscovery
          .getState(),

      push:
        push.getPushStatus()

    });

  }
);


/* ========================================
   PROVIDERS
======================================== */

app.get(
  "/api/providers",
  (req, res) => {

    const providers =
      multiStore
        .getProviderStates();

    res.json({

      ok:
        true,

      count:
        providers.length,

      providers

    });

  }
);


/* ========================================
   PRODUCTS
======================================== */

app.get(
  "/api/products",
  (req, res) => {

    const retailer =
      req.query.retailer
        ? String(
            req.query.retailer
          ).toLowerCase()
        : null;

    const allowed =
      new Set([

        "walmart",

        "target",

        "sams",

        "bestbuy",

        "costco"

      ]);

    if (
      retailer &&
      !allowed.has(
        retailer
      )
    ) {

      return res
        .status(400)
        .json({

          ok:
            false,

          error:
            "Unsupported retailer"

        });

    }

    const items =
      multiStore
        .getProducts(
          retailer
        );

    res.json({

      ok:
        true,

      retailer,

      count:
        items.length,

      items

    });

  }
);


/* ========================================
   STORE INVENTORY
======================================== */

app.get(
  "/api/stores",
  (req, res) => {

    const retailer =
      req.query.retailer
        ? String(
            req.query.retailer
          ).toLowerCase()
        : null;

    const items =
      multiStore
        .getStoreInventory(
          retailer
        );

    res.json({

      ok:
        true,

      retailer,

      count:
        items.length,

      items

    });

  }
);


/* ========================================
   WALMART SCHEDULE
======================================== */

app.get(
  "/api/walmart/schedule",
  (req, res) => {

    res.json({

      ok:
        true,

      schedule:
        walmartScheduler
          .getStatus()

    });

  }
);


/* ========================================
   WALMART PROVIDER
======================================== */

app.get(
  "/api/walmart/provider",
  (req, res) => {

    res.json({

      ok:
        true,

      provider:
        walmart
          .getProviderInfo?.() ||
        null

    });

  }
);


/* ========================================
   WALMART UPCOMING
======================================== */

app.get(
  "/api/walmart/upcoming",
  (req, res) => {

    const items =
      walmart
        .getUpcoming?.() ||
      [];

    res.json({

      ok:
        true,

      count:
        items.length,

      items

    });

  }
);


/* ========================================
   WATCHLIST
======================================== */

app.get(
  "/api/walmart/watchlist",
  (req, res) => {

    const merged =
      walmartWatchlist
        .mergeUpcomingWithWatchlist(

          walmart
            .getUpcoming?.() ||
          []

        );

    res.json({

      ok:
        true,

      detectedCount:
        merged.detected.length,

      watchingCount:
        merged.watching.length,

      count:
        merged.all.length,

      detected:
        merged.detected,

      watching:
        merged.watching,

      items:
        merged.all

    });

  }
);


/* ========================================
   30TH DISCOVERY
======================================== */

app.get(
  "/api/walmart/30th",
  (req, res) => {

    res.json({

      ok:
        true,

      ...walmart30thDiscovery
        .getState()

    });

  }
);


/* ========================================
   WALMART HEALTH
======================================== */

app.get(
  "/api/walmart/health",
  (req, res) => {

    res.json({

      ok:
        true,

      provider:
        walmart
          .getProviderInfo?.() ||
        null,

      scanner:
        getScannerState(),

      schedule:
        walmartScheduler
          .getStatus(),

      watchlistCount:
        walmartWatchlist
          .getConfiguredWatchlist()
          .length,

      discovery30th:
        walmart30thDiscovery
          .getState()

    });

  }
);


/* ========================================
   WALMART WAKE
======================================== */

app.all(
  "/api/walmart/wake",
  async (req, res) => {

    if (!walmartWakeToken) {

      return res
        .status(503)
        .json({

          ok:
            false,

          error:
            "Wake protection is disabled until WALMART_WAKE_TOKEN is configured"

        });

    }

    if (
      !hasValidWakeToken(
        req
      )
    ) {

      return res
        .status(401)
        .json({

          ok:
            false,

          error:
            "Invalid wake token"

        });

    }

    try {

      const result =
        await walmartScheduler
          .wakeScan();

      res.json({

        ok:
          true,

        result,

        schedule:
          walmartScheduler
            .getStatus()

      });

    } catch (error) {

      console.error(
        "Walmart wake scan failed:",
        error
      );

      res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


/* ========================================
   MANUAL WALMART SCAN
======================================== */

app.post(
  "/api/walmart/scan",
  async (req, res) => {

    if (!manualScanToken) {

      return res
        .status(503)
        .json({

          ok:
            false,

          error:
            "Manual scan is disabled until MANUAL_SCAN_TOKEN is configured"

        });

    }

    if (
      !hasValidManualToken(
        req
      )
    ) {

      return res
        .status(401)
        .json({

          ok:
            false,

          error:
            "Invalid manual scan token"

        });

    }

    try {

      const result =
        await walmartScheduler
          .manualScan();

      res.json({

        ok:
          result?.ok !== false,

        result

      });

    } catch (error) {

      console.error(
        "Manual Walmart scan failed:",
        error
      );

      res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


/* ========================================
   MARKETPLACE
======================================== */

app.get(
  "/api/marketplace",
  async (req, res) => {

    try {

      const requestedProductId =
        req.query.productId ||
        null;

      let catalog =
        products.filter(

          product =>
            product.enabled !== false &&

            Array.isArray(
              product.retailers
            ) &&

            product.retailers
              .includes(
                "walmart"
              )

        );

      if (requestedProductId) {

        catalog =
          catalog.filter(

            product =>
              product.id ===
              requestedProductId

          );

        if (!catalog.length) {

          return res
            .status(404)
            .json({

              ok:
                false,

              error:
                "Product not found",

              productId:
                requestedProductId

            });

        }

      }

      const offers =
        [];

      const errors =
        [];

      for (
        const product
        of catalog
      ) {

        try {

          const productOffers =
            await walmart
              .searchMarketplaceOffers(
                product
              );

          for (
            const offer
            of productOffers
          ) {

            offers.push({

              ...offer,

              alertEligible:
                false

            });

          }

        } catch (error) {

          errors.push({

            productId:
              product.id,

            error:
              error.message

          });

        }

      }

      const uniqueOffers =
        new Map();

      for (
        const offer
        of offers
      ) {

        const key =
          offer.walmartItemId
            ? String(
                offer.walmartItemId
              )
            : [
                offer.name,
                offer.seller,
                offer.price
              ].join("|");

        const existing =
          uniqueOffers.get(
            key
          );

        if (
          !existing ||

          Number(
            offer.price
          ) <

          Number(
            existing.price
          )
        ) {

          uniqueOffers.set(
            key,
            offer
          );

        }

      }

      const sorted =
        Array.from(
          uniqueOffers.values()
        )
          .filter(
            offer =>
              offer.price !== null
          )
          .sort(
            (a, b) =>
              Number(a.price) -
              Number(b.price)
          );

      const available =
        sorted.filter(

          offer =>
            offer.offerAvailable ===
            true

        );

      const walmartDirect =
        available.filter(

          offer =>
            offer.directSeller ===
            true

        );

      const marketplace =
        available.filter(

          offer =>
            offer.directSeller !==
            true

        );

      res.json({

        ok:
          true,

        generatedAt:
          new Date()
            .toISOString(),

        sort:
          "price-low-to-high",

        searchedProducts:
          catalog.length,

        totalOffersFound:
          sorted.length,

        availableCount:
          available.length,

        walmartDirectCount:
          walmartDirect.length,

        marketplaceCount:
          marketplace.length,

        failedSearches:
          errors.length,

        items:
          available,

        groups: {

          walmartDirect,

          marketplace

        },

        errors

      });

    } catch (error) {

      console.error(
        "Marketplace endpoint failed:",
        error
      );

      res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


/* ========================================
   CONTROLLED PRODUCT TEST
======================================== */

app.get(
  "/api/test/product/:productId",
  async (req, res) => {

    try {

      const product =
        products.find(

          item =>
            item.id ===
            req.params.productId

        );

      if (!product) {

        return res
          .status(404)
          .json({

            ok:
              false,

            error:
              "Product not found",

            productId:
              req.params.productId

          });

      }

      if (
        !Array.isArray(
          product.retailers
        ) ||

        !product.retailers
          .includes(
            "walmart"
          )
      ) {

        return res
          .status(400)
          .json({

            ok:
              false,

            error:
              "Product is not configured for Walmart"

          });

      }

      const result =
        await walmart
          .checkProduct(
            product,
            "walmart"
          );

      const savedResult =
        saveResult(
          result
        );

      res.json({

        ok:
          true,

        test:
          "single-product",

        dashboardUpdated:
          true,

        requestedProductId:
          product.id,

        configuredItemId:
          product.walmartItemId ||
          null,

        result:
          savedResult

      });

    } catch (error) {

      console.error(
        "Controlled Walmart test failed:",
        error
      );

      res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


/* ========================================
   DISCOVERY
======================================== */

app.get(
  "/api/discovery/run",
  async (req, res) => {

    try {

      res.json({

        ok:
          true,

        discovery:
          await discovery
            .discoverWalmartProducts()

      });

    } catch (error) {

      res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


app.get(
  "/api/discovery/products",
  async (req, res) => {

    try {

      const items =
        await discovery
          .getDiscoveredProducts();

      res.json({

        ok:
          true,

        count:
          items.length,

        items

      });

    } catch (error) {

      res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


/* ========================================
   DISCOVERY LOOP
======================================== */

let discoveryRunning =
  false;


async function runScheduledDiscovery() {

  if (discoveryRunning) {

    return;

  }

  discoveryRunning =
    true;

  try {

    await discovery
      .discoverWalmartProducts();

  } catch (error) {

    console.error(
      "Walmart product discovery failed:",
      error
    );

  } finally {

    discoveryRunning =
      false;

  }

}


/* ========================================
   START SERVER
======================================== */

app.listen(
  port,
  async () => {

    console.log(
      `Pokemon monitor backend listening on ${port}`
    );

    console.log(
      "Web Push configuration:",
      push.getPushStatus()
    );

    try {

      await discovery
        .initializeDiscoveryDatabase();

    } catch (error) {

      console.error(
        "Discovery database initialization failed:",
        error
      );

    }

    try {

      await push
        .initializePushDatabase();

    } catch (error) {

      console.error(
        "Push database initialization failed:",
        error
      );

    }

    try {

      await multiStore
        .start({

          getWalmartState:
            getLatest

        });

    } catch (error) {

      console.error(
        "Multi-store provider startup failed:",
        error
      );

    }

    walmartScheduler
      .start();


    if (runOnStartup) {

      await runScheduledScan();

    }


    if (enableFullPolling) {

      setInterval(
        () => {

          runScheduledScan()
            .catch(
              error => {

                console.error(
                  "Automatic polling failed:",
                  error
                );

              }
            );

        },
        pollSeconds * 1000
      );

    }


    if (enableDiscovery) {

      setTimeout(
        runScheduledDiscovery,
        15000
      );

      setInterval(
        runScheduledDiscovery,
        discoveryMinutes *
          60 *
          1000
      );

    }

  }
);
