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

const runOnStartup =
  String(
    process.env.RUN_ON_STARTUP || "false"
  ).toLowerCase() === "true";

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
    automaticScanning: false
  });
});

/*
  HEALTH CHECK

  Does NOT contact Walmart.
*/

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    automaticScanning: false
  });
});

/*
  SCANNER INFORMATION

  Does NOT contact Walmart.
*/

app.get("/api/scanner", (req, res) => {
  res.json(
    getScannerState()
  );
});

/*
  CURRENT DASHBOARD STATE

  Does NOT contact Walmart.
*/

app.get("/api/status", (req, res) => {
  const data = getLatest();

  res.json({
    lastRun: data.lastRun,
    running: data.running,
    count: data.items.length,
    items: data.items
  });
});

/*
  WALMART-DIRECT RESULTS ONLY

  Does NOT contact Walmart.
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
  CONTROLLED ONE-PRODUCT WALMART CHECK

  Example:
  /api/test/product/prismatic-etb

  THIS DOES CONTACT WALMART.

  It checks only the requested product.
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
  OLD PRISMATIC ETB TEST LINK

  Keeping this so our original
  test URL still works.
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
  START SERVER

  AUTOMATIC CATALOG POLLING
  IS INTENTIONALLY DISABLED.
*/

app.listen(
  port,
  async () => {
    console.log(
      `Pokemon monitor backend listening on ${port}`
    );

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

    console.log(
      "Automatic catalog polling disabled."
    );
  }
);
