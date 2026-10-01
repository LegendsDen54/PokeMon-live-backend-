require("dotenv").config();

const express = require("express");
const cors = require("cors");

const {
  runCheck,
  getLatest,
  saveResult
} = require("./monitor");

const walmart = require("./walmart");
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
    automaticScanning: false
  });
});

/*
  HEALTH CHECK

  Does NOT call Walmart.
*/
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    automaticScanning: false
  });
});

/*
  DASHBOARD DATA

  Does NOT call Walmart.
*/
app.get("/api/status", (req, res) => {
  const data = getLatest();

  res.json({
    lastRun: data.lastRun,
    count: data.items.length,
    items: data.items
  });
});

/*
  WALMART-DIRECT PRODUCTS ONLY

  Does NOT call Walmart.
*/
app.get("/api/products", (req, res) => {
  const data = getLatest();

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
});

/*
  CONTROLLED SINGLE-PRODUCT TEST

  THIS endpoint DOES make a Walmart API request.

  It checks ONLY the configured
  Prismatic Evolutions ETB.

  The result is then saved into the
  dashboard's in-memory state.
*/
app.get(
  "/api/test/prismatic-etb",
  async (req, res) => {
    try {
      const product =
        products.find(
          item =>
            item.id === "prismatic-etb"
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
  START SERVER
*/
app.listen(
  port,
  async () => {
    console.log(
      `Pokemon monitor backend listening on ${port}`
    );

    /*
      Startup scanning stays disabled unless
      RUN_ON_STARTUP=true is explicitly set.

      On our current configuration it is false.
    */
    if (runOnStartup) {
      console.log(
        "RUN_ON_STARTUP enabled."
      );

      await runCheck();
    } else {
      console.log(
        "Startup scan disabled."
      );
    }

    /*
      IMPORTANT:

      There is intentionally NO setInterval()
      here right now.

      That prevents an automatic full-catalog
      Walmart scan from consuming API quota.

      Later, when the larger API plan is active,
      we can add the optimized scheduler.
    */

    console.log(
      "Automatic catalog polling disabled."
    );
  }
);
