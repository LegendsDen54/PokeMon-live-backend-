require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { runCheck, getLatest } = require("./monitor");
const walmart = require("./walmart");
const products = require("./products.json");

const app = express();
const port = Number(process.env.PORT || 8080);
const pollSeconds = Math.max(
  10,
  Number(process.env.POLL_SECONDS || 86400)
);
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

const runOnStartup =
  String(process.env.RUN_ON_STARTUP || "false").toLowerCase() === "true";

app.use(cors({
  origin: allowedOrigin === "*" ? true : allowedOrigin
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "Pokemon Live Monitor Backend",
    ok: true,
    provider: process.env.DATA_PROVIDER || "mock"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString()
  });
});

app.get("/api/status", (req, res) => {
  const data = getLatest();

  res.json({
    lastRun: data.lastRun,
    count: data.items.length,
    items: data.items
  });
});

app.get("/api/products", (req, res) => {
  const data = getLatest();

  const filtered = data.items.filter(
    item =>
      item.directSeller !== false &&
      item.withinPriceRule !== false
  );

  res.json({
    lastRun: data.lastRun,
    count: filtered.length,
    items: filtered
  });
});

// SINGLE PRODUCT TEST ONLY
app.get("/api/test/prismatic-etb", async (req, res) => {
  try {
    const product = products.find(
      item => item.id === "prismatic-etb"
    );

    if (!product) {
      return res.status(404).json({
        ok: false,
        error: "prismatic-etb not found"
      });
    }

    const result = await walmart.checkProduct(
      product,
      "walmart"
    );

    res.json({
      ok: true,
      test: "single-product",
      configuredItemId: product.walmartItemId || null,
      result
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      test: "single-product",
      error: error.message
    });
  }
});

app.listen(port, async () => {
  console.log(`Pokemon monitor backend listening on ${port}`);

  if (runOnStartup) {
    await runCheck();
  } else {
    console.log("Startup scan disabled.");
  }

  setInterval(runCheck, pollSeconds * 1000);
});
