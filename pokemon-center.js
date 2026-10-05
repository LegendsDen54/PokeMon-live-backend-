"use strict";

const crypto = require("crypto");


/* =========================================================
   POKÉMON CENTER HIGH-PRIORITY ACTIVITY MONITOR

   PUBLIC SURFACES ONLY.

   Watches for:
   - new product URLs
   - new product records
   - product-name changes
   - SKU / product-ID changes
   - image changes
   - price changes
   - availability changes
   - preorder / Add-to-Cart transitions
   - category/catalog changes
   - sitemap changes
   - Queue / waiting-room signals

   Also records source-by-source diagnostics:
   - HTTP status
   - final URL
   - content type
   - response size
   - redirect result
   - queue detection
   - timeout / fetch error
========================================================= */


const BASE_URL =
  String(
    process.env.POKEMON_CENTER_BASE_URL ||
    "https://www.pokemoncenter.com"
  )
    .replace(
      /\/$/,
      ""
    );


const NORMAL_SCAN_MS =
  Math.max(
    15000,
    Number(
      process.env.POKEMON_CENTER_SCAN_SECONDS ||
      20
    ) * 1000
  );


const HOT_SCAN_MS =
  Math.max(
    5000,
    Number(
      process.env.POKEMON_CENTER_HOT_SCAN_SECONDS ||
      8
    ) * 1000
  );


const HOT_HOLD_MS =
  Math.max(
    5 * 60 * 1000,
    Number(
      process.env.POKEMON_CENTER_HOT_MINUTES ||
      15
    ) * 60 * 1000
  );


const REQUEST_TIMEOUT_MS =
  Math.max(
    4000,
    Number(
      process.env.POKEMON_CENTER_TIMEOUT_MS ||
      9000
    )
  );


const NORMAL_DEEP_SCAN_LIMIT =
  Math.max(
    2,
    Number(
      process.env.POKEMON_CENTER_DEEP_PAGES ||
      6
    )
  );


const HOT_DEEP_SCAN_LIMIT =
  Math.max(
    NORMAL_DEEP_SCAN_LIMIT,
    Number(
      process.env.POKEMON_CENTER_HOT_DEEP_PAGES ||
      12
    )
  );


const MAX_TRACKED_PRODUCTS =
  Math.max(
    250,
    Number(
      process.env.POKEMON_CENTER_MAX_PRODUCTS ||
      2500
    )
  );


const SOURCE_URLS = [
  `${BASE_URL}/`,
  `${BASE_URL}/category/new-releases`,
  `${BASE_URL}/category/trading-card-game`,
  `${BASE_URL}/sitemap.xml`,
  `${BASE_URL}/robots.txt`
];


const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Version/18.0 Mobile/15E148 Safari/604.1";


/* =========================================================
   STATE
========================================================= */

let running =
  false;

let started =
  false;

let timer =
  null;

let alertHandler =
  null;

let baselineReady =
  false;

let hotUntil =
  0;

let lastAlertFingerprint =
  null;


const sourceFingerprints =
  new Map();


const sourceHealth =
  new Map();


const productSnapshots =
  new Map();


const trackedProductUrls =
  new Map();


const activityLog =
  [];


let state = {

  ok:
    false,

  running:
    false,

  priority:
    "highest",

  level:
    "normal",

  queueActive:
    false,

  hotMode:
    false,

  normalScanSeconds:
    Math.round(
      NORMAL_SCAN_MS /
      1000
    ),

  hotScanSeconds:
    Math.round(
      HOT_SCAN_MS /
      1000
    ),

  lastChecked:
    null,

  lastSuccess:
    null,

  nextCheck:
    null,

  lastError:
    null,

  sourceCount:
    SOURCE_URLS.length,

  sourceHealth:
    [],

  trackedProductCount:
    0,

  changedProductCount:
    0,

  liveProductCount:
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


function normalizeText(
  value
) {

  return String(
    value ||
    ""
  )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
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


function hash(
  value
) {

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      String(
        value ||
        ""
      )
    )
    .digest(
      "hex"
    );

}


function absoluteUrl(
  value
) {

  if(
    !value
  ){

    return null;

  }


  try{

    const url =
      new URL(
        String(
          value
        ),
        `${BASE_URL}/`
      );


    if(
      url.hostname !==
      new URL(
        BASE_URL
      ).hostname
    ){

      return null;

    }


    url.hash =
      "";


    return url
      .toString();


  }catch{

    return null;

  }

}


/* =========================================================
   PRODUCT URL DETECTION
========================================================= */

function looksLikeProductUrl(
  value
) {

  const url =
    absoluteUrl(
      value
    );


  if(
    !url
  ){

    return false;

  }


  const path =
    new URL(
      url
    )
      .pathname
      .toLowerCase();


  return (

    path.includes(
      "/product/"
    ) ||

    path.includes(
      "/products/"
    ) ||

    path.includes(
      "/item/"
    ) ||

    /\/[^/]+-\d{4,}(?:\/|$)/
      .test(
        path
      )

  );

}


/* =========================================================
   QUEUE DETECTION
========================================================= */

function queueSignals(
  response,
  body
) {

  const finalUrl =
    String(
      response?.url ||
      ""
    )
      .toLowerCase();


  const text =
    String(
      body ||
      ""
    )
      .toLowerCase();


  const markers = [

    "queue-it",

    "queueit",

    "virtual queue",

    "waiting room",

    "you are in line",

    "queueittoken",

    "queue id",

    "queue-id"

  ];


  const matched =
    markers.filter(
      marker =>
        finalUrl.includes(
          marker
        ) ||
        text.includes(
          marker
        )
    );


  return {

    active:
      matched.length >
      0,

    markers:
      matched

  };

}


/* =========================================================
   SOURCE HEALTH
========================================================= */

function recordSourceHealth(
  url,
  data
) {

  sourceHealth.set(
    url,
    {

      url,

      checkedAt:
        nowIso(),

      ok:
        Boolean(
          data?.ok
        ),

      status:
        data?.status ??
        null,

      finalUrl:
        data?.finalUrl ||
        data?.url ||
        null,

      contentType:
        data?.contentType ||
        null,

      responseBytes:
        Number(
          data?.responseBytes ||
          0
        ),

      queueActive:
        Boolean(
          data?.queueActive
        ),

      queueMarkers:
        Array.isArray(
          data?.queueMarkers
        )
          ? data.queueMarkers
          : [],

      redirected:
        Boolean(
          data?.redirected
        ),

      error:
        data?.error ||
        null

    }
  );

}


function getSourceHealth(){

  return SOURCE_URLS.map(
    url =>
      sourceHealth.get(
        url
      ) ||
      {

        url,

        checkedAt:
          null,

        ok:
          false,

        status:
          null,

        finalUrl:
          null,

        contentType:
          null,

        responseBytes:
          0,

        queueActive:
          false,

        queueMarkers:
          [],

        redirected:
          false,

        error:
          "Not checked yet"

      }
  );

}


/* =========================================================
   NETWORK
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

          method:
            "GET",

          redirect:
            "follow",

          cache:
            "no-store",

          signal:
            controller.signal,

          headers: {

            "user-agent":
              USER_AGENT,

            "accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

            "accept-language":
              "en-US,en;q=0.9",

            "cache-control":
              "no-cache",

            "pragma":
              "no-cache"

          }

        }
      );


    const text =
      await response
        .text();


    const queue =
      queueSignals(
        response,
        text
      );


    const result = {

      ok:
        response.ok,

      status:
        response.status,

      url:
        response.url ||
        url,

      finalUrl:
        response.url ||
        url,

      redirected:
        Boolean(
          response.redirected
        ),

      contentType:
        response.headers.get(
          "content-type"
        ) ||
        "",

      etag:
        response.headers.get(
          "etag"
        ) ||
        null,

      lastModified:
        response.headers.get(
          "last-modified"
        ) ||
        null,

      responseBytes:
        Buffer.byteLength(
          text,
          "utf8"
        ),

      text,

      queue

    };


    recordSourceHealth(
      url,
      {

        ok:
          result.ok,

        status:
          result.status,

        finalUrl:
          result.finalUrl,

        contentType:
          result.contentType,

        responseBytes:
          result.responseBytes,

        queueActive:
          result.queue.active,

        queueMarkers:
          result.queue.markers,

        redirected:
          result.redirected,

        error:
          null

      }
    );


    return result;


  }catch(error){

    const message =
      error?.name ===
        "AbortError"
        ? `Timed out after ${REQUEST_TIMEOUT_MS}ms`
        : (
            error?.message ||
            String(
              error
            )
          );


    recordSourceHealth(
      url,
      {

        ok:
          false,

        status:
          null,

        finalUrl:
          null,

        contentType:
          null,

        responseBytes:
          0,

        queueActive:
          false,

        queueMarkers:
          [],

        redirected:
          false,

        error:
          message

      }
    );


    throw new Error(
      message
    );


  }finally{

    clearTimeout(
      timeout
    );

  }

}


/* =========================================================
   URL EXTRACTION
========================================================= */

function extractSitemapUrls(
  text
) {

  const output =
    [];


  const regex =
    /<loc>\s*([^<]+)\s*<\/loc>/gi;


  let match;


  while(
    (
      match =
        regex.exec(
          String(
            text ||
            ""
          )
        )
    )
  ){

    const url =
      absoluteUrl(
        match[1]
      );


    if(
      url
    ){

      output.push(
        url
      );

    }

  }


  return output;

}


function extractHrefUrls(
  text
) {

  const output =
    [];


  const regex =
    /href\s*=\s*["']([^"']+)["']/gi;


  let match;


  while(
    (
      match =
        regex.exec(
          String(
            text ||
            ""
          )
        )
    )
  ){

    const url =
      absoluteUrl(
        match[1]
      );


    if(
      url
    ){

      output.push(
        url
      );

    }

  }


  return output;

}


/* =========================================================
   IMAGE EXTRACTION
========================================================= */

function extractImageUrls(
  text
) {

  const output =
    new Set();


  const source =
    String(
      text ||
      ""
    );


  const regex =
    /(?:src|srcset|image|imageUrl|imageURL)["'\s:=]+["']?([^"'\s,}<>]+\.(?:png|jpe?g|webp)(?:\?[^"'\s,}<>]*)?)/gi;


  let match;


  while(
    (
      match =
        regex.exec(
          source
        )
    )
  ){

    try{

      const value =
        new URL(
          match[1],
          `${BASE_URL}/`
        )
          .toString();


      output.add(
        value
      );


    }catch{

      /*
        Ignore malformed image URLs.
      */

    }

  }


  return Array
    .from(
      output
    )
    .slice(
      0,
      200
    );

}


/* =========================================================
   PRICE
========================================================= */

function parsePrice(
  value
) {

  if(
    value ===
      null ||
    value ===
      undefined
  ){

    return null;

  }


  const match =
    String(
      value
    )
      .replace(
        /,/g,
        ""
      )
      .match(
        /\d+(?:\.\d{1,2})?/
      );


  if(
    !match
  ){

    return null;

  }


  const number =
    Number(
      match[0]
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;

}


/* =========================================================
   STRUCTURED DATA HELPERS
========================================================= */

function arrayValue(
  value
) {

  if(
    Array.isArray(
      value
    )
  ){

    return value;

  }


  if(
    value ===
      null ||
    value ===
      undefined
  ){

    return [];

  }


  return [
    value
  ];

}


function firstString(
  ...values
) {

  for(
    const value of
    values.flatMap(
      arrayValue
    )
  ){

    if(
      typeof value ===
        "string" &&
      value.trim()
    ){

      return normalizeText(
        value
      );

    }

  }


  return null;

}


/* =========================================================
   STRUCTURED PRODUCT WALKER
========================================================= */

function walkStructured(
  value,
  output,
  depth = 0
) {

  if(
    !value ||
    depth >
      12
  ){

    return;

  }


  if(
    Array.isArray(
      value
    )
  ){

    for(
      const item of
      value
    ){

      walkStructured(
        item,
        output,
        depth + 1
      );

    }


    return;

  }


  if(
    typeof value !==
    "object"
  ){

    return;

  }


  const type =
    firstString(
      value["@type"],
      value.type
    );


  const name =
    firstString(
      value.name,
      value.productName,
      value.title,
      value.displayName
    );


  const sku =
    firstString(
      value.sku,
      value.SKU,
      value.productId,
      value.productID,
      value.itemId,
      value.id
    );


  const url =
    absoluteUrl(
      firstString(
        value.url,
        value.productUrl,
        value.canonicalUrl
      )
    );


  const image =
    firstString(
      value.image,
      value.imageUrl,
      value.imageURL,
      value.primaryImage,
      value.thumbnail
    );


  let offers =
    value.offers ||
    value.offer ||
    null;


  if(
    Array.isArray(
      offers
    )
  ){

    offers =
      offers[0] ||
      null;

  }


  const price =
    parsePrice(

      offers?.price ??

      offers?.lowPrice ??

      value.price ??

      value.salePrice ??

      value.currentPrice

    );


  const availability =
    firstString(
      offers?.availability,
      value.availability,
      value.inventoryStatus,
      value.stockStatus,
      value.status
    );


  const productish =

    String(
      type ||
      ""
    )
      .toLowerCase()
      .includes(
        "product"
      ) ||

    Boolean(
      sku &&
      name
    ) ||

    Boolean(
      url &&
      looksLikeProductUrl(
        url
      )
    );


  if(
    productish &&
    (
      name ||
      sku ||
      url
    )
  ){

    output.push({

      name,

      sku,

      url,

      image:
        image ||
        null,

      price,

      availability,

      rawType:
        type ||
        null

    });

  }


  for(
    const child of
    Object.values(
      value
    )
  ){

    if(
      child &&
      typeof child ===
        "object"
    ){

      walkStructured(
        child,
        output,
        depth + 1
      );

    }

  }

}


/* =========================================================
   JSON SCRIPT EXTRACTION
========================================================= */

function extractJsonScriptObjects(
  html
) {

  const objects =
    [];


  const source =
    String(
      html ||
      ""
    );


  const scriptRegex =
    /<script\b[^>]*>([\s\S]*?)<\/script>/gi;


  let match;


  while(
    (
      match =
        scriptRegex.exec(
          source
        )
    )
  ){

    const body =
      String(
        match[1] ||
        ""
      )
        .trim();


    if(
      !body ||
      body.length >
        8000000
    ){

      continue;

    }


    const candidates =
      [];


    if(
      body.startsWith(
        "{"
      ) ||
      body.startsWith(
        "["
      )
    ){

      candidates.push(
        body
      );

    }


    const assignment =
      body.match(
        /=\s*({[\s\S]*}|\[[\s\S]*\])\s*;?\s*$/
      );


    if(
      assignment?.[1]
    ){

      candidates.push(
        assignment[1]
      );

    }


    for(
      const candidate of
      candidates
    ){

      try{

        objects.push(
          JSON.parse(
            candidate
          )
        );


      }catch{

        /*
          Script is not plain JSON.
        */

      }

    }

  }


  return objects;

}


/* =========================================================
   PRODUCT EXTRACTION
========================================================= */

function extractProducts(
  html,
  pageUrl
) {

  const products =
    [];


  for(
    const object of
    extractJsonScriptObjects(
      html
    )
  ){

    walkStructured(
      object,
      products
    );

  }


  const source =
    String(
      html ||
      ""
    );


  const nameMatch =
    source.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    );


  const imageMatch =
    source.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    );


  const skuMatch =
    source.match(
      /(?:"sku"|SKU|sku)\s*[:=]\s*["']([^"']+)["']/i
    );


  const priceMatch =
    source.match(
      /(?:"price"|price)\s*[:=]\s*["']?\$?([0-9]+(?:\.[0-9]{1,2})?)/i
    );


  if(
    looksLikeProductUrl(
      pageUrl
    ) &&
    (
      nameMatch ||
      skuMatch
    )
  ){

    products.push({

      name:
        nameMatch
          ? normalizeText(
              nameMatch[1]
            )
          : null,

      sku:
        skuMatch
          ? normalizeText(
              skuMatch[1]
            )
          : null,

      url:
        pageUrl,

      image:
        imageMatch
          ? imageMatch[1]
          : null,

      price:
        priceMatch
          ? parsePrice(
              priceMatch[1]
            )
          : null,

      availability:
        null,

      rawType:
        "page-meta"

    });

  }


  const unique =
    new Map();


  for(
    const item of
    products
  ){

    const url =
      absoluteUrl(
        item.url ||
        pageUrl
      );


    const key =
      String(

        item.sku ||

        url ||

        item.name ||

        ""

      )
        .toLowerCase();


    if(
      !key
    ){

      continue;

    }


    const current =
      unique.get(
        key
      ) ||
      {};


    unique.set(
      key,
      {

        name:
          item.name ||
          current.name ||
          null,

        sku:
          item.sku ||
          current.sku ||
          null,

        url:
          url ||
          current.url ||
          null,

        image:
          item.image ||
          current.image ||
          null,

        price:
          item.price ??
          current.price ??
          null,

        availability:
          item.availability ||
          current.availability ||
          null,

        rawType:
          item.rawType ||
          current.rawType ||
          null

      }
    );

  }


  return Array.from(
    unique.values()
  );

}


/* =========================================================
   LIVE PRODUCT DETECTION
========================================================= */

function isLiveProduct(
  product,
  pageText = ""
) {

  const availability =
    String(
      product?.availability ||
      ""
    )
      .toLowerCase();


  const text =
    String(
      pageText ||
      ""
    )
      .toLowerCase();


  if(
    availability.includes(
      "instock"
    ) ||

    availability.includes(
      "in stock"
    ) ||

    availability.includes(
      "preorder"
    ) ||

    availability.includes(
      "pre-order"
    )
  ){

    return true;

  }


  return (

    /\badd to cart\b/
      .test(
        text
      ) ||

    /\bpreorder:\s*add to (?:cart|basket)\b/
      .test(
        text
      ) ||

    /\bpre-order:\s*add to (?:cart|basket)\b/
      .test(
        text
      )

  );

}


/* =========================================================
   PRODUCT SNAPSHOTS
========================================================= */

function snapshotForProduct(
  product,
  pageText = ""
) {

  const images =
    extractImageUrls(
      pageText
    );


  const snapshot = {

    name:
      product?.name ||
      null,

    sku:
      product?.sku ||
      null,

    url:
      absoluteUrl(
        product?.url
      ),

    image:
      product?.image ||
      images[0] ||
      null,

    images:
      images.slice(
        0,
        25
      ),

    price:
      product?.price ??
      null,

    availability:
      product?.availability ||
      null,

    live:
      isLiveProduct(
        product,
        pageText
      ),

    checkedAt:
      nowIso()

  };


  snapshot.fingerprint =
    hash(
      JSON.stringify({

        name:
          snapshot.name,

        sku:
          snapshot.sku,

        url:
          snapshot.url,

        image:
          snapshot.image,

        images:
          snapshot.images,

        price:
          snapshot.price,

        availability:
          snapshot.availability,

        live:
          snapshot.live

      })
    );


  return snapshot;

}


/* =========================================================
   CHANGE DETECTION
========================================================= */

function describeProductChanges(
  previous,
  current
) {

  const fields = [

    "name",

    "sku",

    "url",

    "image",

    "price",

    "availability",

    "live"

  ];


  const changed =
    [];


  for(
    const field of
    fields
  ){

    if(
      JSON.stringify(
        previous?.[field] ??
        null
      ) !==
      JSON.stringify(
        current?.[field] ??
        null
      )
    ){

      changed.push(
        field
      );

    }

  }


  if(
    JSON.stringify(
      previous?.images ||
      []
    ) !==
    JSON.stringify(
      current?.images ||
      []
    )
  ){

    changed.push(
      "images"
    );

  }


  return changed;

}


/* =========================================================
   TRACK PRODUCT URL
========================================================= */

function rememberProductUrl(
  url,
  source =
    "discovered"
) {

  const normalized =
    absoluteUrl(
      url
    );


  if(
    !normalized ||
    !looksLikeProductUrl(
      normalized
    )
  ){

    return false;

  }


  const existing =
    trackedProductUrls.get(
      normalized
    );


  trackedProductUrls.set(
    normalized,
    {

      url:
        normalized,

      source:
        existing?.source ||
        source,

      discoveredAt:
        existing?.discoveredAt ||
        nowIso(),

      lastSeen:
        nowIso(),

      lastScanned:
        existing?.lastScanned ||
        null

    }
  );


  if(
    trackedProductUrls.size >
    MAX_TRACKED_PRODUCTS
  ){

    const oldest =
      Array
        .from(
          trackedProductUrls.values()
        )
        .sort(
          (a,b) =>
            new Date(
              a.lastSeen
            ) -
            new Date(
              b.lastSeen
            )
        )
        .slice(
          0,
          trackedProductUrls.size -
          MAX_TRACKED_PRODUCTS
        );


    for(
      const entry of
      oldest
    ){

      trackedProductUrls.delete(
        entry.url
      );


      productSnapshots.delete(
        entry.url
      );

    }

  }


  return !existing;

}


/* =========================================================
   ACTIVITY LOG
========================================================= */

function addActivity(
  event
) {

  const full = {

    id:
      hash(
        `${
          event.type
        }|${
          event.url ||
          ""
        }|${
          event.name ||
          ""
        }|${
          event.at ||
          nowIso()
        }|${
          activityLog.length
        }`
      ),

    at:
      event.at ||
      nowIso(),

    priority:
      event.priority ||
      "important",

    ...event

  };


  activityLog.unshift(
    full
  );


  if(
    activityLog.length >
    150
  ){

    activityLog.length =
      150;

  }


  return full;

}


/* =========================================================
   PUBLIC PAGE FINGERPRINT
========================================================= */

function pageSignalFingerprint(
  result
) {

  const links =
    extractHrefUrls(
      result.text
    )
      .filter(
        looksLikeProductUrl
      )
      .sort();


  const sitemap =
    extractSitemapUrls(
      result.text
    )
      .filter(
        looksLikeProductUrl
      )
      .sort();


  const products =
    extractProducts(
      result.text,
      result.url
    )
      .map(
        item => ({

          name:
            item.name,

          sku:
            item.sku,

          url:
            item.url,

          image:
            item.image,

          price:
            item.price,

          availability:
            item.availability

        })
      )
      .sort(
        (a,b) =>
          String(
            a.url ||
            a.sku ||
            a.name
          )
            .localeCompare(
              String(
                b.url ||
                b.sku ||
                b.name
              )
            )
      );


  return {

    fingerprint:
      hash(
        JSON.stringify({

          status:
            result.status,

          finalUrl:
            result.url,

          etag:
            result.etag,

          lastModified:
            result.lastModified,

          queue:
            result.queue,

          links,

          sitemap,

          products

        })
      ),

    links:
      Array.from(
        new Set([
          ...links,
          ...sitemap
        ])
      ),

    products

  };

}


/* =========================================================
   DEEP SCAN QUEUE
========================================================= */

function chooseDeepScanUrls(
  limit
) {

  return Array
    .from(
      trackedProductUrls.values()
    )
    .sort(
      (a,b) => {

        if(
          !a.lastScanned &&
          b.lastScanned
        ){

          return -1;

        }


        if(
          a.lastScanned &&
          !b.lastScanned
        ){

          return 1;

        }


        return (
          new Date(
            a.lastScanned ||
            0
          ) -
          new Date(
            b.lastScanned ||
            0
          )
        );

      }
    )
    .slice(
      0,
      limit
    )
    .map(
      item =>
        item.url
    );

}


/* =========================================================
   CONCURRENCY HELPER
========================================================= */

async function mapLimit(
  values,
  limit,
  worker
) {

  if(
    !values.length
  ){

    return [];

  }


  const output =
    new Array(
      values.length
    );


  let next =
    0;


  async function run(){

    while(
      true
    ){

      const index =
        next++;


      if(
        index >=
        values.length
      ){

        return;

      }


      output[index] =
        await worker(
          values[index],
          index
        );

    }

  }


  await Promise.all(

    Array.from(
      {
        length:
          Math.min(
            limit,
            values.length
          )
      },

      () =>
        run()
    )

  );


  return output;

}


/* =========================================================
   SIGNAL LEVELS
========================================================= */

function levelRank(
  level
) {

  return ({

    normal:
      0,

    backend_activity:
      1,

    drop_likely:
      2,

    live:
      3

  })[level] ??
  0;

}


function deriveLevel(
  events,
  queueActive
) {

  if(
    events.some(
      event =>
        event.type ===
        "PRODUCT_LIVE"
    )
  ){

    return "live";

  }


  const strong =
    events.filter(
      event =>
        [

          "QUEUE_ACTIVE",

          "NEW_PRODUCT",

          "NEW_PRODUCT_URL",

          "PRODUCT_CHANGED"

        ]
          .includes(
            event.type
          )
    );


  if(
    queueActive ||
    strong.length >=
    2
  ){

    return "drop_likely";

  }


  if(
    events.length
  ){

    return "backend_activity";

  }


  return "normal";

}


/* =========================================================
   PUSH ALERTS
========================================================= */

async function sendAlert(
  level,
  events
) {

  if(
    !alertHandler ||
    !events.length
  ){

    return;

  }


  const important =
    events
      .filter(
        event =>
          event.type !==
          "SOURCE_CHANGED"
      )
      .slice(
        0,
        5
      );


  const visible =
    important.length
      ? important
      : events.slice(
          0,
          3
        );


  const names =
    visible
      .map(
        event =>
          event.name ||
          event.detail ||
          event.type
      )
      .filter(
        Boolean
      );


  const fingerprint =
    hash(
      JSON.stringify({

        level,

        names,

        types:
          visible.map(
            event =>
              event.type
          ),

        urls:
          visible.map(
            event =>
              event.url ||
              null
          )

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


  let title =
    "⚡ Pokémon Center Backend Activity";


  if(
    level ===
    "drop_likely"
  ){

    title =
      "🚨 POKÉMON CENTER DROP LIKELY";

  }


  if(
    level ===
    "live"
  ){

    title =
      "🔥 POKÉMON CENTER LIVE";

  }


  const body =
    names.length
      ? names
          .slice(
            0,
            3
          )
          .join(
            " • "
          )
      : "New Pokémon Center activity was detected.";


  const target =
    visible.find(
      event =>
        event.url
    )
      ?.url ||
    BASE_URL;


  await alertHandler({

    title,

    body,

    url:
      target,

    icon:
      "https://pokemon-live-backend.onrender.com/app-icon.png",

    badge:
      "https://pokemon-live-backend.onrender.com/app-icon.png",

    tag:
      `pokemon-center-${level}-${fingerprint.slice(0,12)}`

  });

}


/* =========================================================
   PUBLIC SOURCE SCAN
========================================================= */

async function scanSource(
  url,
  events
) {

  try{

    const result =
      await fetchText(
        url
      );


    if(
      result.queue.active
    ){

      events.push(
        addActivity({

          type:
            "QUEUE_ACTIVE",

          priority:
            "critical",

          url:
            result.url,

          detail:
            `Queue signal detected: ${
              result.queue.markers.join(
                ", "
              )
            }`

        })
      );

    }


    if(
      result.status ===
      429
    ){

      events.push(
        addActivity({

          type:
            "RATE_LIMITED",

          priority:
            "important",

          url,

          detail:
            "Pokémon Center returned HTTP 429. Scanner will not attempt to bypass the limit."

        })
      );

    }


    const signals =
      pageSignalFingerprint(
        result
      );


    const previousFingerprint =
      sourceFingerprints.get(
        url
      );


    if(
      baselineReady &&
      previousFingerprint &&
      previousFingerprint !==
        signals.fingerprint
    ){

      events.push(
        addActivity({

          type:
            "SOURCE_CHANGED",

          priority:
            "important",

          url,

          detail:
            `Public Pokémon Center source changed (${result.status}).`

        })
      );

    }


    sourceFingerprints.set(
      url,
      signals.fingerprint
    );


    for(
      const productUrl of
      signals.links
    ){

      const isNew =
        rememberProductUrl(
          productUrl,
          url
        );


      if(
        baselineReady &&
        isNew
      ){

        events.push(
          addActivity({

            type:
              "NEW_PRODUCT_URL",

            priority:
              "critical",

            url:
              productUrl,

            detail:
              "New Pokémon Center product URL became publicly discoverable."

          })
        );

      }

    }


    for(
      const product of
      signals.products
    ){

      if(
        product.url
      ){

        rememberProductUrl(
          product.url,
          url
        );

      }

    }


    return {

      ok:
        result.ok,

      status:
        result.status,

      queue:
        result.queue.active,

      finalUrl:
        result.url,

      responseBytes:
        result.responseBytes

    };


  }catch(error){

    return {

      ok:
        false,

      status:
        null,

      queue:
        false,

      error:
        error.message

    };

  }

}


/* =========================================================
   PRODUCT PAGE SCAN
========================================================= */

async function scanProductPage(
  url,
  events
) {

  const tracked =
    trackedProductUrls.get(
      url
    );


  if(
    tracked
  ){

    tracked.lastScanned =
      nowIso();

  }


  try{

    const result =
      await fetchText(
        url
      );


    if(
      result.queue.active
    ){

      events.push(
        addActivity({

          type:
            "QUEUE_ACTIVE",

          priority:
            "critical",

          url:
            result.url,

          detail:
            `Queue signal detected while checking product page: ${
              result.queue.markers.join(
                ", "
              )
            }`

        })
      );

    }


    const extracted =
      extractProducts(
        result.text,
        result.url
      );


    const product =
      extracted[0] ||
      {

        name:
          null,

        sku:
          null,

        url:
          result.url,

        image:
          null,

        price:
          null,

        availability:
          null

      };


    const snapshot =
      snapshotForProduct(
        product,
        result.text
      );


    const previous =
      productSnapshots.get(
        url
      );


    if(
      !previous
    ){

      productSnapshots.set(
        url,
        snapshot
      );


      if(
        baselineReady
      ){

        events.push(
          addActivity({

            type:
              "NEW_PRODUCT",

            priority:
              "critical",

            url:
              snapshot.url ||
              url,

            name:
              snapshot.name ||
              "New Pokémon Center product",

            sku:
              snapshot.sku,

            detail:
              "New product record became publicly visible."

          })
        );

      }


      if(
        baselineReady &&
        snapshot.live
      ){

        events.push(
          addActivity({

            type:
              "PRODUCT_LIVE",

            priority:
              "critical",

            url:
              snapshot.url ||
              url,

            name:
              snapshot.name ||
              "Pokémon Center product",

            sku:
              snapshot.sku,

            detail:
              "Product is publicly purchasable or preorderable."

          })
        );

      }


      return;

    }


    if(
      previous.fingerprint !==
      snapshot.fingerprint
    ){

      const changedFields =
        describeProductChanges(
          previous,
          snapshot
        );


      productSnapshots.set(
        url,
        snapshot
      );


      events.push(
        addActivity({

          type:
            "PRODUCT_CHANGED",

          priority:
            "critical",

          url:
            snapshot.url ||
            url,

          name:
            snapshot.name ||
            previous.name ||
            "Pokémon Center product",

          sku:
            snapshot.sku ||
            previous.sku ||
            null,

          fields:
            changedFields,

          detail:
            `Product backend fields changed: ${
              changedFields.join(
                ", "
              ) ||
              "unknown"
            }.`

        })
      );


      if(
        !previous.live &&
        snapshot.live
      ){

        events.push(
          addActivity({

            type:
              "PRODUCT_LIVE",

            priority:
              "critical",

            url:
              snapshot.url ||
              url,

            name:
              snapshot.name ||
              previous.name ||
              "Pokémon Center product",

            sku:
              snapshot.sku ||
              previous.sku ||
              null,

            detail:
              "Product transitioned to purchasable/preorderable."

          })
        );

      }

    }


  }catch{

    /*
      A single product page failure
      does not interrupt the monitor.
    */

  }

}


/* =========================================================
   PRODUCT LIST
========================================================= */

function productList(){

  return Array
    .from(
      productSnapshots.values()
    )
    .sort(
      (a,b) =>
        new Date(
          b.checkedAt
        ) -
        new Date(
          a.checkedAt
        )
    )
    .slice(
      0,
      250
    );

}


/* =========================================================
   PUBLIC STATE
========================================================= */

function publicState(){

  return JSON.parse(
    JSON.stringify({

      ...state,

      sourceHealth:
        getSourceHealth(),

      trackedProductCount:
        trackedProductUrls.size,

      latestEvents:
        activityLog.slice(
          0,
          25
        ),

      products:
        productList()

    })
  );

}


/* =========================================================
   MAIN SCAN
========================================================= */

async function scan(){

  if(
    running
  ){

    return {

      ...publicState(),

      skipped:
        true,

      reason:
        "Pokémon Center scan already running"

    };

  }


  running =
    true;


  const scanStarted =
    Date.now();


  const events =
    [];


  state = {

    ...state,

    running:
      true,

    lastChecked:
      nowIso(),

    lastError:
      null

  };


  try{

    const sourceResults =
      await mapLimit(

        SOURCE_URLS,

        2,

        url =>
          scanSource(
            url,
            events
          )

      );


    const successfulSources =
      sourceResults.filter(
        result =>
          result?.ok ===
          true
      );


    const queueActive =
      sourceResults.some(
        result =>
          result?.queue ===
          true
      );


    const hot =
      Date.now() <
        hotUntil ||
      queueActive;


    const deepLimit =
      hot
        ? HOT_DEEP_SCAN_LIMIT
        : NORMAL_DEEP_SCAN_LIMIT;


    const deepUrls =
      chooseDeepScanUrls(
        deepLimit
      );


    await mapLimit(

      deepUrls,

      3,

      url =>
        scanProductPage(
          url,
          events
        )

    );


    const meaningfulEvents =
      events.filter(
        event =>
          event.type !==
          "RATE_LIMITED"
      );


    const level =
      deriveLevel(
        meaningfulEvents,
        queueActive
      );


    if(
      levelRank(
        level
      ) >=
      levelRank(
        "backend_activity"
      )
    ){

      hotUntil =
        Date.now() +
        HOT_HOLD_MS;

    }


    const hotMode =
      Date.now() <
      hotUntil;


    const products =
      productList();


    const health =
      getSourceHealth();


    const failureSummary =
      health
        .filter(
          item =>
            !item.ok
        )
        .map(
          item =>
            item.status
              ? `${item.url} => HTTP ${item.status}`
              : `${item.url} => ${item.error || "failed"}`
        )
        .join(
          " | "
        );


    state = {

      ...state,

      ok:
        successfulSources.length >
        0,

      running:
        false,

      priority:
        "highest",

      level,

      queueActive,

      hotMode,

      lastChecked:
        nowIso(),

      lastSuccess:
        successfulSources.length >
        0
          ? nowIso()
          : state.lastSuccess,

      lastError:
        successfulSources.length ===
        0
          ? (
              failureSummary ||
              "All public Pokémon Center sources failed"
            )
          : null,

      sourceCount:
        SOURCE_URLS.length,

      sourceHealth:
        health,

      trackedProductCount:
        trackedProductUrls.size,

      changedProductCount:
        meaningfulEvents.filter(
          event =>
            event.type ===
            "PRODUCT_CHANGED"
        )
          .length,

      liveProductCount:
        products.filter(
          product =>
            product.live
        )
          .length,

      scanDurationMs:
        Date.now() -
        scanStarted,

      latestEvents:
        activityLog.slice(
          0,
          25
        ),

      products

    };


    if(
      !baselineReady
    ){

      baselineReady =
        true;


      state.level =
        "normal";


    }else if(
      meaningfulEvents.length
    ){

      try{

        await sendAlert(
          level,
          meaningfulEvents
        );


      }catch(error){

        state.lastAlertError =
          error.message;

      }

    }


    return publicState();


  }catch(error){

    state = {

      ...state,

      ok:
        false,

      running:
        false,

      lastChecked:
        nowIso(),

      lastError:
        error.message,

      sourceHealth:
        getSourceHealth()

    };


    return publicState();


  }finally{

    running =
      false;

  }

}


/* =========================================================
   ADAPTIVE SCHEDULER
========================================================= */

function scheduleNext(){

  if(
    !started
  ){

    return;

  }


  const interval =
    Date.now() <
    hotUntil
      ? HOT_SCAN_MS
      : NORMAL_SCAN_MS;


  state.nextCheck =
    new Date(
      Date.now() +
      interval
    )
      .toISOString();


  clearTimeout(
    timer
  );


  timer =
    setTimeout(
      async () => {

        await scan();

        scheduleNext();

      },
      interval
    );


  if(
    typeof timer.unref ===
    "function"
  ){

    timer.unref();

  }

}


/* =========================================================
   START
========================================================= */

async function start(
  options = {}
){

  if(
    started
  ){

    return publicState();

  }


  started =
    true;


  alertHandler =
    typeof options.onAlert ===
      "function"
      ? options.onAlert
      : null;


  await scan();


  scheduleNext();


  return publicState();

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
   EXPORTED STATE
========================================================= */

function getState(){

  return publicState();

}


function getProducts(){

  return productList();

}


function getActivity(){

  return activityLog.slice(
    0,
    100
  );

}


function getConfig(){

  return {

    baseUrl:
      BASE_URL,

    priority:
      "highest",

    normalScanSeconds:
      Math.round(
        NORMAL_SCAN_MS /
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

    normalDeepPages:
      NORMAL_DEEP_SCAN_LIMIT,

    hotDeepPages:
      HOT_DEEP_SCAN_LIMIT,

    maxTrackedProducts:
      MAX_TRACKED_PRODUCTS,

    sources: [
      ...SOURCE_URLS
    ],

    accessPolicy:
      "Public Pokémon Center surfaces only. No CAPTCHA, queue, authentication, or access-control bypass."

  };

}


/* =========================================================
   EXPORTS
========================================================= */

module.exports = {

  start,

  stop,

  scan,

  getState,

  getProducts,

  getActivity,

  getConfig

};
