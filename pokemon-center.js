"use strict";

const crypto = require("crypto");


/* =========================================================
   POKÉMON CENTER PRIORITY SIGNAL ENGINE

   PURPOSE

   This module is the "brain" for Pokémon Center.

   It does NOT try to defeat Pokémon Center anti-bot,
   CAPTCHA, queue, authentication, or access controls.

   Instead it combines:

   - browser-sensor signals
   - official support/preorder-page changes
   - queue signals
   - product names
   - product URLs
   - SKU/product IDs
   - image changes
   - price changes
   - availability changes
   - DOM/backend-visible changes
   - historical Tuesday-Thursday weighting
   - sensor heartbeat health
   - duplicate suppression
   - confidence scoring
   - readiness-window estimates
   - multi-device push broadcasts

   STATES

   NORMAL
   BACKEND ACTIVITY
   DROP LIKELY
   LIVE

========================================================= */


/* =========================================================
   CONFIG
========================================================= */

const TIME_ZONE =
  process.env.POKEMON_CENTER_TIME_ZONE ||
  "America/Chicago";


/*
  Main Pokémon Center watch window.

  Tuesday morning through Thursday night.
*/
const ACTIVE_START_HOUR =
  Math.max(
    0,
    Math.min(
      23,
      Number(
        process.env.POKEMON_CENTER_ACTIVE_START_HOUR ||
        6
      )
    )
  );


const ACTIVE_END_HOUR =
  Math.max(
    0,
    Math.min(
      23,
      Number(
        process.env.POKEMON_CENTER_ACTIVE_END_HOUR ||
        23
      )
    )
  );


/*
  Chicago-time peak window.

  This roughly corresponds to
  10 AM - 3 PM Eastern.

  During this time, confidence weighting
  gets a small readiness boost.
*/
const PEAK_START_HOUR =
  Math.max(
    0,
    Math.min(
      23,
      Number(
        process.env.POKEMON_CENTER_PEAK_START_HOUR ||
        9
      )
    )
  );


const PEAK_END_HOUR =
  Math.max(
    0,
    Math.min(
      23,
      Number(
        process.env.POKEMON_CENTER_PEAK_END_HOUR ||
        14
      )
    )
  );


/*
  Cloud fallback scan timing.

  Browser-sensor events are still processed
  instantly when received.

  These timers only control cloud-side
  support/preorder sentinel checks.
*/
const ACTIVE_SCAN_MS =
  Math.max(
    30000,
    Number(
      process.env.POKEMON_CENTER_ACTIVE_SCAN_SECONDS ||
      120
    ) * 1000
  );


const OFF_WINDOW_SCAN_MS =
  Math.max(
    5 * 60 * 1000,
    Number(
      process.env.POKEMON_CENTER_SENTINEL_MINUTES ||
      15
    ) * 60 * 1000
  );


const HOT_SCAN_MS =
  Math.max(
    15000,
    Number(
      process.env.POKEMON_CENTER_HOT_SCAN_SECONDS ||
      30
    ) * 1000
  );


const HOT_HOLD_MS =
  Math.max(
    5 * 60 * 1000,
    Number(
      process.env.POKEMON_CENTER_HOT_MINUTES ||
      20
    ) * 60 * 1000
  );


const REQUEST_TIMEOUT_MS =
  Math.max(
    4000,
    Number(
      process.env.POKEMON_CENTER_TIMEOUT_MS ||
      10000
    )
  );


const SUPPORT_BLOCKED_RETRY_MS =
  Math.max(
    15 * 60 * 1000,
    Number(
      process.env.POKEMON_CENTER_BLOCKED_RETRY_MINUTES ||
      360
    ) * 60 * 1000
  );


const SUPPORT_RATE_LIMIT_RETRY_MS =
  Math.max(
    5 * 60 * 1000,
    Number(
      process.env.POKEMON_CENTER_RATE_LIMIT_RETRY_MINUTES ||
      60
    ) * 60 * 1000
  );


const SUPPORT_ERROR_RETRY_MS =
  Math.max(
    5 * 60 * 1000,
    Number(
      process.env.POKEMON_CENTER_ERROR_RETRY_MINUTES ||
      15
    ) * 60 * 1000
  );


const SENSOR_STALE_MS =
  Math.max(
    2 * 60 * 1000,
    Number(
      process.env.POKEMON_CENTER_SENSOR_STALE_MINUTES ||
      5
    ) * 60 * 1000
  );


const MAX_EVENTS =
  Math.max(
    100,
    Number(
      process.env.POKEMON_CENTER_MAX_EVENTS ||
      500
    )
  );


const MAX_PRODUCTS =
  Math.max(
    100,
    Number(
      process.env.POKEMON_CENTER_MAX_PRODUCTS ||
      1500
    )
  );


/*
  Public official support-center JSON endpoints.

  The browser pages can reject cloud requests with
  HTTP 403 while the public Zendesk JSON endpoints
  remain readable. These endpoints only provide
  support and preorder/release information; they do
  not expose live storefront inventory.

  Direct pokemoncenter.com storefront requests are
  intentionally not used as a way around access
  controls.
*/
const SUPPORT_URLS = [
  "https://support.pokemoncenter.com/api/v2/help_center/en-us/articles/4407702295572.json",
  "https://support.pokemoncenter.com/api/v2/help_center/en-us/articles/360000247014.json",
  "https://support.pokemoncenter.com/api/v2/help_center/en-us/articles/37286495522452.json",
  "https://support.pokemoncenter.com/api/v2/help_center/en-us/articles/35134190572564.json"
];


const POKEMON_CENTER_HOME =
  "https://www.pokemoncenter.com/";


const APP_ICON =
  "https://pokemon-live-backend.onrender.com/app-icon.png";


const USER_AGENT =
  "Mozilla/5.0 (compatible; PokemonRestockMonitor/2.0; +https://pokemon-live-backend.onrender.com/)";


/* =========================================================
   RUNTIME STATE
========================================================= */

let started =
  false;


let scanRunning =
  false;


let timer =
  null;


let alertHandler =
  null;


let hotUntil =
  0;


let lastAlertFingerprint =
  null;


let lastBrowserHeartbeat =
  null;


let lastBrowserSensorId =
  null;


let lastBrowserSensorVersion =
  null;


let lastBrowserUserAgent =
  null;


const supportFingerprints =
  new Map();


const supportHealth =
  new Map();


const products =
  new Map();


const events =
  [];


const recentSignalFingerprints =
  new Map();


let state = {

  ok:
    true,

  running:
    false,

  priority:
    "highest",

  level:
    "normal",

  confidence:
    0,

  confidenceLabel:
    "LOW",

  queueActive:
    false,

  hotMode:
    false,

  activeWindow:
    false,

  peakWindow:
    false,

  readinessWindow:
    null,

  predictedProduct:
    null,

  lastChecked:
    null,

  lastSuccess:
    null,

  nextCheck:
    null,

  lastError:
    null,

  lastMeaningfulActivity:
    null,

  browserSensorOnline:
    false,

  browserSensorLastHeartbeat:
    null,

  browserSensorId:
    null,

  browserSensorVersion:
    null,

  supportSourceCount:
    SUPPORT_URLS.length,

  trackedProductCount:
    0,

  eventCount:
    0,

  latestEvents:
    [],

  products:
    []

};


/* =========================================================
   BASIC HELPERS
========================================================= */

function nowIso() {

  return new Date()
    .toISOString();

}


function hash(
  value
) {

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      String(
        value ??
        ""
      )
    )
    .digest(
      "hex"
    );

}


function normalizeText(
  value
) {

  return String(
    value ??
    ""
  )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      "\""
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


function normalizeKey(
  value
) {

  return normalizeText(
    value
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );

}


function boundedNumber(
  value,
  min,
  max,
  fallback
) {

  const number =
    Number(
      value
    );


  if(
    !Number.isFinite(
      number
    )
  ){

    return fallback;

  }


  return Math.max(
    min,
    Math.min(
      max,
      number
    )
  );

}


/* =========================================================
   TIME HELPERS
========================================================= */

function zonedParts(
  date =
    new Date()
) {

  const formatter =
    new Intl.DateTimeFormat(
      "en-US",
      {

        timeZone:
          TIME_ZONE,

        weekday:
          "short",

        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit",

        hourCycle:
          "h23"

      }
    );


  const parts =
    Object.fromEntries(
      formatter
        .formatToParts(
          date
        )
        .map(
          part => [
            part.type,
            part.value
          ]
        )
    );


  return {

    weekday:
      parts.weekday,

    hour:
      Number(
        parts.hour
      ),

    minute:
      Number(
        parts.minute
      ),

    second:
      Number(
        parts.second
      )

  };

}


function dayIndex(
  weekday
) {

  return {

    Sun:
      0,

    Mon:
      1,

    Tue:
      2,

    Wed:
      3,

    Thu:
      4,

    Fri:
      5,

    Sat:
      6

  }[weekday] ??
  -1;

}


function isActiveWindow(
  date =
    new Date()
) {

  const parts =
    zonedParts(
      date
    );


  const day =
    dayIndex(
      parts.weekday
    );


  if(
    day <
      2 ||
    day >
      4
  ){

    return false;

  }


  if(
    day ===
      2 &&
    parts.hour <
      ACTIVE_START_HOUR
  ){

    return false;

  }


  if(
    day ===
      4 &&
    parts.hour >
      ACTIVE_END_HOUR
  ){

    return false;

  }


  return true;

}


function isPeakWindow(
  date =
    new Date()
) {

  if(
    !isActiveWindow(
      date
    )
  ){

    return false;

  }


  const parts =
    zonedParts(
      date
    );


  return (

    parts.hour >=
      PEAK_START_HOUR &&

    parts.hour <=
      PEAK_END_HOUR

  );

}


/* =========================================================
   SENSOR HEALTH
========================================================= */

function sensorOnline() {

  if(
    !lastBrowserHeartbeat
  ){

    return false;

  }


  const age =
    Date.now() -
    new Date(
      lastBrowserHeartbeat
    )
      .getTime();


  return (
    Number.isFinite(
      age
    ) &&
    age <=
      SENSOR_STALE_MS
  );

}


/* =========================================================
   PRODUCT HELPERS
========================================================= */

function productKey(
  signal
) {

  return String(

    signal?.sku ||

    signal?.productId ||

    signal?.url ||

    signal?.name ||

    ""

  )
    .trim()
    .toLowerCase();

}


function mergeProduct(
  signal
) {

  const key =
    productKey(
      signal
    );


  if(
    !key
  ){

    return null;

  }


  const existing =
    products.get(
      key
    ) ||
    {};


  const merged = {

    key,

    name:
      signal.name ||
      existing.name ||
      null,

    sku:
      signal.sku ||
      signal.productId ||
      existing.sku ||
      null,

    url:
      signal.url ||
      existing.url ||
      null,

    image:
      signal.image ||
      existing.image ||
      null,

    price:
      signal.price ??
      existing.price ??
      null,

    availability:
      signal.availability ||
      existing.availability ||
      null,

    live:
      signal.live ===
        true ||
      existing.live ===
        true,

    firstSeen:
      existing.firstSeen ||
      nowIso(),

    lastSeen:
      nowIso(),

    source:
      signal.source ||
      existing.source ||
      "unknown",

    lastSignalType:
      signal.type ||
      existing.lastSignalType ||
      null

  };


  products.set(
    key,
    merged
  );


  trimProducts();


  return merged;

}


function trimProducts() {

  if(
    products.size <=
    MAX_PRODUCTS
  ){

    return;

  }


  const sorted =
    Array
      .from(
        products.entries()
      )
      .sort(
        (a,b) =>
          new Date(
            a[1].lastSeen ||
            0
          ) -
          new Date(
            b[1].lastSeen ||
            0
          )
      );


  const removeCount =
    products.size -
    MAX_PRODUCTS;


  for(
    const [
      key
    ] of
    sorted.slice(
      0,
      removeCount
    )
  ){

    products.delete(
      key
    );

  }

}


/* =========================================================
   EVENT LOG
========================================================= */

function addEvent(
  event
) {

  const entry = {

    id:
      hash(
        [
          event.type,
          event.name,
          event.sku,
          event.url,
          event.detail,
          event.at ||
          nowIso()
        ]
          .join(
            "|"
          )
      ),

    at:
      event.at ||
      nowIso(),

    priority:
      event.priority ||
      "important",

    source:
      event.source ||
      "pokemon-center",

    ...event

  };


  events.unshift(
    entry
  );


  if(
    events.length >
    MAX_EVENTS
  ){

    events.length =
      MAX_EVENTS;

  }


  state.lastMeaningfulActivity =
    entry.at;


  return entry;

}


/* =========================================================
   DUPLICATE SUPPRESSION
========================================================= */

function signalFingerprint(
  signal
) {

  return hash(
    JSON.stringify({

      type:
        signal.type ||
        null,

      name:
        signal.name ||
        null,

      sku:
        signal.sku ||
        signal.productId ||
        null,

      url:
        signal.url ||
        null,

      image:
        signal.image ||
        null,

      price:
        signal.price ??
        null,

      availability:
        signal.availability ||
        null,

      queueActive:
        signal.queueActive ===
        true,

      detail:
        signal.detail ||
        null

    })
  );

}


function isDuplicateSignal(
  signal,
  ttlMs =
    3 * 60 * 1000
) {

  const fingerprint =
    signalFingerprint(
      signal
    );


  const previous =
    recentSignalFingerprints.get(
      fingerprint
    );


  const now =
    Date.now();


  recentSignalFingerprints.set(
    fingerprint,
    now
  );


  for(
    const [
      key,
      timestamp
    ] of
    recentSignalFingerprints
  ){

    if(
      now -
      timestamp >
      30 * 60 * 1000
    ){

      recentSignalFingerprints.delete(
        key
      );

    }

  }


  return (

    previous !=
      null &&

    now -
      previous <
    ttlMs

  );

}


/* =========================================================
   SIGNAL SCORING
========================================================= */

function baseScoreForType(
  type
) {

  return {

    HEARTBEAT:
      0,

    SOURCE_CHANGE:
      8,

    PAGE_CHANGE:
      12,

    DOM_CHANGE:
      15,

    IMAGE_CHANGE:
      18,

    PRICE_CHANGE:
      20,

    PRODUCT_NAME_CHANGE:
      22,

    CATEGORY_CHANGE:
      22,

    AVAILABILITY_CHANGE:
      30,

    NEW_PRODUCT_NAME:
      34,

    NEW_IMAGE:
      35,

    NEW_PRODUCT_URL:
      42,

    SKU_CHANGE:
      44,

    NEW_SKU:
      48,

    NEW_PRODUCT:
      50,

    SUPPORT_PREORDER_CHANGE:
      42,

    QUEUE_SIGNAL:
      55,

    QUEUE_ACTIVE:
      65,

    PRODUCT_LIVE:
      100,

    PREORDER_LIVE:
      100

  }[
    String(
      type ||
      ""
    )
      .toUpperCase()
  ] ??
  10;

}


function scoreSignal(
  signal
) {

  /*
    Official help-center edits can report preorder
    shipment dates, but they are not storefront or
    backend inventory activity. Keep them visible as
    informational events without treating them as
    evidence that a drop is near.
  */
  if (
    signal.source ===
      "pokemon-center-support"
  ) {
    return signal.type ===
      "SUPPORT_PREORDER_CHANGE"
      ? 15
      : 0;
  }

  let score =
    baseScoreForType(
      signal.type
    );


  if(
    signal.name
  ){

    score +=
      6;

  }


  if(
    signal.sku ||
    signal.productId
  ){

    score +=
      8;

  }


  if(
    signal.url
  ){

    score +=
      7;

  }


  if(
    signal.image
  ){

    score +=
      5;

  }


  if(
    signal.queueActive ===
    true
  ){

    score +=
      20;

  }


  if(
    signal.live ===
    true
  ){

    score =
      100;

  }


  if(
    isPeakWindow()
  ){

    score +=
      6;

  }


  if(
    isActiveWindow()
  ){

    score +=
      4;

  }


  return boundedNumber(
    score,
    0,
    100,
    0
  );

}


/* =========================================================
   CORRELATION
========================================================= */

function recentMeaningfulEvents(
  minutes =
    20
) {

  const cutoff =
    Date.now() -
    minutes *
    60 *
    1000;


  return events.filter(
    event =>
      new Date(
        event.at
      )
        .getTime() >=
      cutoff
  );

}


function correlatedScore(
  signalScore
) {

  const recent =
    recentMeaningfulEvents(
      20
    );


  let score =
    signalScore;


  const types =
    new Set(
      recent.map(
        event =>
          event.type
      )
    );


  const productIdentifiers =
    recent.filter(
      event =>
        event.name ||
        event.sku ||
        event.url
    )
      .length;


  if(
    types.has(
      "QUEUE_ACTIVE"
    ) ||
    types.has(
      "QUEUE_SIGNAL"
    )
  ){

    score +=
      15;

  }


  if(
    types.has(
      "NEW_SKU"
    ) ||
    types.has(
      "SKU_CHANGE"
    )
  ){

    score +=
      10;

  }


  if(
    types.has(
      "NEW_PRODUCT_URL"
    )
  ){

    score +=
      10;

  }


  if(
    types.has(
      "NEW_IMAGE"
    ) ||
    types.has(
      "IMAGE_CHANGE"
    )
  ){

    score +=
      7;

  }


  if(
    types.has(
      "AVAILABILITY_CHANGE"
    )
  ){

    score +=
      10;

  }


  if(
    productIdentifiers >=
      2
  ){

    score +=
      8;

  }


  if(
    recent.length >=
      3
  ){

    score +=
      8;

  }


  if(
    recent.length >=
      5
  ){

    score +=
      7;

  }


  return boundedNumber(
    score,
    0,
    100,
    0
  );

}


/* =========================================================
   LEVEL / CONFIDENCE
========================================================= */

function levelFromScore(
  score,
  signal
) {

  if(
    signal?.live ===
      true ||

    signal?.type ===
      "PRODUCT_LIVE" ||

    signal?.type ===
      "PREORDER_LIVE"
  ){

    return "live";

  }


  if(
    score >=
      70
  ){

    return "drop_likely";

  }


  if(
    score >=
      20
  ){

    return "backend_activity";

  }


  return "normal";

}


function confidenceLabel(
  score
) {

  if(
    score >=
      85
  ){

    return "VERY HIGH";

  }


  if(
    score >=
      70
  ){

    return "HIGH";

  }


  if(
    score >=
      45
  ){

    return "MEDIUM";

  }


  return "LOW";

}


/* =========================================================
   READINESS WINDOW
========================================================= */

function readinessWindowFor(
  score,
  signal
) {

  if(
    signal?.live ===
      true ||

    signal?.type ===
      "PRODUCT_LIVE" ||

    signal?.type ===
      "PREORDER_LIVE"
  ){

    return {

      label:
        "LIVE NOW",

      minMinutes:
        0,

      maxMinutes:
        0,

      confidence:
        "confirmed"

    };

  }


  if(
    score >=
      90
  ){

    return {

      label:
        "Be ready now — possible movement within 5–30 min",

      minMinutes:
        5,

      maxMinutes:
        30,

      confidence:
        "estimated"

    };

  }


  if(
    score >=
      75
  ){

    return {

      label:
        "Be ready — possible movement within 10–60 min",

      minMinutes:
        10,

      maxMinutes:
        60,

      confidence:
        "estimated"

    };

  }


  if(
    score >=
      55
  ){

    return {

      label:
        "Watch closely — possible movement within 30–120 min",

      minMinutes:
        30,

      maxMinutes:
        120,

      confidence:
        "estimated"

    };

  }


  if(
    score >=
      30
  ){

    return {

      label:
        "Early activity — no reliable drop window yet",

      minMinutes:
        null,

      maxMinutes:
        null,

      confidence:
        "low"

    };

  }


  return null;

}


/* =========================================================
   BEST PRODUCT GUESS
========================================================= */

function bestProductFromRecentEvents(){

  const recent =
    recentMeaningfulEvents(
      60
    );


  const candidates =
    new Map();


  for(
    const event of
    recent
  ){

    const key =
      String(
        event.sku ||
        event.productId ||
        event.url ||
        event.name ||
        ""
      )
        .trim()
        .toLowerCase();


    if(
      !key
    ){

      continue;

    }


    const current =
      candidates.get(
        key
      ) ||
      {

        name:
          event.name ||
          null,

        sku:
          event.sku ||
          event.productId ||
          null,

        url:
          event.url ||
          null,

        image:
          event.image ||
          null,

        score:
          0,

        signals:
          0

      };


    current.score +=
      Number(
        event.score ||
        0
      );


    current.signals +=
      1;


    current.name =
      event.name ||
      current.name;


    current.sku =
      event.sku ||
      event.productId ||
      current.sku;


    current.url =
      event.url ||
      current.url;


    current.image =
      event.image ||
      current.image;


    candidates.set(
      key,
      current
    );

  }


  return Array
    .from(
      candidates.values()
    )
    .sort(
      (a,b) =>
        (
          b.score +
          b.signals * 10
        ) -
        (
          a.score +
          a.signals * 10
        )
    )[0] ||
    null;

}


/* =========================================================
   PUSH ALERT
========================================================= */

async function sendPushForEvent(
  event,
  score,
  level
) {

  if(
    typeof alertHandler !==
      "function"
  ){

    return;

  }


  const readiness =
    readinessWindowFor(
      score,
      event
    );


  const predicted =
    bestProductFromRecentEvents();


  const title =
    level ===
      "live"
      ? "🔥 POKÉMON CENTER LIVE"
      : level ===
          "drop_likely"
        ? "🚨 POKÉMON CENTER DROP LIKELY"
        : "⚡ POKÉMON CENTER BACKEND ACTIVITY";


  const productName =
    event.name ||
    predicted?.name ||
    "Pokémon Center activity";


  const details =
    [];


  if(
    event.sku ||
    event.productId
  ){

    details.push(
      `SKU ${
        event.sku ||
        event.productId
      }`
    );

  }


  details.push(
    `Confidence ${
      confidenceLabel(
        score
      )
    }`
  );


  if(
    readiness?.label
  ){

    details.push(
      readiness.label
    );

  }


  const body =
    `${productName} • ${details.join(" • ")}`;


  const url =
    event.url ||
    predicted?.url ||
    POKEMON_CENTER_HOME;


  const fingerprint =
    hash(
      JSON.stringify({

        title,

        productName,

        url,

        level,

        confidence:
          confidenceLabel(
            score
          ),

        readiness:
          readiness?.label ||
          null

      })
    );


  if(
    fingerprint ===
    lastAlertFingerprint
  ){

    return;

  }


  lastAlertFingerprint =
    fingerprint;


  await alertHandler({

    title,

    body,

    url,

    icon:
      event.image ||
      predicted?.image ||
      APP_ICON,

    badge:
      APP_ICON,

    tag:
      `pokemon-center-${level}-${fingerprint.slice(0,12)}`

  });

}


/* =========================================================
   PROCESS SIGNAL
========================================================= */

async function processSignal(
  rawSignal = {}
) {

  const type =
    String(
      rawSignal.type ||
      "PAGE_CHANGE"
    )
      .trim()
      .toUpperCase();


  const signal = {

    type,

    source:
      rawSignal.source ||
      "browser-sensor",

    sensorId:
      rawSignal.sensorId ||
      null,

    name:
      normalizeText(
        rawSignal.name ||
        rawSignal.productName ||
        ""
      ) ||
      null,

    sku:
      normalizeText(
        rawSignal.sku ||
        rawSignal.productId ||
        ""
      ) ||
      null,

    productId:
      normalizeText(
        rawSignal.productId ||
        rawSignal.sku ||
        ""
      ) ||
      null,

    url:
      rawSignal.url ||
      rawSignal.productUrl ||
      null,

    image:
      rawSignal.image ||
      rawSignal.imageUrl ||
      null,

    price:
      rawSignal.price ??
      null,

    availability:
      normalizeText(
        rawSignal.availability ||
        rawSignal.status ||
        ""
      ) ||
      null,

    live:
      rawSignal.live ===
        true,

    queueActive:
      rawSignal.queueActive ===
        true,

    detail:
      normalizeText(
        rawSignal.detail ||
        rawSignal.message ||
        ""
      ) ||
      null,

    at:
      rawSignal.at ||
      nowIso()

  };


  if(
    type ===
      "HEARTBEAT"
  ){

    lastBrowserHeartbeat =
      nowIso();


    lastBrowserSensorId =
      rawSignal.sensorId ||
      lastBrowserSensorId;


    lastBrowserSensorVersion =
      rawSignal.version ||
      lastBrowserSensorVersion;


    lastBrowserUserAgent =
      rawSignal.userAgent ||
      lastBrowserUserAgent;


    refreshState();


    return {

      ok:
        true,

      heartbeat:
        true,

      state:
        getState()

    };

  }


  if(
    isDuplicateSignal(
      signal
    )
  ){

    return {

      ok:
        true,

      duplicate:
        true,

      state:
        getState()

    };

  }


  /*
    Browser signal received means sensor
    is alive even if it was not a heartbeat.
  */
  if(
    signal.source ===
      "browser-sensor" ||
    signal.sensorId
  ){

    lastBrowserHeartbeat =
      nowIso();


    lastBrowserSensorId =
      signal.sensorId ||
      lastBrowserSensorId;

  }


  if(
    signal.queueActive ===
      true &&
    signal.type !==
      "QUEUE_ACTIVE"
  ){

    signal.type =
      "QUEUE_ACTIVE";

  }


  const initialScore =
    scoreSignal(
      signal
    );


  const score =
    signal.source ===
      "pokemon-center-support"
      ? initialScore
      : correlatedScore(
          initialScore
        );


  const level =
    levelFromScore(
      score,
      signal
    );


  const event =
    addEvent({

      ...signal,

      score,

      level,

      confidence:
        confidenceLabel(
          score
        ),

      readinessWindow:
        readinessWindowFor(
          score,
          signal
        )

    });


  mergeProduct(
    event
  );


  if(
    level ===
      "backend_activity" ||

    level ===
      "drop_likely" ||

    level ===
      "live"
  ){

    hotUntil =
      Date.now() +
      HOT_HOLD_MS;

  }


  if(
    signal.type ===
      "QUEUE_ACTIVE"
  ){

    state.queueActive =
      true;

  }


  refreshState(
    event
  );


  /*
    Every meaningful Pokémon Center signal
    is important enough to notify.

    Duplicate suppression prevents the
    exact same alert from repeating.
  */
  if(
    score >= 20 &&
    signal.source !==
      "pokemon-center-support"
  ){

    try{

      await sendPushForEvent(
        event,
        score,
        level
      );


    }catch(error){

      state.lastAlertError =
        error.message;

    }

  }


  return {

    ok:
      true,

    duplicate:
      false,

    event,

    state:
      getState()

  };

}


/* =========================================================
   OFFICIAL SUPPORT FETCH
========================================================= */

async function fetchText(
  url
) {

  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS
    );


  try{

    const response =
      await fetch(
        url,
        {

          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {

            "user-agent":
              USER_AGENT,

            "accept":
              "application/json",

            "accept-language":
              "en-US,en;q=0.9",

            "cache-control":
              "no-cache"

          }

        }
      );


    const text =
      await response
        .text();


    return {

      ok:
        response.ok,

      status:
        response.status,

      retryAfter:
        response.headers.get(
          "retry-after"
        ),

      finalUrl:
        response.url ||
        url,

      text,

      bytes:
        Buffer.byteLength(
          text,
          "utf8"
        )

    };


  }catch(error){

    if(
      error?.name ===
        "AbortError"
    ){

      throw new Error(
        `Timed out after ${REQUEST_TIMEOUT_MS}ms`
      );

    }


    throw error;


  }finally{

    clearTimeout(
      timeout
    );

  }

}


/* =========================================================
   SUPPORT PAGE NORMALIZATION
========================================================= */

function supportPageSignalText(
  html
) {

  return normalizeText(
    String(
      html ||
      ""
    )
      .replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style\b[^>]*>[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
  );

}


/* =========================================================
   KNOWN PRODUCT-NAME EXTRACTION
========================================================= */

function extractInterestingProductNames(
  text
) {

  const names =
    new Set();


  const source =
    normalizeText(
      text
    );


  const patterns = [

    /Pok[eé]mon TCG:[^.]{5,120}/gi,

    /Mega Evolution[^.]{0,100}/gi,

    /Delta Reign[^.]{0,100}/gi,

    /30th Celebration[^.]{0,100}/gi,

    /Prismatic Evolutions[^.]{0,100}/gi,

    /Destined Rivals[^.]{0,100}/gi,

    /Ascended Heroes[^.]{0,100}/gi

  ];


  for(
    const pattern of
    patterns
  ){

    const matches =
      source.match(
        pattern
      ) ||
      [];


    for(
      const match of
      matches
    ){

      const cleaned =
        normalizeText(
          match
        )
          .slice(
            0,
            160
          );


      if(
        cleaned.length >=
        5
      ){

        names.add(
          cleaned
        );

      }

    }

  }


  return Array
    .from(
      names
    )
    .slice(
      0,
      40
    );

}


/* =========================================================
   SUPPORT SCAN
========================================================= */

async function scanSupportSource(
  url
) {

  const checkedAt =
    nowIso();

  const previousHealth =
    supportHealth.get(
      url
    );

  const retryAfterMs =
    Date.parse(
      previousHealth?.retryAfter ||
      ""
    );

  if (
    Number.isFinite(
      retryAfterMs
    ) &&
    retryAfterMs > Date.now()
  ) {
    return {
      ok: false,
      changed: false,
      skipped: true,
      status: previousHealth.status,
      error: previousHealth.error,
      retryAfter: previousHealth.retryAfter
    };
  }


  try{

    const response =
      await fetchText(
        url
      );

    if (
      !response.ok
    ) {
      const retryDelay =
        response.status === 401 ||
        response.status === 403
          ? SUPPORT_BLOCKED_RETRY_MS
          : response.status === 429
            ? SUPPORT_RATE_LIMIT_RETRY_MS
            : SUPPORT_ERROR_RETRY_MS;

      let retryAt =
        Date.now() + retryDelay;

      if (
        response.status === 429 &&
        response.retryAfter
      ) {
        const retrySeconds =
          Number(
            response.retryAfter
          );

        const parsedRetryDate =
          Number.isFinite(retrySeconds) &&
          retrySeconds > 0
            ? Date.now() + retrySeconds * 1000
            : Date.parse(
                response.retryAfter
              );

        if (
          Number.isFinite(parsedRetryDate)
        ) {
          retryAt = Math.max(
            Date.now() + 30 * 1000,
            Math.min(
              parsedRetryDate,
              Date.now() + 24 * 60 * 60 * 1000
            )
          );
        }
      }

      const retryAfter =
        new Date(
          retryAt
        ).toISOString();

      const statusLabel =
        response.status === 401 ||
        response.status === 403
          ? "Automated access denied"
          : response.status === 429
            ? "Rate limited"
            : "Source unavailable";

      const sourceError =
        `${statusLabel} (HTTP ${response.status})`;

      supportHealth.set(
        url,
        {
          url,
          ok: false,
          state:
            response.status === 401 ||
            response.status === 403
              ? "blocked"
              : response.status === 429
                ? "rate_limited"
                : "unavailable",
          status: response.status,
          finalUrl: response.finalUrl,
          bytes: response.bytes,
          checkedAt,
          retryAfter,
          error: sourceError
        }
      );

      return {
        ok: false,
        changed: false,
        status: response.status,
        error: sourceError,
        retryAfter
      };
    }


    let sourceText =
      response.text;

    try {
      const payload =
        JSON.parse(
          response.text
        );

      const article =
        payload?.article;

      if (
        !article ||
        typeof article !== "object"
      ) {
        throw new Error(
          "Support API returned no article"
        );
      }

      sourceText = [
        article.title,
        article.body
      ]
        .filter(Boolean)
        .join("\n");

    } catch (error) {
      const sourceError =
        `Invalid Pokémon Center support JSON: ${error.message}`;

      supportHealth.set(
        url,
        {
          url,
          ok: false,
          state: "unavailable",
          status: response.status,
          finalUrl: response.finalUrl,
          bytes: response.bytes,
          checkedAt,
          retryAfter: new Date(
            Date.now() + SUPPORT_ERROR_RETRY_MS
          ).toISOString(),
          error: sourceError
        }
      );

      return {
        ok: false,
        changed: false,
        status: response.status,
        error: sourceError
      };
    }

    const signalText =
      supportPageSignalText(
        sourceText
      );


    const fingerprint =
      hash(
        signalText
      );


    const previous =
      supportFingerprints.get(
        url
      );


    supportHealth.set(
      url,
      {

        url,

        ok:
          response.ok,

        state:
          "available",

        status:
          response.status,

        finalUrl:
          response.finalUrl,

        bytes:
          response.bytes,

        checkedAt,

        retryAfter:
          null,

        error:
          null

      }
    );


    supportFingerprints.set(
      url,
      {

        fingerprint,

        text:
          signalText,

        names:
          extractInterestingProductNames(
            signalText
          )

      }
    );


    /*
      First read establishes baseline only.
    */
    if(
      !previous
    ){

      return {

        ok:
          response.ok,

        changed:
          false

      };

    }


    if(
      previous.fingerprint ===
      fingerprint
    ){

      return {

        ok:
          response.ok,

        changed:
          false

      };

    }


    const previousNames =
      new Set(
        previous.names ||
        []
      );


    const currentNames =
      extractInterestingProductNames(
        signalText
      );


    const newNames =
      currentNames.filter(
        name =>
          !previousNames.has(
            name
          )
      );


    if(
      url.includes(
        "/articles/4407702295572.json"
      )
    ){

      if(
        newNames.length
      ){

        for(
          const name of
          newNames.slice(
            0,
            8
          )
        ){

          await processSignal({

            type:
              "SUPPORT_PREORDER_CHANGE",

            source:
              "pokemon-center-support",

            name,

            url,

            detail:
              "Official Pokémon Center preorder/release information changed."

          });

        }


      }else{

        await processSignal({

          type:
            "SOURCE_CHANGE",

          source:
            "pokemon-center-support",

          url,

          detail:
            "Official Pokémon Center preorder/release page changed."

        });

      }


    }else if(
      url.includes(
        "/articles/35134190572564.json"
      )
    ){

      await processSignal({

        type:
          "EARLY_ACCESS_INFO_CHANGE",

        source:
          "pokemon-center-support",

        url,

        detail:
          "Official Pokémon Center early-access information changed. This is informational and does not confirm public inventory."

      });

    }else{

      await processSignal({

        type:
          "SOURCE_CHANGE",

        source:
          "pokemon-center-support",

        url,

        detail:
          "Official Pokémon Center support information changed."

      });

    }


    return {

      ok:
        response.ok,

      changed:
        true,

      newNames

    };


  }catch(error){

    supportHealth.set(
      url,
      {

        url,

        ok:
          false,

        status:
          null,

        state:
          "unavailable",

        finalUrl:
          null,

        bytes:
          0,

        checkedAt,

        retryAfter:
          new Date(
            Date.now() +
            SUPPORT_ERROR_RETRY_MS
          ).toISOString(),

        error:
          error.message

      }
    );


    return {

      ok:
        false,

      changed:
        false,

      error:
        error.message

    };

  }

}


/* =========================================================
   CLOUD SENTINEL SCAN
========================================================= */

async function scan(){

  if(
    scanRunning
  ){

    return {

      ...getState(),

      skipped:
        true,

      reason:
        "Pokémon Center scan already running"

    };

  }


  scanRunning =
    true;


  state.running =
    true;


  state.lastChecked =
    nowIso();


  const results =
    [];


  try{

    /*
      We intentionally scan the support
      sources sequentially to stay gentle
      and reliable.
    */
    for(
      const url of
      SUPPORT_URLS
    ){

      results.push(
        await scanSupportSource(
          url
        )
      );

    }


    const successful =
      results.filter(
        result =>
          result.ok ===
          true
      );

    const failed =
      results.filter(
        result =>
          result.ok !== true
      );


    state.lastSuccess =
      successful.length
        ? nowIso()
        : state.lastSuccess;


    const blockedCount =
      failed.filter(
        result =>
          result.status === 401 ||
          result.status === 403
      ).length;

    const limitedCount =
      failed.filter(
        result =>
          result.status === 429
      ).length;

    if (
      failed.length === 0
    ) {
      state.lastError = null;
    } else if (
      blockedCount === failed.length
    ) {
      state.lastError =
        `Pokémon Center denied automated access to ${blockedCount} support page(s) (HTTP 403/401). No inventory was available from these checks; blocked pages will be retried after the cooldown.`;
    } else if (
      limitedCount === failed.length
    ) {
      state.lastError =
        `Pokémon Center rate-limited ${limitedCount} support page(s) (HTTP 429). No inventory was available from these checks; they will be retried after the cooldown.`;
    } else {
      const errors =
        failed
          .map(
            result =>
              result.error
          )
          .filter(Boolean);

      state.lastError =
        successful.length
          ? `Some Pokémon Center support pages are unavailable: ${errors.join("; ") || `${failed.length} check(s) failed`}.`
          : `Pokémon Center inventory is unavailable from its support pages: ${errors.join("; ") || `${failed.length} check(s) failed`}.`;
    }


    refreshState();


    return getState();


  }finally{

    scanRunning =
      false;


    state.running =
      false;

  }

}


/* =========================================================
   STATE REFRESH
========================================================= */

function refreshState(
  latestEvent =
    null
) {

  const activeWindow =
    isActiveWindow();


  const peakWindow =
    isPeakWindow();


  const online =
    sensorOnline();


  const recent =
    recentMeaningfulEvents(
      20
    );


  const maxRecentScore =
    recent.reduce(
      (
        best,
        event
      ) =>
        Math.max(
          best,
          Number(
            event.score ||
            0
          )
        ),
      0
    );


  const latestScore =
    latestEvent
      ? Number(
          latestEvent.score ||
          0
        )
      : 0;


  const score =
    Math.max(
      maxRecentScore,
      latestScore
    );


  let level =
    "normal";


  if(
    recent.some(
      event =>
        event.live ===
          true ||
        event.type ===
          "PRODUCT_LIVE" ||
        event.type ===
          "PREORDER_LIVE"
    )
  ){

    level =
      "live";


  }else if(
    score >=
      70
  ){

    level =
      "drop_likely";


  }else if(
    score >=
      20
  ){

    level =
      "backend_activity";

  }


  const predicted =
    bestProductFromRecentEvents();


  state = {

    ...state,

    ok:
      true,

    running:
      scanRunning,

    priority:
      "highest",

    level,

    confidence:
      score,

    confidenceLabel:
      confidenceLabel(
        score
      ),

    queueActive:
      recent.some(
        event =>
          event.type ===
            "QUEUE_ACTIVE" ||
          event.queueActive ===
            true
      ),

    hotMode:
      Date.now() <
      hotUntil,

    activeWindow,

    peakWindow,

    readinessWindow:
      readinessWindowFor(
        score,
        latestEvent ||
        recent[0] ||
        {}
      ),

    predictedProduct:
      predicted,

    browserSensorOnline:
      online,

    browserSensorLastHeartbeat:
      lastBrowserHeartbeat,

    browserSensorId:
      lastBrowserSensorId,

    browserSensorVersion:
      lastBrowserSensorVersion,

    supportSourceCount:
      SUPPORT_URLS.length,

    supportHealth:
      SUPPORT_URLS.map(
        url =>
          supportHealth.get(
            url
          ) ||
          {

            url,

            ok:
              false,

            checkedAt:
              null,

            error:
              "Not checked yet"

          }
      ),

    trackedProductCount:
      products.size,

    eventCount:
      events.length,

    latestEvents:
      events.slice(
        0,
        30
      ),

    products:
      Array
        .from(
          products.values()
        )
        .sort(
          (a,b) =>
            new Date(
              b.lastSeen ||
              0
            ) -
            new Date(
              a.lastSeen ||
              0
            )
        )
        .slice(
          0,
          250
        )

  };

}


/* =========================================================
   ADAPTIVE SCHEDULER
========================================================= */

function nextInterval(){

  if(
    Date.now() <
    hotUntil
  ){

    return HOT_SCAN_MS;

  }


  if(
    isActiveWindow()
  ){

    return ACTIVE_SCAN_MS;

  }


  return OFF_WINDOW_SCAN_MS;

}


function scheduleNext(){

  if(
    !started
  ){

    return;

  }


  const delay =
    nextInterval();


  state.nextCheck =
    new Date(
      Date.now() +
      delay
    )
      .toISOString();


  clearTimeout(
    timer
  );


  timer =
    setTimeout(
      async () => {

        try{

          await scan();


        }catch(error){

          state.lastError =
            error.message;

        }


        scheduleNext();

      },
      delay
    );


  timer.unref?.();

}


/* =========================================================
   START
========================================================= */

async function start(
  options = {}
) {

  if(
    started
  ){

    return getState();

  }


  started =
    true;


  alertHandler =
    typeof options.onAlert ===
      "function"
      ? options.onAlert
      : null;


  try{

    await scan();


  }catch(error){

    state.lastError =
      error.message;

  }


  scheduleNext();


  return getState();

}


/* =========================================================
   STOP
========================================================= */

function stop(){

  started =
    false;


  clearTimeout(
    timer
  );


  timer =
    null;

}


/* =========================================================
   EXTERNAL BROWSER SENSOR INGEST
========================================================= */

async function ingestSignal(
  signal
) {

  return processSignal(
    signal
  );

}


/* =========================================================
   HEARTBEAT INGEST
========================================================= */

async function heartbeat(
  data = {}
) {

  return processSignal({

    type:
      "HEARTBEAT",

    source:
      "browser-sensor",

    sensorId:
      data.sensorId ||
      null,

    version:
      data.version ||
      null,

    userAgent:
      data.userAgent ||
      null,

    at:
      nowIso()

  });

}


/* =========================================================
   PUBLIC STATE
========================================================= */

function getState(){

  refreshState();


  return JSON.parse(
    JSON.stringify(
      state
    )
  );

}


function getProducts(){

  return JSON.parse(
    JSON.stringify(
      Array.from(
        products.values()
      )
        .sort(
          (a,b) =>
            new Date(
              b.lastSeen ||
              0
            ) -
            new Date(
              a.lastSeen ||
              0
            )
        )
    )
  );

}


function getActivity(){

  return JSON.parse(
    JSON.stringify(
      events.slice(
        0,
        150
      )
    )
  );

}


/* =========================================================
   CONFIG
========================================================= */

function getConfig(){

  return {

    priority:
      "highest",

    timeZone:
      TIME_ZONE,

    activeWindow: {

      days:
        [
          "Tuesday",
          "Wednesday",
          "Thursday"
        ],

      startHour:
        ACTIVE_START_HOUR,

      endHour:
        ACTIVE_END_HOUR

    },

    peakWindow: {

      startHour:
        PEAK_START_HOUR,

      endHour:
        PEAK_END_HOUR,

      note:
        "Historical readiness weighting only; not a guaranteed drop window."

    },

    activeScanSeconds:
      Math.round(
        ACTIVE_SCAN_MS /
        1000
      ),

    hotScanSeconds:
      Math.round(
        HOT_SCAN_MS /
        1000
      ),

    hotMinutes:
      Math.round(
        HOT_HOLD_MS /
        60000
      ),

    sentinelMinutes:
      Math.round(
        OFF_WINDOW_SCAN_MS /
        60000
      ),

    sensorStaleMinutes:
      Math.round(
        SENSOR_STALE_MS /
        60000
      ),

    supportSources: [
      ...SUPPORT_URLS
    ],

    capabilities: [

      "browser sensor heartbeat",

      "new product detection",

      "new product URL detection",

      "SKU/product ID change detection",

      "image change detection",

      "price change detection",

      "availability change detection",

      "queue signal detection",

      "official preorder/support-page change detection",

      "multi-signal confidence scoring",

      "estimated readiness windows",

      "duplicate alert suppression",

      "multi-device broadcast push support"

    ],

    accessPolicy:
      "Public and user-visible signals only. No CAPTCHA, queue, authentication, anti-bot, or access-control bypass."

  };

}


/* =========================================================
   EXPORTS
========================================================= */

module.exports = {

  start,

  stop,

  scan,

  ingestSignal,

  heartbeat,

  getState,

  getProducts,

  getActivity,

  getConfig

};
