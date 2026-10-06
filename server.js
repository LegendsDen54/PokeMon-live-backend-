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
const walmartRaffles = require("./walmart-raffles");
const pokemonCenter = require("./pokemon-center");
const push = require("./push");
const discovery = require("./discovery");
const products = require("./products.json");
const multiStore = require("./multi-store");
const retailOnline = require("./retail-online");
const nearbyRetail = require("./nearby-retail");
const ccnInventory = require("./ccn-inventory");


const {
  createWalmartScheduler
} = require("./walmart-scheduler");

const walmartWatchlist =
  require("./walmart-watchlist");

const walmart30thDiscovery =
  require("./walmart-30th-discovery");


/* ========================================
   APP
======================================== */

const app = express();

const port =
  Number(
    process.env.PORT ||
    8080
  );

const allowedOrigin =
  process.env.ALLOWED_ORIGIN ||
  "*";

const runOnStartup =
  String(
    process.env.RUN_ON_STARTUP ||
    "false"
  ).toLowerCase() === "true";

const enableFullPolling =
  String(
    process.env.ENABLE_FULL_POLLING ||
    "false"
  ).toLowerCase() === "true";

const enableDiscovery =
  String(
    process.env.ENABLE_DISCOVERY ||
    "false"
  ).toLowerCase() === "true";

const pollSeconds =
  Math.max(
    60,
    Number(
      process.env.POLL_SECONDS ||
      60
    )
  );

const discoveryMinutes =
  Math.max(
    5,
    Number(
      process.env.DISCOVERY_MINUTES ||
      5
    )
  );

const rafflePollMinutes =
  Math.max(
    5,
    Number(
      process.env.WALMART_RAFFLE_POLL_MINUTES ||
      10
    )
  );

const gtCollectiblesWatchMinutes =
  Math.max(
    10,
    Number(
      process.env.GT_COLLECTIBLES_WATCH_MINUTES ||
      15
    )
  );

const manualScanToken =
  process.env.MANUAL_SCAN_TOKEN ||
  "";

const walmartWakeToken =
  process.env.WALMART_WAKE_TOKEN ||
  "";

const pokemonCenterSensorToken =
  process.env.POKEMON_CENTER_SENSOR_TOKEN ||
  "";

const bestBuyPublicStates = new Map();
const bestBuyBrowserStates = new Map();
const samsBrowserStates = new Map();
const costcoBrowserStates = new Map();


const bestBuyPublicWatchUrls =
  String(process.env.BESTBUY_PUBLIC_WATCH_URLS || "")
    .split(/[\n,]/)
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 12);

const bestBuyPublicPollMinutes =
  Math.max(
    15,
    Number(process.env.BESTBUY_PUBLIC_POLL_MINUTES || 30)
  );

const bestBuyPublicCacheMinutes =
  Math.max(
    5,
    Number(process.env.BESTBUY_PUBLIC_CACHE_MINUTES || 10)
  );

const bestBuyPublicTimeZone =
  process.env.BESTBUY_PUBLIC_TIME_ZONE ||
  "America/Chicago";

const bestBuyPublicWindowStart =
  process.env.BESTBUY_PUBLIC_WINDOW_START ||
  "21:00";

const bestBuyPublicWindowEnd =
  process.env.BESTBUY_PUBLIC_WINDOW_END ||
  "00:00";

const bestBuyPublicScheduleState = {
  running: false,
  lastRun: null,
  lastSuccess: null,
  lastError: null,
  nextRun: null
};

function validBestBuyPublicUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const isProductPage = url.protocol === "https:" &&
      (url.hostname === "www.bestbuy.com" || url.hostname === "bestbuy.com") &&
      (url.pathname.includes("/site/") || url.pathname.includes("/product/"));

    if (!isProductPage) return null;

    // Best Buy review URLs do not contain live fulfilment details. Use the
    // corresponding product page when someone pastes the review link.
    url.pathname = url.pathname.replace(/\/reviews\/?$/i, "");
    return url.href;
  } catch (error) {
    return null;
  }
}

function bestBuyPublicStatus() {
  return {
    configuredUrls: bestBuyPublicWatchUrls.length,
    pollMinutes: bestBuyPublicPollMinutes,
    cacheMinutes: bestBuyPublicCacheMinutes,
    timeZone: bestBuyPublicTimeZone,
    window: `${bestBuyPublicWindowStart}–${bestBuyPublicWindowEnd}`,
    ...bestBuyPublicScheduleState
  };
}

function isBestBuyPublicWindowActive(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: bestBuyPublicTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const [startHour, startMinute] = bestBuyPublicWindowStart.split(":").map(Number);
  const [endHour, endMinute] = bestBuyPublicWindowEnd.split(":").map(Number);
  const minute = Number(values.hour) * 60 + Number(values.minute);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return start <= end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

function isTemporaryBestBuyError(error) {
  const status = Number(error?.status || 0);
  return status === 429 || status >= 500 || error?.name === "AbortError";
}

function retryDelay(error, attempt) {
  const retryAfter = Number(error?.retryAfter || 0);
  if (retryAfter > 0) return Math.min(retryAfter * 1000, 60000);
  const capped = Math.min(8000, 1000 * 2 ** attempt);
  return capped + Math.floor(Math.random() * 500);
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchBestBuyPublicPage(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {accept: "text/html"},
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        const error = new Error(`Best Buy page returned ${response.status}`);
        error.status = response.status;
        error.retryAfter = response.headers.get("retry-after");
        throw error;
      }
      return response.text();
    } catch (error) {
      lastError = error;
      if (!isTemporaryBestBuyError(error) || attempt === 2) throw error;
      await wait(retryDelay(error, attempt));
    }
  }
  throw lastError;
}

async function checkPublicBestBuyPage(value, {force = false} = {}) {
  const url = validBestBuyPublicUrl(value);
  if (!url) throw new Error("Enter a public Best Buy product-page link");
  const previous = bestBuyPublicStates.get(url);
  const now = Date.now();
  if (!force && previous?.cacheUntil && previous.cacheUntil > now) {
    return {...previous, cached: true};
  }
  let html;
  try {
    html = await fetchBestBuyPublicPage(url);
  } catch (error) {
    const browserObservation = bestBuyBrowserStates.get(url);
    if (browserObservation) {
      return {...browserObservation, browserObserved: true};
    }
    throw error;
  }
  const pageText = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
  const availability = /pickup today|ready for pickup|pick up today/.test(pageText) ? "pickup_available" : /sold out|unavailable for pickup|pickup not available/.test(pageText) ? "pickup_unavailable" : /add to cart/.test(pageText) ? "online_available" : "unknown";
  const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "Best Buy product").trim();
  const metaContent = property => html.match(new RegExp("<meta[^>]+(?:property|name)=[\"']" + property + "[\"'][^>]+content=[\"']([^\"']+)", "i"))?.[1] || html.match(new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"']" + property + "[\"']", "i"))?.[1] || null;
  const image = metaContent("og:image") || null;
  const rawPrice = metaContent("product:price:amount") || html.match(/itemprop=[\"']price[\"'][^>]+content=[\"']([0-9]+(?:\.[0-9]{1,2})?)/i)?.[1] || html.match(/\"price\"\s*:\s*\"?([0-9]+(?:\.[0-9]{1,2})?)/i)?.[1] || null;
  const price = Number(rawPrice);
  const changed = previous && previous.availability !== availability;
  const result = {
    url,
    title,
    image,
    price: Number.isFinite(price) ? price : null,
    availability,
    changed: Boolean(changed),
    checkedAt: new Date().toISOString(),
    cacheUntil: now + bestBuyPublicCacheMinutes * 60 * 1000,
    cached: false
  };
  bestBuyPublicStates.set(url, result);
  if (changed && availability === "pickup_available") push.broadcast({title: "Best Buy — Public pickup signal", body: `${title} now shows pickup availability.`, url, tag: `bestbuy-${Buffer.from(url).toString("base64url").slice(0, 36)}`}).catch(() => {});
  return result;
}

async function runBestBuyPublicWatch() {
  if (bestBuyPublicScheduleState.running || !bestBuyPublicWatchUrls.length) return;
  bestBuyPublicScheduleState.running = true;
  bestBuyPublicScheduleState.lastRun = new Date().toISOString();
  try {
    for (const url of bestBuyPublicWatchUrls) {
      await checkPublicBestBuyPage(url, {force: true});
    }
    bestBuyPublicScheduleState.lastSuccess = new Date().toISOString();
    bestBuyPublicScheduleState.lastError = null;
  } catch (error) {
    bestBuyPublicScheduleState.lastError = error.message;
    console.warn("Best Buy public watch failed:", error.message);
  } finally {
    bestBuyPublicScheduleState.running = false;
  }
}


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

app.use(
  express.json()
);

app.get("/api/retail/online", (req,res) => {
  try {res.json({ok:true,...retailOnline.snapshot(String(req.query.retailer || ""))});}
  catch(error) {res.status(400).json({ok:false,error:error.message});}
});
app.get("/api/retail/product-check", async (req,res) => {
  try {res.json({ok:true,item:await retailOnline.check(String(req.query.retailer || ""),String(req.query.url || ""))});}
  catch(error) {res.status(503).json({ok:false,error:error.message});}
});
app.get("/api/retail/locations", async(req,res)=>{
  try{res.json({ok:true,...await nearbyRetail.nearby(String(req.query.retailer || ""),String(req.query.zip || ""))});}
  catch(error){res.status(503).json({ok:false,error:error.message});}
});


/* ========================================
   RAFFLE STATE
======================================== */

let raffleScanRunning =
  false;

let raffleBaselineReady =
  false;

const raffleBaseline =
  new Map();

let raffleState = {
  ok: false,
  running: false,
  lastChecked: null,
  lastSuccess: null,
  error: null,
  count: 0,
  items: []
};


function raffleKey(item) {
  return String(
    item?.walmartItemId ||
    item?.url ||
    item?.productId ||
    item?.name ||
    ""
  );
}


function mergeRaffles(
  axessoItems,
  publicItems
) {
  const merged =
    new Map();

  for (
    const item of
    Array.isArray(axessoItems)
      ? axessoItems
      : []
  ) {
    const key =
      raffleKey(item);

    if (key) {
      merged.set(
        key,
        item
      );
    }
  }

  for (
    const item of
    Array.isArray(publicItems)
      ? publicItems
      : []
  ) {
    const key =
      raffleKey(item);

    if (!key) {
      continue;
    }

    const previous =
      merged.get(key) ||
      {};

    merged.set(
      key,
      {
        ...previous,
        ...item,

        image:
          item.image ||
          previous.image ||
          null,

        url:
          item.url ||
          previous.url ||
          null,

        price:
          item.price ??
          previous.price ??
          null,

        startsAt:
          item.startsAt ||
          previous.startsAt ||
          null
      }
    );
  }

  const order = {
    live: 0,
    upcoming: 1,
    detected: 2,
    closed: 3
  };

  return Array
    .from(
      merged.values()
    )
    .filter(
      item =>
        item?.raffle === true &&
        String(item?.name || "").trim()
    )
    .sort(
      (a,b) =>
        (
          order[
            a.raffleStatus
          ] ?? 9
        ) -
        (
          order[
            b.raffleStatus
          ] ?? 9
        )
    );
}


/* ========================================
   RAFFLE ALERTS
======================================== */

async function processRaffleAlerts(
  items
) {
  if (
    !Array.isArray(items)
  ) {
    return;
  }

  if (
    !raffleBaselineReady
  ) {
    raffleBaseline.clear();

    for (
      const item of
      items
    ) {
      const key =
        raffleKey(item);

      if (!key) {
        continue;
      }

      raffleBaseline.set(
        key,
        item.raffleStatus ||
        item.status ||
        "detected"
      );
    }

    raffleBaselineReady =
      true;

    console.log(
      `Walmart raffle baseline established with ${raffleBaseline.size} item(s).`
    );

    return;
  }

  for (
    const item of
    items
  ) {
    const key =
      raffleKey(item);

    if (!key) {
      continue;
    }

    const current =
      item.raffleStatus ||
      item.status ||
      "detected";

    const previous =
      raffleBaseline.get(
        key
      );

    if (
      previous === undefined &&
      (
        current === "detected" ||
        current === "upcoming"
      )
    ) {
      try {
        await push.broadcast({
          title:
            "⚡ Walmart Raffle Detected",

          body:
            item.startsAt
              ? `${item.name} has been found for an upcoming Walmart drawing. Starts ${new Date(
                  item.startsAt
                ).toLocaleString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short"
                })}.`
              : `${item.name} has been found for an upcoming Walmart drawing. Walmart has not posted its join day and time yet.`,

          url:
            item.url ||
            "https://www.walmart.com/shop/collectibles/draw",

          icon:
            item.image ||
            "https://pokemon-live-backend.onrender.com/app-icon.png",

          badge:
            "https://pokemon-live-backend.onrender.com/app-icon.png",

          tag:
            `walmart-raffle-warning-${
              item.walmartItemId ||
              item.productId ||
              key
            }`
        });

      } catch (error) {
        console.error(
          "Walmart raffle pre-warning failed:",
          error.message
        );
      }
    }

    if (
      previous !== undefined &&
      previous !== "live" &&
      current === "live"
    ) {
      try {
        await push.broadcast({
          title:
            "🔥 WALMART RAFFLE LIVE!",

          body:
            `${item.name} drawing is LIVE. Tap to open Walmart now.`,

          url:
            item.url ||
            "https://www.walmart.com/shop/collectibles/draw",

          icon:
            item.image ||
            "https://pokemon-live-backend.onrender.com/app-icon.png",

          badge:
            "https://pokemon-live-backend.onrender.com/app-icon.png",

          tag:
            `walmart-raffle-live-${
              item.walmartItemId ||
              item.productId ||
              key
            }`
        });

      } catch (error) {
        console.error(
          "Walmart raffle LIVE alert failed:",
          error.message
        );
      }
    }

    raffleBaseline.set(
      key,
      current
    );
  }
}


/* ========================================
   RAFFLE SCAN
======================================== */

async function runRaffleScan() {
  if (
    raffleScanRunning
  ) {
    return {
      ...raffleState,

      skipped: true,

      reason:
        "Raffle scan already running"
    };
  }

  raffleScanRunning =
    true;

  raffleState = {
    ...raffleState,

    running: true,

    lastChecked:
      new Date()
        .toISOString()
  };

  let publicResult = null;
  let axessoItems = [];
  const errorMessages = [];

  try {
    try {
      publicResult =
        await walmartRaffles
          .scan();

      if (
        publicResult?.error
      ) {
        errorMessages.push(
          publicResult.error
        );
      }

    } catch (error) {
      errorMessages.push(
        error.message
      );
    }

    try {
      axessoItems =
        await walmart
          .refreshRaffles();

    } catch (error) {
      errorMessages.push(
        error.message
      );
    }

    /*
      The public Walmart drawing page is the source of truth for
      what belongs in the current raffle tab. Its result replaces
      the prior set on every successful scan, so completed draws
      disappear and the tab is ready for the next week.

      Axesso remains available as a fallback only when the public
      draw page could not be read for this scan.
    */
    const items =
      publicResult?.ok
        ? mergeRaffles(
            [],
            publicResult.items || []
          )
        : mergeRaffles(
            axessoItems,
            []
          );

    raffleState = {
      ok:
        Boolean(
          publicResult?.ok ||
          Array.isArray(
            axessoItems
          )
        ),

      running: false,

      lastChecked:
        new Date()
          .toISOString(),

      lastSuccess:
        items.length ||
        publicResult?.ok
          ? new Date()
              .toISOString()
          : raffleState.lastSuccess,

      error:
        errorMessages.length
          ? errorMessages.join(
              " | "
            )
          : null,

      count:
        items.length,

      items
    };

    await processRaffleAlerts(
      items
    );

    return {
      ...raffleState
    };

  } catch (error) {
    raffleState = {
      ...raffleState,

      ok: false,

      running: false,

      lastChecked:
        new Date()
          .toISOString(),

      error:
        error.message
    };

    return {
      ...raffleState
    };

  } finally {
    raffleScanRunning =
      false;
  }
}


/* ========================================
   MAIN WALMART SCAN
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

    } catch (error) {
      discovery30th = {
        ok: false,
        error: error.message
      };
    }

    let raffles =
      null;

    try {
      raffles =
        await runRaffleScan();

    } catch (error) {
      console.error(
        "Walmart raffle refresh failed:",
        error.message
      );
    }

    return {
      ...catalogResult,
      discovery30th,
      raffles
    };

  } catch (error) {
    console.error(
      "Walmart catalog scan failed:",
      error
    );

    throw error;
  }
}

async function runGtCollectiblesWatch() {
  return walmart30thDiscovery.runDiscovery({
    /* A single broad query keeps this lightweight between Wednesday scans. */
    searchTerms: ["Pokemon TCG"],
    approvedMarketplaceOnly: true
  });
}


/* ========================================
   WALMART SCHEDULER
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
    req.get(
      "x-monitor-token"
    ) ||
    req.body?.token ||
    "";

  return (
    supplied ===
    manualScanToken
  );
}


function hasValidPokemonCenterSensorToken(req) {
  if (!pokemonCenterSensorToken) {
    return false;
  }

  const auth =
    String(
      req.get(
        "authorization"
      ) || ""
    );

  const bearer =
    auth
      .toLowerCase()
      .startsWith(
        "bearer "
      )
      ? auth
          .slice(7)
          .trim()
      : "";

  const supplied =
    req.get(
      "x-pokemon-center-sensor-token"
    ) ||
    bearer ||
    req.body?.token ||
    "";

  return supplied === pokemonCenterSensorToken;
}


function hasValidWakeToken(req) {
  if (!walmartWakeToken) {
    return false;
  }

  const auth =
    String(
      req.get(
        "authorization"
      ) || ""
    );

  const bearer =
    auth
      .toLowerCase()
      .startsWith(
        "bearer "
      )
      ? auth
          .slice(7)
          .trim()
      : "";

  const supplied =
    req.get(
      "x-wake-token"
    ) ||
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
  (req,res) => {
    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate"
    );

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);


app.get(
  "/hero.jpg",
  (req,res) => {
    res.sendFile(
      path.join(
        __dirname,
        "hero.jpg"
      )
    );
  }
);


function sendAppIcon(res) {
  res.setHeader(
    "Cache-Control",
    "no-cache, no-store, must-revalidate"
  );

  res.type(
    "image/png"
  );

  res.sendFile(
    path.join(
      __dirname,
      "app-icon.png"
    )
  );
}


app.get(
  "/app-icon.png",
  (req,res) =>
    sendAppIcon(res)
);


app.get(
  "/apple-touch-icon.png",
  (req,res) =>
    sendAppIcon(res)
);


app.get(
  "/apple-touch-icon-precomposed.png",
  (req,res) =>
    sendAppIcon(res)
);


app.get(
  "/apple-touch-icon-180x180.png",
  (req,res) =>
    sendAppIcon(res)
);


app.get(
  "/apple-touch-icon-152x152.png",
  (req,res) =>
    sendAppIcon(res)
);


app.get(
  "/sw.js",
  (req,res) => {
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


app.get(
  "/manifest.webmanifest",
  (req,res) => {
    res.type(
      "application/manifest+json"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate"
    );

    res.json({
      id: "/",

      name:
        "Pokémon Restock Monitor",

      short_name:
        "Pokémon Monitor",

      description:
        "Live Pokémon inventory and activity monitor",

      start_url: "/",

      scope: "/",

      display:
        "standalone",

      orientation:
        "portrait-primary",

      background_color:
        "#020711",

      theme_color:
        "#020711",

      icons: [
        {
          src:
            "/apple-touch-icon.png",

          sizes:
            "512x512",

          type:
            "image/png",

          purpose:
            "any"
        }
      ]
    });
  }
);


/* ========================================
   BACKEND STATUS
======================================== */

app.get(
  "/api/backend",
  (req,res) => {
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

      scheduledWalmartScanning:
        walmartScheduler
          .getStatus(),

      walmartProvider:
        walmart
          .getProviderInfo?.() ||
        null,

      walmartRaffles:
        raffleState,

      rafflePollMinutes,

      walmart30thDiscovery:
        walmart30thDiscovery
          .getState(),

      pokemonCenter:
        pokemonCenter
          .getState(),

      pokemonCenterConfig:
        pokemonCenter
          .getConfig(),

      bestBuyPublicWatch:
        bestBuyPublicStatus(),

      marketplaceEndpoint:
        "/api/marketplace",

      providers:
        multiStore
          .getProviderStates(),

      push:
        push
          .getPushStatus()
    });
  }
);


app.get(
  "/health",
  (req,res) => {
    res.json({
      ok: true,

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

      walmartRaffles:
        raffleState,

      rafflePollMinutes,

      walmart30thDiscovery:
        walmart30thDiscovery
          .getState(),

      pokemonCenter:
        pokemonCenter
          .getState(),

      bestBuyPublicWatch:
        bestBuyPublicStatus(),

      providers:
        multiStore
          .getProviderStates(),

      push:
        push
          .getPushStatus()
    });
  }
);


/* ========================================
   PUSH
======================================== */

app.get(
  "/api/push/public-key",
  (req,res) => {
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

    res.json({
      ok: true,
      publicKey
    });
  }
);


app.get(
  "/api/push/status",
  (req,res) => {
    res.json(
      push.getPushStatus()
    );
  }
);


app.get(
  "/api/push/test",
  async (req,res) => {
    try {
      const result =
        await push
          .sendTestAlert();

      res.json({
        ok: true,

        test:
          "web-push",

        walmartApiCalled:
          false,

        ...result
      });

    } catch (error) {
      res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


app.get(
  "/api/push/test/pokemon-center-queue",
  async (req,res) => {
    try {
      const result =
        await push
          .sendPokemonCenterQueueTestAlert();

      res.json({
        ok: true,

        test:
          "pokemon-center-queue-push",

        simulated:
          true,

        walmartApiCalled:
          false,

        ...result
      });
    } catch (error) {
      res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


app.post(
  "/api/push/subscribe",
  async (req,res) => {
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
      res
        .status(400)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


app.post(
  "/api/push/unsubscribe",
  async (req,res) => {
    try {
      const endpoint =
        req.body?.endpoint;

      if (!endpoint) {
        return res
          .status(400)
          .json({
            ok: false,

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
      res
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
   SCANNER STATUS
======================================== */

app.get(
  "/api/scanner",
  (req,res) => {
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
          .getStatus(),

      walmartRaffles:
        raffleState,

      pokemonCenter:
        pokemonCenter
          .getState()
    });
  }
);


/* ========================================
   APP STATUS
======================================== */

app.get(
  "/api/status",
  (req,res) => {
    const data =
      getLatest();

    res.json({
      ok: true,

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

      walmartDiscoveredDeals:
        walmart
          .getDiscoveredDeals?.() ||
        [],

      upcoming:
        walmart
          .getUpcoming?.() ||
        [],

      walmartRaffles:
        raffleState,

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

      pokemonCenter:
        pokemonCenter
          .getState(),

      push:
        push
          .getPushStatus()
    });
  }
);


/* ========================================
   PROVIDERS
======================================== */

app.get(
  "/api/providers",
  (req,res) => {
    const providerStates =
      multiStore
        .getProviderStates();

    const latest =
      getLatest();

    const fixedProviders =
      providerStates.map(
        provider => {
          if (
            provider.retailer !==
            "walmart"
          ) {
            return provider;
          }

          const walmartItems =
            Array.isArray(
              latest.items
            )
              ? latest.items.filter(
                  item =>
                    item.retailer ===
                    "walmart"
                )
              : [];

          const discovered =
            walmart
              .getDiscoveredDeals?.() ||
            [];

          return {
            ...provider,

            configured:
              true,

            itemCount:
              walmartItems.length +
              discovered.length,

            lastRun:
              latest.lastRun ||
              provider.lastRun
          };
        }
      );

    const pc =
      pokemonCenter
        .getState();

    fixedProviders.push({
      retailer:
        "pokemoncenter",

      label:
        "Pokémon Center",

      configured:
        true,

      running:
        pc.running,

      itemCount:
        pc.trackedProductCount,

      lastRun:
        pc.lastChecked,

      priority:
        "highest"
    });

    res.json({
      ok: true,

      count:
        fixedProviders.length,

      providers:
        fixedProviders
    });
  }
);


/* ========================================
   PRODUCTS
======================================== */

app.get(
  "/api/bestbuy/search",
  async (req,res) => {
    try {
      const query =
        String(
          req.query.q || ""
        )
          .trim()
          .slice(0, 100);

      const items =
        await multiStore
          .searchBestBuyProducts(
            query
          );

      res.json({
        ok: true,
        query,
        count: items.length,
        items
      });
    } catch (error) {
      res.status(503).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.get(
  "/api/bestbuy/public-check",
  async (req,res) => {
    try {
      const result = await checkPublicBestBuyPage(
        req.query.url,
        {force: String(req.query.force || "").toLowerCase() === "true"}
      );
      res.json({ok: true, source: "public_product_page", ...result});
    } catch (error) {
      res.status(400).json({ok: false, error: error.message});
    }
  }
);

app.post(
  "/api/bestbuy/browser-observation",
  (req,res) => {
    if (!pokemonCenterSensorToken) {
      return pokemonCenterSensorUnavailable(res);
    }

    if (!hasValidPokemonCenterSensorToken(req)) {
      return pokemonCenterSensorUnauthorized(res);
    }

    const url = validBestBuyPublicUrl(req.body?.url);
    const availability = String(req.body?.availability || "unknown");
    const allowedAvailability = new Set([
      "pickup_available",
      "pickup_unavailable",
      "online_available",
      "unknown"
    ]);

    if (!url || !allowedAvailability.has(availability)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid public Best Buy browser observation"
      });
    }

    const observedPrice = Number(req.body?.price);
    const observedImage = String(req.body?.image || "").trim();
    const observedSeller = String(req.body?.seller || "").trim();
    const result = {
      url,
      title: String(req.body?.title || "Best Buy product").slice(0, 240),
      image: /^https:\/\//i.test(observedImage) ? observedImage.slice(0, 1000) : null,
      price: req.body?.price != null && req.body?.price !== "" && Number.isFinite(observedPrice) && observedPrice >= 0 ? observedPrice : null,
      seller: observedSeller ? observedSeller.slice(0, 160) : null,
      availability,
      observedAt: new Date().toISOString(),
      source: "browser_product_page"
    };

    bestBuyBrowserStates.set(url, result);
    res.json({ok: true, ...result});
  }
);

app.post(
  "/api/sams/browser-observation",
  (req,res) => {
    if (!pokemonCenterSensorToken) return pokemonCenterSensorUnavailable(res);
    if (!hasValidPokemonCenterSensorToken(req)) return pokemonCenterSensorUnauthorized(res);

    let url;
    try {
      const parsed = new URL(String(req.body?.url || ""));
      if (parsed.protocol !== "https:" || parsed.hostname !== "www.samsclub.com" || !parsed.pathname.startsWith("/ip/")) throw new Error("invalid");
      parsed.search = "";
      parsed.hash = "";
      url = parsed.href;
    } catch {
      return res.status(400).json({ok:false,error:"Invalid Sam's Club browser observation"});
    }

    const availability = String(req.body?.availability || "unknown");
    if (!new Set(["available","unavailable","unknown","preorder"]).has(availability)) {
      return res.status(400).json({ok:false,error:"Invalid Sam's Club availability"});
    }

    const observedPrice = Number(req.body?.price);
    const observedImage = String(req.body?.image || "").trim();
    const result = {
      url,
      title: String(req.body?.title || "Sam's Club product").slice(0,240),
      image: /^https:\/\//i.test(observedImage) ? observedImage.slice(0,1000) : null,
      price: req.body?.price != null && req.body?.price !== "" && Number.isFinite(observedPrice) && observedPrice >= 0 ? observedPrice : null,
      itemNumber: String(req.body?.itemNumber || "").replace(/\D/g,"").slice(0,30) || null,
      availability,
      observedAt: new Date().toISOString(),
      source: "browser_product_page"
    };

    result.channel = "online";
    if (!retailOnline.isTcg(result.title)) return res.json({ok:true,ignored:true});
    const previous = samsBrowserStates.get(url);
    samsBrowserStates.set(url,result);

    if ((!previous || previous.availability !== availability) && ["available","preorder"].includes(availability)) {
      push.broadcast({
        title: "Sam's Club — Online TCG alert",
        body: result.title + (availability === "preorder" ? " is available for pre-order." : " now appears available online."),
        url,
        tag: "sams-" + Buffer.from(url).toString("base64url").slice(0,36)
      }).catch(() => {});
    }

    res.json({ok:true,...result});
  }
);

app.get(
  "/api/sams/browser-observations",
  (req,res) => {
    res.json({
      ok:true,
      count:samsBrowserStates.size,
      items:Array.from(samsBrowserStates.values())
    });
  }
);

app.post(
  "/api/costco/browser-observation",
  (req,res) => {
    if (!pokemonCenterSensorToken) return pokemonCenterSensorUnavailable(res);
    if (!hasValidPokemonCenterSensorToken(req)) return pokemonCenterSensorUnauthorized(res);

    let url;
    try {
      const parsed = new URL(String(req.body?.url || ""));
      if (parsed.protocol !== "https:" || parsed.hostname !== "www.costco.com") throw new Error("invalid");
      parsed.search = "";
      parsed.hash = "";
      url = parsed.href;
    } catch {
      return res.status(400).json({ok:false,error:"Invalid public Costco browser observation"});
    }

    const availability = String(req.body?.availability || "unknown");
    if (!new Set(["available","unavailable","unknown","preorder"]).has(availability)) {
      return res.status(400).json({ok:false,error:"Invalid Costco availability"});
    }

    const observedPrice = Number(req.body?.price);
    const observedImage = String(req.body?.image || "").trim();
    const result = {
      url,
      title: String(req.body?.title || "Costco product").slice(0,240),
      image: /^https:\/\//i.test(observedImage) ? observedImage.slice(0,1000) : null,
      price: req.body?.price != null && req.body?.price !== "" && Number.isFinite(observedPrice) && observedPrice >= 0 ? observedPrice : null,
      itemNumber: String(req.body?.itemNumber || "").replace(/\D/g,"").slice(0,30) || null,
      availability,
      observedAt: new Date().toISOString(),
      channel: "online",
      source: "browser_product_page"
    };

    if (!retailOnline.isTcg(result.title)) return res.json({ok:true,ignored:true});
    const previous = costcoBrowserStates.get(url);
    costcoBrowserStates.set(url,result);

    if ((!previous || previous.availability !== availability) && ["available","preorder"].includes(availability)) {
      push.broadcast({
        title: "Costco — Online TCG alert",
        body: result.title + (availability === "preorder" ? " is available for pre-order." : " now appears available online."),
        url,
        tag: "costco-" + Buffer.from(url).toString("base64url").slice(0,36)
      }).catch(() => {});
    }

    res.json({ok:true,...result});
  }
);

app.post("/api/ccn/inventory-report", async (req,res) => {
  if (!pokemonCenterSensorToken) return pokemonCenterSensorUnavailable(res);
  if (!hasValidPokemonCenterSensorToken(req)) return pokemonCenterSensorUnauthorized(res);
  try {res.json({ok:true,report:await ccnInventory.save(req.body)});}
  catch(error){res.status(400).json({ok:false,error:error.message});}
});
app.get("/ccn-import", (req,res)=>res.sendFile(path.join(__dirname,"ccn-import.html")));
app.post("/api/ccn/news-report",async(req,res)=>{
  if (!pokemonCenterSensorToken) return pokemonCenterSensorUnavailable(res);
  if (!hasValidPokemonCenterSensorToken(req)) return pokemonCenterSensorUnauthorized(res);
  try{res.json({ok:true,report:await ccnInventory.saveNews(req.body)});}catch(error){res.status(400).json({ok:false,error:error.message});}
});
app.get("/api/ccn/news",async(req,res)=>{
  if (!pokemonCenterSensorToken) return pokemonCenterSensorUnavailable(res);
  if (!hasValidPokemonCenterSensorToken(req)) return pokemonCenterSensorUnauthorized(res);
  try{res.json({ok:true,posts:await ccnInventory.news()});}catch(error){res.status(503).json({ok:false,error:"CCN news storage unavailable"});}
});
app.get("/api/ccn/inventory-reports", async (req,res) => {
  if (!pokemonCenterSensorToken) return pokemonCenterSensorUnavailable(res);
  if (!hasValidPokemonCenterSensorToken(req)) return pokemonCenterSensorUnauthorized(res);
  if (!["costco","sams","bestbuy"].includes(req.query.retailer) || !/^\d{5}$/.test(req.query.zip || "")) return res.status(400).json({ok:false,error:"Choose retailer and ZIP"});
  try {res.json({ok:true,reports:await ccnInventory.list(req.query.retailer,req.query.zip),nextCheckAt:Math.floor(Date.now()/3600000)*3600000+3600000});}
  catch(error){res.status(503).json({ok:false,error:"CCN report storage unavailable"});}
});
app.get(
  "/api/costco/browser-observations",
  (req,res) => {
    res.json({
      ok:true,
      count:costcoBrowserStates.size,
      items:Array.from(costcoBrowserStates.values())
    });
  }
);

app.get(
  "/api/bestbuy/store-check",
  async (req,res) => {
    try {
      const sku =
        String(
          req.query.sku || ""
        )
          .trim()
          .slice(0, 20);

      const result =
        await multiStore
          .checkBestBuySku(
            sku
          );

      res.json({
        ok: true,
        sku,
        ...result
      });
    } catch (error) {
      res.status(503).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.get(
  "/api/warehouse/store-check",
  async (req,res) => {
    try {
      const retailer = String(req.query.retailer || "").toLowerCase();
      const product = String(req.query.product || "").trim().slice(0, 240);
      const postalCode = String(req.query.zip || "").trim();
      if (!/[a-z0-9]/i.test(product)) throw new Error("Choose a Pokémon TCG product first");
      if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) throw new Error("Enter a valid ZIP code");
      const result = await multiStore.searchWarehouseInventory(retailer, {
        query: product,
        postalCode,
        radiusMiles: 75
      });
      res.json({ ok: true, retailer, product, postalCode, radiusMiles: 75, ...result });
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message });
    }
  }
);

app.get(
  "/api/products",
  (req,res) => {
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
        "costco",
        "pokemoncenter"
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
          ok: false,

          error:
            "Unsupported retailer"
        });
    }

    if (
      retailer ===
      "pokemoncenter"
    ) {
      const items =
        pokemonCenter
          .getProducts();

      return res.json({
        ok: true,

        retailer,

        count:
          items.length,

        items
      });
    }

    let items = [];

    if (
      retailer ===
      "walmart"
    ) {
      const latest =
        getLatest();

      const scannedItems =
        Array.isArray(
          latest.items
        )
          ? latest.items.filter(
              item =>
                item.retailer ===
                "walmart"
            )
          : [];

      const discoveredDeals =
        walmart
          .getDiscoveredDeals?.() ||
        [];

      const unique =
        new Map();

      for (
        const item of
        [
          ...scannedItems,
          ...discoveredDeals
        ]
      ) {
        if (
          walmart
            .isOfficialSealedPokemonProduct?.(
              item.name || ""
            ) === false
        ) {
          continue;
        }

        if (
          item.autoDiscovered === true &&
          item.withinPriceRule !== true
        ) {
          continue;
        }

        const key =
          String(
            item.walmartItemId ||
            item.productId ||
            item.url ||
            [
              item.name,
              item.seller,
              item.price
            ].join("|")
          );

        const existing =
          unique.get(
            key
          );

        if (
          !existing ||
          (
            item.displayEligible === true &&
            existing.displayEligible !== true
          )
        ) {
          unique.set(
            key,
            item
          );
        }
      }

      items =
        Array
          .from(
            unique.values()
          )
          .sort(
            (a,b) => {
              const aLive =
                a.inStock === true
                  ? 0
                  : 1;

              const bLive =
                b.inStock === true
                  ? 0
                  : 1;

              if (
                aLive !==
                bLive
              ) {
                return (
                  aLive -
                  bLive
                );
              }

              const ap =
                Number(
                  a.price
                );

              const bp =
                Number(
                  b.price
                );

              if (
                Number.isFinite(ap) &&
                Number.isFinite(bp)
              ) {
                return (
                  ap -
                  bp
                );
              }

              return 0;
            }
          );

    } else {
      items =
        multiStore
          .getProducts(
            retailer
          );
    }

    res.json({
      ok: true,

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
  (req,res) => {
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
      ok: true,

      retailer,

      count:
        items.length,

      items
    });
  }
);


/* ========================================
   POKÉMON CENTER
======================================== */

app.get(
  "/api/pokemon-center/status",
  (req,res) => {
    res.json({
      ok: true,

      state:
        pokemonCenter
          .getState(),

      config:
        pokemonCenter
          .getConfig()
    });
  }
);


app.get(
  "/api/pokemon-center/products",
  (req,res) => {
    const items =
      pokemonCenter
        .getProducts();

    res.json({
      ok: true,

      count:
        items.length,

      items
    });
  }
);


app.get(
  "/api/pokemon-center/activity",
  (req,res) => {
    const items =
      pokemonCenter
        .getActivity();

    res.json({
      ok: true,

      count:
        items.length,

      items
    });
  }
);


app.post(
  "/api/pokemon-center/scan",
  async (req,res) => {
    if (!manualScanToken) {
      return res
        .status(503)
        .json({
          ok: false,

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
          ok: false,

          error:
            "Invalid manual scan token"
        });
    }

    const result =
      await pokemonCenter
        .scan();

    res.json(
      result
    );
  }
);


const pokemonCenterSensorSignalTypes =
  new Set([
    "PAGE_CHANGE",
    "PRODUCT_DISCOVERED",
    "PRODUCT_URL_CHANGE",
    "SKU_CHANGE",
    "IMAGE_CHANGE",
    "PRICE_CHANGE",
    "QUANTITY_CHANGE",
    "AVAILABILITY_CHANGE",
    "QUEUE_ACTIVE"
  ]);


function isPokemonTcgText(value) {
  return /\bpok[eé]mon\s*tcg\b|trading\s*card\s*game|\belite trainer box\b|\bbooster\s+(?:box|bundle|pack|display)\b|\bultra[- ]premium collection\b|\bpremium collection\b|\b(?:ex|v|vmax|v-?union|gx)\s+(?:box|collection)\b|\b(?:three|3)[- ]pack blister\b|\bsingle[- ]pack blister\b|\bleague battle deck\b|\bbattle deck\b|\bbuild\s*(?:&|and)\s*battle(?:\s+(?:box|stadium))?\b|\bpromo\s+card\b|\bcollector(?:'s)?\s+chest\b|\bmini\s*tins?\b|\btrainer\s+kit\b|\btheme\s+deck\b/i.test(
    String(value || "")
  );
}


function isPokemonTcgSignal(signal = {}) {
  return signal.tcgRelevant === true ||
    isPokemonTcgText([
      signal.name,
      signal.productName,
      signal.url,
      signal.detail,
      signal.alertText
    ].join(" "));
}


function pokemonCenterWatchTodayHint(value) {
  const text = String(value || "").toLowerCase();

  return (
    /pokemon\s*center|pokemoncenter\.com|\bqueue\b/.test(text) &&
    /\btoday\b|\btonight\b|\bthis\s+(?:morning|afternoon|evening)\b/.test(text) &&
    /\brestock\b|\bdrop\b|\brelease\b|\bqueue\b|\bgoing\s+live\b|\bback\s+in\s+stock\b/.test(text)
  );
}


function pokemonCenterSensorUnavailable(res) {
  return res
    .status(503)
    .json({
      ok: false,
      error:
        "Pokémon Center sensor ingest is disabled until POKEMON_CENTER_SENSOR_TOKEN is configured"
    });
}


function pokemonCenterSensorUnauthorized(res) {
  return res
    .status(401)
    .json({
      ok: false,
      error: "Invalid Pokémon Center sensor token"
    });
}


app.post(
  "/api/pokemon-center/sensor/heartbeat",
  async (req,res) => {
    if (!pokemonCenterSensorToken) {
      return pokemonCenterSensorUnavailable(res);
    }

    if (!hasValidPokemonCenterSensorToken(req)) {
      return pokemonCenterSensorUnauthorized(res);
    }

    const result =
      await pokemonCenter
        .heartbeat({
          sensorId: req.body?.sensorId,
          version: req.body?.version,
          userAgent: req.body?.userAgent
        });

    res.json(result);
  }
);


app.post(
  "/api/pokemon-center/sensor/signal",
  async (req,res) => {
    if (!pokemonCenterSensorToken) {
      return pokemonCenterSensorUnavailable(res);
    }

    if (!hasValidPokemonCenterSensorToken(req)) {
      return pokemonCenterSensorUnauthorized(res);
    }

    const type =
      String(req.body?.type || "")
        .trim()
        .toUpperCase();

    if (!pokemonCenterSensorSignalTypes.has(type)) {
      return res
        .status(400)
        .json({
          ok: false,
          error: "Unsupported Pokémon Center sensor signal type"
        });
    }

    if (!isPokemonTcgSignal(req.body)) {
      return res.status(202).json({
        ok: true,
        ignored: true,
        reason: "Only Pokémon TCG signals are monitored"
      });
    }

    const result =
      await pokemonCenter
        .ingestSignal({
          ...req.body,
          type,
          source: "browser-sensor"
        });

    res.json(result);
  }
);


app.post(
  "/api/pokemon-center/sensor/third-party-alert",
  async (req,res) => {
    if (!pokemonCenterSensorToken) {
      return pokemonCenterSensorUnavailable(res);
    }

    if (!hasValidPokemonCenterSensorToken(req)) {
      return pokemonCenterSensorUnauthorized(res);
    }

    const url = String(req.body?.url || "").trim();
    const alertText = String(req.body?.alertText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 800);

    if (
      !/^https:\/\/x\.com\/PokemonRestocks\/status\/\d+(?:[/?#].*)?$/i.test(url) ||
      !alertText
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error: "Invalid public PokémonRestocks alert"
        });
    }

    if (!isPokemonTcgSignal(req.body)) {
      return res.status(202).json({
        ok: true,
        ignored: true,
        reason: "Only Pokémon TCG alerts are monitored"
      });
    }

    const result = await pokemonCenter.ingestSignal({
      type: "THIRD_PARTY_ALERT",
      source: "pokemon-restocks-x",
      name: "PokémonRestocks public alert",
      url,
      queueReported: req.body?.queueReported === true,
      pokemonCenterRelated: req.body?.pokemonCenterRelated === true,
      tcgRelevant: true,
      thirdParty: true,
      publishedAt: req.body?.publishedAt || null,
      watchToday: pokemonCenterWatchTodayHint(alertText),
      detail: alertText
    });

    res.json(result);
  }
);


/* ========================================
   WALMART
======================================== */

app.get(
  "/api/walmart/schedule",
  (req,res) => {
    res.json({
      ok: true,

      schedule:
        walmartScheduler
          .getStatus()
    });
  }
);


app.get(
  "/api/walmart/provider",
  (req,res) => {
    res.json({
      ok: true,

      provider:
        walmart
          .getProviderInfo?.() ||
        null
    });
  }
);


app.get(
  "/api/walmart/deals",
  (req,res) => {
    const items =
      (
        walmart
          .getDiscoveredDeals?.() ||
        []
      )
        .filter(
          item =>
            item.displayEligible === true &&
            item.withinPriceRule === true &&
            walmart
              .isOfficialSealedPokemonProduct?.(
                item.name || ""
              ) !== false
        );

    res.json({
      ok: true,

      count:
        items.length,

      items
    });
  }
);


app.get(
  "/api/walmart/raffles",
  (req,res) => {
    res.json({
      ...raffleState,

      pollMinutes:
        rafflePollMinutes,

      drawPage:
        walmartRaffles
          .DRAW_URL
    });
  }
);


app.post(
  "/api/walmart/raffles/scan",
  async (req,res) => {
    if (!manualScanToken) {
      return res
        .status(503)
        .json({
          ok: false,

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
          ok: false,

          error:
            "Invalid scan token"
        });
    }

    res.json(
      await runRaffleScan()
    );
  }
);


app.get(
  "/api/walmart/upcoming",
  (req,res) => {
    const items =
      walmart
        .getUpcoming?.() ||
      [];

    res.json({
      ok: true,

      count:
        items.length,

      items
    });
  }
);


app.get(
  "/api/walmart/watchlist",
  (req,res) => {
    const merged =
      walmartWatchlist
        .mergeUpcomingWithWatchlist(
          walmart
            .getUpcoming?.() ||
          []
        );

    res.json({
      ok: true,

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


app.get(
  "/api/walmart/30th",
  (req,res) => {
    res.json({
      ok: true,

      ...walmart30thDiscovery
        .getState()
    });
  }
);


app.get(
  "/api/walmart/health",
  (req,res) => {
    res.json({
      ok: true,

      provider:
        walmart
          .getProviderInfo?.() ||
        null,

      scanner:
        getScannerState(),

      schedule:
        walmartScheduler
          .getStatus(),

      raffles:
        raffleState,

      rafflePollMinutes,

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


app.all(
  "/api/walmart/wake",
  async (req,res) => {
    if (!walmartWakeToken) {
      return res
        .status(503)
        .json({
          ok: false,

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
          ok: false,

          error:
            "Invalid wake token"
        });
    }

    try {
      const result =
        await walmartScheduler
          .wakeScan();

      res.json({
        ok: true,

        result,

        schedule:
          walmartScheduler
            .getStatus()
      });

    } catch (error) {
      res
        .status(500)
        .json({
          ok: false,

          error:
            error.message
        });
    }
  }
);


app.post(
  "/api/walmart/scan",
  async (req,res) => {
    if (!manualScanToken) {
      return res
        .status(503)
        .json({
          ok: false,

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
          ok: false,

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
      res
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
   MARKETPLACE
======================================== */

app.get(
  "/api/marketplace",
  async (req,res) => {
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
            product.retailers.includes(
              "walmart"
            )
        );

      if (
        requestedProductId
      ) {
        catalog =
          catalog.filter(
            product =>
              product.id ===
              requestedProductId
          );

        if (
          !catalog.length
        ) {
          return res
            .status(404)
            .json({
              ok: false,

              error:
                "Product not found",

              productId:
                requestedProductId
            });
        }
      }

      const offers = [];
      const errors = [];

      for (
        const product of
        catalog
      ) {
        try {
          const productOffers =
            await walmart
              .searchMarketplaceOffers(
                product
              );

          for (
            const offer of
            productOffers
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
        const offer of
        offers
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
        Array
          .from(
            uniqueOffers.values()
          )
          .filter(
            offer =>
              offer.price !== null
          )
          .sort(
            (a,b) =>
              Number(
                a.price
              ) -
              Number(
                b.price
              )
          );

      const available =
        sorted.filter(
          offer =>
            offer.offerAvailable === true
        );

      const walmartDirect =
        available.filter(
          offer =>
            offer.directSeller === true
        );

      const marketplace =
        available.filter(
          offer =>
            offer.directSeller !== true
        );

      res.json({
        ok: true,

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
      res
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
   TEST ROUTES
======================================== */

app.get(
  "/api/test/product/:productId",
  async (req,res) => {
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
              "Product not found"
          });
      }

      const result =
        await walmart
          .checkProduct(
            product,
            "walmart"
          );

      res.json({
        ok: true,

        dashboardUpdated:
          true,

        result:
          saveResult(
            result
          )
      });

    } catch (error) {
      res
        .status(500)
        .json({
          ok: false,

          error:
            error.message
        });
    }
  }
);


app.get(
  "/api/test/prismatic-etb",
  async (req,res) => {
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
        await walmart
          .checkProduct(
            product,
            "walmart"
          );

      res.json({
        ok: true,

        test:
          "single-product",

        dashboardUpdated:
          true,

        result:
          saveResult(
            result
          )
      });

    } catch (error) {
      res
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
   DISCOVERY
======================================== */

app.get(
  "/api/discovery/run",
  async (req,res) => {
    try {
      res.json({
        ok: true,

        discovery:
          await discovery
            .discoverWalmartProducts()
      });

    } catch (error) {
      res
        .status(500)
        .json({
          ok: false,

          error:
            error.message
        });
    }
  }
);


app.get(
  "/api/discovery/products",
  async (req,res) => {
    try {
      const items =
        await discovery
          .getDiscoveredProducts();

      res.json({
        ok: true,

        count:
          items.length,

        items
      });

    } catch (error) {
      res
        .status(500)
        .json({
          ok: false,

          error:
            error.message
        });
    }
  }
);


app.get(
  "/api/debug/walmart-search",
  async (req,res) => {
    try {
      const result =
        await walmart
          .inspectSearchResponse(
            req.query.keyword ||
            "Pokemon TCG"
          );

      res.json({
        ok: true,

        ...result
      });

    } catch (error) {
      res
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
   DISCOVERY LOOP
======================================== */

let discoveryRunning =
  false;


async function runScheduledDiscovery() {
  if (
    discoveryRunning
  ) {
    return;
  }

  discoveryRunning =
    true;

  try {
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
    discoveryRunning =
      false;
  }
}


/* ========================================
   SERVER START
======================================== */

app.listen(
  port,
  async () => {
    if (process.env.RETAIL_PUBLIC_MONITOR_ENABLED !== "false") retailOnline.start().catch(error=>console.error("Online monitor startup failed:",error.message));
    console.log(
      `Pokemon monitor backend listening on ${port}`
    );

    console.log(
      "Web Push configuration:",
      push
        .getPushStatus()
    );

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

    try {
      const results =
        await multiStore
          .start({
            getWalmartState:
              getLatest
          });

      console.log(
        "Multi-store provider engine started:",
        results
      );

    } catch (error) {
      console.error(
        "Multi-store provider engine startup failed:",
        error
      );
    }

    if (bestBuyPublicWatchUrls.length) {
      const runPublicBestBuyWatch = () => {
        const activeWindow = isBestBuyPublicWindowActive();
        bestBuyPublicScheduleState.nextRun = new Date(
          Date.now() + bestBuyPublicPollMinutes * 60 * 1000
        ).toISOString();
        if (activeWindow) runBestBuyPublicWatch().catch(error => {
          console.warn("Best Buy public watch scheduler failed:", error.message);
        });
      };

      runPublicBestBuyWatch();
      const bestBuyPublicTimer = setInterval(
        runPublicBestBuyWatch,
        bestBuyPublicPollMinutes * 60 * 1000
      );
      bestBuyPublicTimer.unref?.();

      console.log("Best Buy public watch scheduled:", {
        urls: bestBuyPublicWatchUrls.length,
        everyMinutes: bestBuyPublicPollMinutes,
        timeZone: bestBuyPublicTimeZone,
        window: `${bestBuyPublicWindowStart}–${bestBuyPublicWindowEnd}`
      });
    } else {
      console.log("Best Buy public watch is waiting for configured product URLs.");
    }

    const scheduleState =
      walmartScheduler
        .start();

    console.log(
      "Walmart scheduled scanning:",
      scheduleState
    );

    try {
      const pcState =
        await pokemonCenter
          .start({
            onAlert:
              payload =>
                push.broadcast(
                  payload
                )
          });

      console.log(
        "Pokémon Center priority monitor started:",
        {
          level:
            pcState.level,

          trackedProductCount:
            pcState.trackedProductCount,

          normalScanSeconds:
            pcState.normalScanSeconds,

          hotScanSeconds:
            pcState.hotScanSeconds
        }
      );

    } catch (error) {
      console.error(
        "Pokémon Center monitor startup failed:",
        error
      );
    }

    setTimeout(
      () => {
        runRaffleScan()
          .catch(
            error =>
              console.error(
                "Startup raffle scan failed:",
                error.message
              )
          );
      },
      8000
    );

    const raffleTimer =
      setInterval(
        () => {
          runRaffleScan()
            .catch(
              error =>
                console.error(
                  "Automatic raffle scan failed:",
                  error.message
                )
            );
        },
        rafflePollMinutes *
        60 *
        1000
      );

    raffleTimer.unref?.();

    setTimeout(
      () => {
        runGtCollectiblesWatch()
          .catch(
            error =>
              console.error(
                "Startup GT Collectibles watch failed:",
                error.message
              )
          );
      },
      12000
    );

    const gtCollectiblesTimer =
      setInterval(
        () => {
          runGtCollectiblesWatch()
            .catch(
              error =>
                console.error(
                  "GT Collectibles watch failed:",
                  error.message
                )
            );
        },
        gtCollectiblesWatchMinutes *
        60 *
        1000
      );

    gtCollectiblesTimer.unref?.();

    if (
      runOnStartup
    ) {
      try {
        await runScheduledScan();

      } catch (error) {
        console.error(
          "Startup catalog scan failed:",
          error
        );
      }

    } else {
      console.log(
        "Startup catalog scan disabled."
      );
    }

    if (
      enableFullPolling
    ) {
      const pollingTimer =
        setInterval(
          () => {
            runScheduledScan()
              .catch(
                error =>
                  console.error(
                    "Automatic catalog polling failed:",
                    error
                  )
              );
          },
          pollSeconds *
          1000
        );

      pollingTimer.unref?.();

    } else {
      console.log(
        "Continuous catalog polling disabled; Walmart scheduler controls drop-window scans."
      );
    }

    if (
      enableDiscovery
    ) {
      setTimeout(
        runScheduledDiscovery,
        15000
      );

      const discoveryTimer =
        setInterval(
          runScheduledDiscovery,
          discoveryMinutes *
          60 *
          1000
        );

      discoveryTimer.unref?.();

    } else {
      console.log(
        "Continuous Walmart discovery disabled."
      );
    }
  }
);
