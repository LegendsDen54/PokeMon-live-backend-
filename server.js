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


/* ========================================
   SCANNER TIMING
======================================== */

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


/* ========================================
   MIDDLEWARE
======================================== */

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

    marketplaceEndpoint:
      "/api/marketplace",

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
