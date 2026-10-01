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
const products = require("./products.json");

const app = express();

const port = Number(
  process.env.PORT || 8080
);

const allowedOrigin =
  process.env.ALLOWED_ORIGIN || "*";

/*
  SAFETY SWITCHES
*/

const runOnStartup =
  String(
    process.env.RUN_ON_STARTUP || "false"
  ).toLowerCase() === "true";

const enableFullPolling =
  String(
    process.env.ENABLE_FULL_POLLING || "false"
  ).toLowerCase() === "true";

/*
  Default = 5 minutes.

  This value does NOTHING unless
  ENABLE_FULL_POLLING=true.
*/

const pollSeconds =
  Math.max(
    60,
    Number(
      process.env.POLL_SECONDS || 300
    )
  );

/*
  MIDDLEWARE
*/

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
        : null
  });
});

/*
  HEALTH CHECK

  FREE.
  Does not contact Walmart.
*/

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
        : null
  });
});

/*
  SCANNER INFORMATION

  FREE.
*/

app.get("/api/scanner", (req, res) => {
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
});

/*
  CURRENT DASHBOARD STATE

  FREE.
*/

app.get("/api/status", (req, res) => {
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
});

/*
  WALMART-DIRECT RESULTS ONLY

  FREE.
*/

app.get("/api/products", (req, res) => {
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
});

/*
  CONTROLLED ONE-PRODUCT TEST

  Example:

  /api/test/product/prismatic-etb

  THIS DOES CONTACT WALMART.

  Only the requested product
  is checked.
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
          test:
            "single-product",
          dashboardUpdated:
            false,
          error:
            error.message
        });
    }
  }
);

/*
  OLD PRISMATIC TEST LINK

  Kept for compatibility.
*/

app.get(
  "/
