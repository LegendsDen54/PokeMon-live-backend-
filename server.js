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
const products = require("./products.json");

const app = express();

const port = Number(process.env.PORT || 8080);

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

const pollSeconds = Math.max(
  60,
  Number(process.env.POLL_SECONDS || 300)
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


/*
  ROOT
*/

app.get("/", (req, res) => {
  res.json({
    name: "Pokemon Live Monitor Backend",
    ok: true,
    provider:
      process.env.DATA_PROVIDER || "mock",
    automaticScanning:
      enableFullPolling,
    pollSeconds:
      enableFullPolling
        ? pollSeconds
        : null,
    push:
      push.getPushStatus()
  });
});


/*
  HEALTH
*/

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    automaticScanning:
      enableFullPolling,
    pollSeconds:
      enableFullPolling
        ? pollSeconds
        : null,
    pushConfigured:
      push.getPushStatus().configured
  });
});


/*
  WEB PUSH PUBLIC KEY
*/

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


/*
  WEB PUSH STATUS
*/

app.get(
  "/api/push/status",
  (req, res) => {
    return res.json(
      push.getPushStatus()
    );
  }
);


/*
  WEB PUSH TEST
*/

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
          error: error.message
        });
    }
  }
);


/*
  SAVE PUSH SUBSCRIPTION
*/

app.post(
  "/api/push/subscribe",
  (req, res) => {
    try {
      const result =
        push.addSubscription(
          req.body
        );

      return res.json({
        ...result,
        message:
          "Push subscription saved"
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
          error: error.message
        });
    }
  }
);


/*
  REMOVE PUSH SUBSCRIPTION
*/

app.post(
  "/api/push/unsubscribe",
  (req, res) => {
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

      const removed =
        push.removeSubscription(
          endpoint
        );

      return res.json({
        ok: true,
        removed
      });

    } catch (error) {
      console.error(
        "Push unsubscribe failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error: error.message
        });
    }
  }
);


/*
  SCANNER CONFIGURATION
*/

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
          : null
    });
  }
);


/*
  CURRENT DASHBOARD DATA
*/

app.get(
  "/api/status",
  (req, res) => {
    const data =
      getLatest();

    res.json({
      lastRun: data.lastRun,
      running: data.running,
      count: data.items.length,
      items: data.items
    });
  }
);


/*
  DIRECT RETAILER RESULTS
*/

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
      lastRun: data.lastRun,
      count: filtered.length,
      items: filtered
    });
  }
);


/*
  CONTROLLED WALMART TEST
*/

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
            error: "Product not found",
            productId:
              req.params.productId
          });
      }

      if (
        !Array.isArray(product.retailers) ||
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
        test: "single-product",
        dashboardUpdated: true,
        requestedProductId:
          product.id,
        configuredItemId:
          product.walmartItemId || null,
        result: savedResult
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
          test: "single-product",
          dashboardUpdated: false,
          error: error.message
        });
    }
  }
);


/*
  ORIGINAL PRISMATIC ETB TEST
*/

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
        test: "single-product",
        dashboardUpdated: true,
        configuredItemId:
          product.walmartItemId || null,
        result: savedResult
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
          test: "single-product",
          dashboardUpdated: false,
          error: error.message
        });
    }
  }
);


/*
  SCHEDULED FULL-CATALOG SCAN
*/

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


/*
  START SERVER
*/

app.listen(
  port,
  async () => {
    console.log(
      `Pokemon monitor backend listening on ${port}`
    );

    console.log(
      "Web Push status:",
      push.getPushStatus()
    );

    /*
      OPTIONAL STARTUP SCAN
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
      AUTOMATIC FULL-CATALOG SCANNER
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
  }
);