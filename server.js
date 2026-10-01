require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { runCheck, getLatest } = require("./monitor");

const app = express();
const port = Number(process.env.PORT || 8080);
const pollSeconds = Math.max(10, Number(process.env.POLL_SECONDS || 86400));
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

// Safety switch: deployments will NOT automatically burn API requests
// unless RUN_ON_STARTUP=true is explicitly configured.
const runOnStartup =
  String(process.env.RUN_ON_STARTUP || "false").toLowerCase() === "true";

app.use(cors({ origin: allowedOrigin === "*" ? true : allowedOrigin }));
app.use(express.json());

app.get("/", (req, res) =>
  res.json({
    name: "Pokemon Live Monitor Backend",
    ok: true,
    provider: process.env.DATA_PROVIDER || "mock"
  })
);

app.get("/health", (req, res) =>
  res.json({
    ok: true,
    time: new Date().toISOString()
  })
);

// Cached status only — does NOT trigger Walmart API requests.
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

app.listen(port, async () => {
  console.log(`Pokemon monitor backend listening on ${port}`);

  if (runOnStartup) {
    console.log("Running startup Walmart scan...");
    await runCheck();
  } else {
    console.log(
      "Startup Walmart scan disabled to protect API quota."
    );
  }

  setInterval(runCheck, pollSeconds * 1000);
});
