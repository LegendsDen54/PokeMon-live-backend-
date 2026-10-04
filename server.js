require("dotenv").config();

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

const app = express();

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
    process.env.ENABLE_DISCOVERY || "true"
  ).toLowerCase() === "true";

/*
  KNOWN PRODUCT SCANNING
  Minimum: 60 seconds
*/
const pollSeconds =
  Math.max(
    60,
    Number(
      process.env.POLL_SECONDS || 60
    )
  );

/*
  NEW PRODUCT DISCOVERY
  Minimum: 5 minutes
*/
const discoveryMinutes =
  Math.max(
    5,
    Number(
      process.env.DISCOVERY_MINUTES || 5
    )
  );

app.use(
  cors({
    origin:
      allowedOrigin === "*"
        ? true
        : allowedOrigin
  })
);

app.use(express.json());


/* ========================================
   ROOT
======================================== */

app.get("/", (req, res) => {
  res.json({
    name:
      "Pokemon Live Monitor Backend",

    ok: true,

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

    push:
      push.getPushStatus()
  });
});


/* ========================================
   HEALTH
======================================== */

app.get("/health", (req, res) => {
  res.json({
    ok: true,

    time:
      new Date().toISOString(),

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

    push:
      push.getPushStatus()
  });
});


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
          ok: false,
          error:
            "Web Push is not configured"
        });
    }

    return res.json({
      ok: true,
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
    return res.json(
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
        await push.sendTestAlert();

      return res.json({
        ok: true,
        test: "web-push",
        walmartApiCalled: false,
        ...result
      });

    } catch (error) {
      console.error(
        "Push test failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          test: "web-push",
          walmartApiCalled: false,
          error:
            error.message
        });
    }
  }
);


/* ========================================
   SAVE PUSH SUBSCRIPTION
======================================== */

app.post(
  "/api/push/subscribe",
  async (req, res) => {
    try {
      const result =
        await push.addSubscription(
          req.body
        );

      return res.json({
        ...result,

        message:
          "Push subscription saved permanently"
      });

    } catch (error) {
      console.error(
        "Push subscription failed:",
        error
      );

      return res
        .status(400)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


/* ========================================
   REMOVE PUSH SUBSCRIPTION
======================================== */

app.post(
  "/api/push/unsubscribe",
  async (req, res) => {
    try {
      const endpoint =
        req.body &&
        req.body.endpoint;

      if (!endpoint) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Subscription endpoint required"
          });
      }

      const result =
        await push.removeSubscription(
          endpoint
        );

      return res.json(
        result
      );

    } catch (error) {
      console.error(
        "Push unsubscribe failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


/* ========================================
   SCANNER CONFIG
======================================== */

app.get(
  "/api/scanner",
  (req, res) => {
    const state =
      getScannerState();

    res.json({
      ...state,

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
          : null
    });
  }
);


/* ========================================
   DASHBOARD STATUS
======================================== */

app.get(
  "/api/status",
  (req, res) => {
    const data =
      getLatest();

    res.json({
      lastRun:
        data.lastRun,

      running:
        data.running,

      count:
        data.items.length,

      items:
        data.items
    });
  }
);


/* ========================================
   PRODUCTS
======================================== */

app.get(
  "/api/products",
  (req, res) => {
    const data =
      getLatest();

    const filtered =
      data.items.filter(
        item =>
          item.directSeller === true &&
          item.withinPriceRule !== false
      );

    res.json({
      lastRun:
        data.lastRun,

      count:
        filtered.length,

      items:
        filtered
    });
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
            ok: false,
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
        !product.retailers.includes(
          "walmart"
        )
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Product is not configured for Walmart"
          });
      }

      const result =
        await walmart.checkProduct(
          product,
          "walmart"
        );

      const savedResult =
        saveResult(result);

      return res.json({
        ok: true,

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

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


/* ========================================
   PRISMATIC ETB TEST
======================================== */

app.get(
  "/api/test/prismatic-etb",
  async (req, res) => {
    try {
      const product =
        products.find(
          item =>
            item.id ===
            "prismatic-etb"
        );

      if (!product) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "prismatic-etb not found"
          });
      }

      const result =
        await walmart.checkProduct(
          product,
          "walmart"
        );

      const savedResult =
        saveResult(result);

      return res.json({
        ok: true,

        test:
          "single-product",

        dashboardUpdated:
          true,

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

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


/* ========================================
   MANUAL DISCOVERY
======================================== */

app.get(
  "/api/discovery/run",
  async (req, res) => {
    try {
      const result =
        await discovery
          .discoverWalmartProducts();

      return res.json({
        ok: true,
        discovery:
          result
      });

    } catch (error) {
      console.error(
        "Manual discovery failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


/* ========================================
   DISCOVERED PRODUCTS
======================================== */

app.get(
  "/api/discovery/products",
  async (req, res) => {
    try {
      const items =
        await discovery
          .getDiscoveredProducts();

      return res.json({
        ok: true,

        count:
          items.length,

        items
      });

    } catch (error) {
      console.error(
        "Get discovered products failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


/* ========================================
   WALMART SEARCH DIAGNOSTIC
======================================== */

app.get(
  "/api/debug/walmart-search",
  async (req, res) => {
    try {
      const keyword =
        req.query.keyword ||
        "Pokemon TCG";

      const result =
        await walmart
          .inspectSearchResponse(
            keyword
          );

      return res.json({
        ok: true,
        ...result
      });

    } catch (error) {
      console.error(
        "Walmart search diagnostic failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


/* ========================================
   SCHEDULED STOCK SCAN
======================================== */

async function runScheduledScan() {
  try {
    console.log(
      "Starting scheduled catalog scan..."
    );

    const result =
      await runCheck();

    console.log(
      "Scheduled catalog scan finished:",
      result
    );

  } catch (error) {
    console.error(
      "Scheduled catalog scan failed:",
      error
    );
  }
}


/* ========================================
   SCHEDULED DISCOVERY
======================================== */

let discoveryRunning = false;

async function runScheduledDiscovery() {
  if (discoveryRunning) {
    console.log(
      "Discovery already running. Skipping duplicate run."
    );

    return;
  }

  discoveryRunning = true;

  try {
    console.log(
      "Starting Walmart product discovery..."
    );

    const result =
      await discovery
        .discoverWalmartProducts();

    console.log(
      "Walmart product discovery finished:",
      result
    );

  } catch (error) {
    console.error(
      "Walmart product discovery failed:",
      error
    );

  } finally {
    discoveryRunning = false;
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


    /*
      INITIALIZE DISCOVERY DATABASE
    */

    try {
      await discovery
        .initializeDiscoveryDatabase();

      console.log(
        "Discovery storage ready."
      );

    } catch (error) {
      console.error(
        "Discovery database initialization failed:",
        error
      );
    }


    /*
      INITIALIZE PERSISTENT PUSH STORAGE

      This reloads phone subscriptions
      after every Render restart/deploy.
    */

    try {
      const pushDatabase =
        await push
          .initializePushDatabase();

      console.log(
        "Persistent push storage ready:",
        pushDatabase
      );

    } catch (error) {
      console.error(
        "Push database initialization failed:",
        error
      );
    }


    /*
      OPTIONAL STARTUP STOCK SCAN
    */

    if (runOnStartup) {
      console.log(
        "RUN_ON_STARTUP enabled."
      );

      await runScheduledScan();

    } else {
      console.log(
        "Startup scan disabled."
      );
    }


    /*
      AUTOMATIC STOCK SCANNER
    */

    if (enableFullPolling) {
      console.log(
        `Automatic catalog polling ENABLED every ${pollSeconds} seconds.`
      );

      setInterval(
        runScheduledScan,
        pollSeconds * 1000
      );

    } else {
      console.log(
        "Automatic catalog polling disabled."
      );
    }


    /*
      AUTOMATIC PRODUCT DISCOVERY
    */

    if (enableDiscovery) {
      console.log(
        `Automatic Walmart discovery ENABLED every ${discoveryMinutes} minutes.`
      );

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

    } else {
      console.log(
        "Automatic Walmart discovery disabled."
      );
    }
  }
);
