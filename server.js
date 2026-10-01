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

  FREE.
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

  FREE.
  Does NOT contact Walmart.
*/
app.get(
  "/api/scanner",
  (req, res) => {
    res.json(
      getScannerState()
    );
  }
);

/*
  DASHBOARD DATA

  FREE.
  Does NOT contact Walmart.
*/
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

/*
  DIRECT RETAILER PRODUCTS ONLY

  FREE.
  Does NOT contact Walmart.
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
      lastRun:
        data.lastRun,

      count:
        filtered.length,

      items:
        filtered
    });
  }
);

/*
  PRODUCT CATALOG

  FREE.
  Does NOT contact Walmart.

  This lets us inspect which products
  are configured without triggering
  retailer requests.
*/
app.get(
  "/api/catalog",
  (req, res) => {
    const safeProducts =
      products.map(product => ({
        id:
          product.id,

        name:
          product.name,

        set:
          product.set,

        productType:
          product.productType,

        retailers:
          product.retailers,

        walmartItemId:
          product.walmartItemId || null,

        msrp:
          product.msrp ?? null,

        enabled:
          product.enabled !== false
      }));

    res.json({
      count:
        safeProducts.length,

      products:
        safeProducts
    });
  }
);

/*
  CONTROLLED SINGLE-PRODUCT CHECK

  IMPORTANT:
  THIS route contacts Walmart.

  Example:

  /api/test/product/prismatic-etb

  It checks ONLY the product requested.

  It does NOT run the complete catalog.

  The result is saved into the current
  dashboard state.
*/
app.get(
  "/api/test/product/:productId",
  async (req, res) => {
    try {
      const productId =
        String(
          req.params.productId || ""
        ).trim();

      const product =
        products.find(
          item =>
            item.id === productId
        );

      if (!product) {
        return res
          .status(404)
          .json({
            ok: false,
            test:
              "single-product",
            error:
              "Product not found",
            productId
          });
      }

      if (
        product.enabled === false
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            test:
              "single-product",
            error:
              "Product is disabled",
            productId
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
            test:
              "single-product",
            error:
              "Product is not configured for Walmart",
            productId
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

        productId:
          product.id,

        configuredItemId:
          product.walmartItemId ||
          null,

        discoveredItemId:
          savedResult.walmartItemId ||
          null,

        result:
          savedResult
      });

    } catch (error) {
      console.error(
        "Controlled product test failed:",
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
  KEEP OUR ORIGINAL ETB TEST LINK

  This keeps the URL we've already
  been using compatible.

  IMPORTANT:
  Opening it DOES contact Walmart.
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
         
