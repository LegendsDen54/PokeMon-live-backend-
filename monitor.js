const fs = require("fs");
const path = require("path");
const push = require("./push");
const discovery = require("./discovery");

const providerName =
  (
    process.env.DATA_PROVIDER ||
    "mock"
  ).toLowerCase();

const provider =
  require(`./${providerName}.js`);

const productFile =
  path.join(
    __dirname,
    "products.json"
  );


/* ========================================
   SCANNER SETTINGS
======================================== */

const SCAN_CONCURRENCY =
  Math.min(
    6,
    Math.max(
      1,
      Number(
        process.env.SCAN_CONCURRENCY ||
        4
      )
    )
  );


/* ========================================
   LIVE STATE
======================================== */

let latest = [];
let lastRun = null;
let running = false;

const stockBaseline =
  new Map();

/*
  Stores last usable product data.

  Temporary Walmart API timeouts can
  reuse display information from this
  cache, but cached data can NEVER
  trigger a restock alert.
*/
const lastGoodResults =
  new Map();


/* ========================================
   PRODUCT LOADING
======================================== */

function loadProducts() {
  return JSON.parse(
    fs.readFileSync(
      productFile,
      "utf8"
    )
  );
}


/* ========================================
   BASIC HELPERS
======================================== */

function getItemKey(item) {
  return [
    item.retailer ||
      "unknown",

    item.productId ||
      "unknown"
  ].join(":");
}


function isTimeoutItem(item) {
  if (!item) {
    return false;
  }

  const message =
    String(
      item.error ||
      ""
    ).toLowerCase();

  return (
    item.source ===
      "walmart-timeout" ||

    message.includes(
      "timed out"
    )
  );
}


function isUsableResult(item) {
  if (!item) {
    return false;
  }

  if (
    isTimeoutItem(item)
  ) {
    return false;
  }

  return Boolean(
    item.image ||
    item.url ||
    item.price != null ||
    item.seller ||
    item.directSeller === true
  );
}


/* ========================================
   DIRECT SELLER RULE
======================================== */

function directSellerOnly(item) {
  if (
    typeof item.directSeller ===
      "boolean"
  ) {
    return item.directSeller;
  }

  if (
    item.retailer ===
    "target"
  ) {
    return (
      item.seller ===
      "Target"
    );
  }

  if (
    item.retailer ===
    "walmart"
  ) {
    return (
      item.seller ===
      "Walmart"
    );
  }

  if (
    item.retailer ===
    "bestbuy"
  ) {
    return (
      item.seller ===
      "Best Buy"
    );
  }

  return false;
}


/* ========================================
   PRICE RULE
======================================== */

function withinPriceRule(item) {

  /*
    Auto-discovered products NEVER qualify
    for alerts until verified MSRP exists.
  */
  if (
    item.autoDiscovered ===
      true &&
    item.msrp == null
  ) {
    return false;
  }

  /*
    Preserve existing behavior when
    live price is temporarily missing.
  */
  if (
    item.price == null
  ) {
    return true;
  }

  /*
    Preserve current behavior for
    curated products without MSRP.
  */
  if (
    item.msrp == null
  ) {
    return true;
  }

  const price =
    Number(
      item.price
    );

  const msrp =
    Number(
      item.msrp
    );

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(msrp) ||
    msrp <= 0
  ) {
    return false;
  }

  /*
    Price rule:
    maximum = 150% of MSRP.

    Example:
    $50 MSRP -> $75 maximum.
  */
  return (
    price <=
    msrp * 1.5
  );
}


/* ========================================
   ITEM PREPARATION
======================================== */

function prepareItem(item) {
  const onlineOnly =
    item.retailer ===
      "walmart" ||
    item.retailer ===
      "target";

  return {
    ...item,

    /*
      Walmart + Target are online-only.
    */
    channel:
      onlineOnly
        ? "online"
        : (
            item.channel ||
            "online"
          ),

    storeId:
      onlineOnly
        ? null
        : (
            item.storeId ??
            null
          ),

    storeName:
      onlineOnly
        ? null
        : (
            item.storeName ??
            null
          ),

    directSeller:
      directSellerOnly(
        item
      ),

    withinPriceRule:
      withinPriceRule(
        item
      )
  };
}


/* ========================================
   SAFE STALE CACHE
======================================== */

function cacheGoodResult(item) {
  if (
    !isUsableResult(item)
  ) {
    return;
  }

  const key =
    getItemKey(
      item
    );

  lastGoodResults.set(
    key,
    {
      ...item
    }
  );
}


function applySafeCache(item) {
  if (
    !isTimeoutItem(item)
  ) {
    return item;
  }

  const key =
    getItemKey(
      item
    );

  const cached =
    lastGoodResults.get(
      key
    );

  /*
    No cached result yet.

    Keep timeout result, but make
    absolutely sure it cannot alert.
  */
  if (!cached) {
    return {
      ...item,

      inStock:
        false,

      offerAvailable:
        false,

      alertEligible:
        false,

      stale:
        false
    };
  }

  /*
    Preserve useful display data from
    the previous successful result.

    CRITICAL:
    Cached information is NEVER allowed
    to represent current stock.
  */
  return {
    ...cached,

    productId:
      item.productId,

    retailer:
      item.retailer,

    channel:
      "online",

    storeId:
      null,

    storeName:
      null,

    inStock:
      false,

    offerAvailable:
      false,

    alertEligible:
      false,

    checkedAt:
      item.checkedAt ||
      new Date()
        .toISOString(),

    source:
      "walmart-stale-cache",

    stale:
      true,

    staleReason:
      item.error ||
      "Temporary Walmart API timeout",

    error:
      item.error ||
      "Temporary Walmart API timeout",

    /*
      Keep last useful display data.
    */
    image:
      cached.image ||
      null,

    url:
      cached.url ||
      null,

    price:
      cached.price ??
      null,

    seller:
      cached.seller ||
      null,

    sellerType:
      cached.sellerType ||
      null,

    walmartItemId:
      cached.walmartItemId ||
      null,

    /*
      Keep seller identity for display,
      but stale data cannot be considered
      alert-eligible stock.
    */
    directSeller:
      cached.directSeller ===
      true,

    marketplaceOnly:
      cached.marketplaceOnly ===
      true,

    autoDiscovered:
      item.autoDiscovered ===
        true ||
      cached.autoDiscovered ===
        true
  };
}


/* ========================================
   STOCK / PUSH STATE
======================================== */

function getStockKey(item) {
  return getItemKey(
    item
  );
}


function qualifiesForRestock(item) {
  /*
    Stale cached data can NEVER qualify.
  */
  if (
    item.stale === true
  ) {
    return false;
  }

  return (
    item.retailer ===
      "walmart" &&

    item.directSeller ===
      true &&

    item.inStock ===
      true &&

    item.withinPriceRule ===
      true
  );
}


async function processRestockState(item) {
  const key =
    getStockKey(
      item
    );

  const currentQualifies =
    qualifiesForRestock(
      item
    );

  /*
    IMPORTANT:
    Do not let a temporary timeout change
    the stock baseline.

    Otherwise:
    in-stock -> timeout -> in-stock

    could incorrectly look like a new
    restock transition.
  */
  if (
    item.stale === true ||
    isTimeoutItem(item)
  ) {
    return {
      baselineEstablished:
        false,

      alertSent:
        false,

      baselineUnchanged:
        true
    };
  }

  if (
    !stockBaseline.has(
      key
    )
  ) {
    stockBaseline.set(
      key,
      currentQualifies
    );

    console.log(
      `Stock baseline established for ${key}:`,
      currentQualifies
    );

    return {
      baselineEstablished:
        true,

      alertSent:
        false
    };
  }

  const previousQualifies =
    stockBaseline.get(
      key
    );

  stockBaseline.set(
    key,
    currentQualifies
  );

  if (
    previousQualifies ===
      false &&

    currentQualifies ===
      true
  ) {
    console.log(
      `RESTOCK transition detected for ${key}`
    );

    try {
      const pushResult =
        await push
          .sendRestockAlert(
            item
          );

      console.log(
        `Restock push processed for ${key}:`,
        pushResult
      );

      return {
        baselineEstablished:
          false,

        alertSent:
          true,

        pushResult
      };

    } catch (error) {
      console.error(
        `Restock push failed for ${key}:`,
        error
      );

      return {
        baselineEstablished:
          false,

        alertSent:
          false,

        pushError:
          error.message
      };
    }
  }

  return {
    baselineEstablished:
      false,

    alertSent:
      false
  };
}


/* ========================================
   SAVE SINGLE RESULT
======================================== */

function saveResult(item) {
  let prepared =
    prepareItem(
      item
    );

  prepared =
    applySafeCache(
      prepared
    );

  prepared =
    prepareItem(
      prepared
    );

  if (
    !isTimeoutItem(prepared) &&
    prepared.stale !== true
  ) {
    cacheGoodResult(
      prepared
    );
  }

  const index =
    latest.findIndex(
      existing =>
        existing.productId ===
          prepared.productId &&

        existing.retailer ===
          prepared.retailer
    );

  if (
    index >= 0
  ) {
    latest[index] =
      prepared;

  } else {
    latest.push(
      prepared
    );
  }

  lastRun =
    new Date()
      .toISOString();

  return prepared;
}


/* ========================================
   SCAN ONE PRODUCT
======================================== */

async function scanJob(
  product,
  retailer
) {
  try {
    const item =
      await provider
        .checkProduct(
          product,
          retailer
        );

    const enrichedItem = {
      ...item,

      msrp:
        item.msrp ??
        product.msrp ??
        null,

      autoDiscovered:
        product.autoDiscovered ===
          true
    };

    let prepared =
      prepareItem(
        enrichedItem
      );

    /*
      If current response timed out,
      attempt to preserve old card data.
    */
    prepared =
      applySafeCache(
        prepared
      );

    /*
      Re-run preparation because cached
      data may include price/MSRP fields.
    */
    prepared =
      prepareItem(
        prepared
      );

    /*
      Only fresh usable responses update
      the display cache.
    */
    if (
      !isTimeoutItem(prepared) &&
      prepared.stale !== true
    ) {
      cacheGoodResult(
        prepared
      );
    }

    const restockResult =
      await processRestockState(
        prepared
      );

    return {
      ok:
        true,

      item:
        prepared,

      alertSent:
        restockResult
          .alertSent ===
        true
    };

  } catch (error) {
    let failedItem =
      prepareItem({
        productId:
          product.id,

        name:
          product.name,

        set:
          product.set,

        productType:
          product.productType,

        retailer,

        channel:
          "online",

        inStock:
          false,

        directSeller:
          false,

        price:
          null,

        msrp:
          product.msrp ??
          null,

        autoDiscovered:
          product.autoDiscovered ===
            true,

        url:
          null,

        seller:
          null,

        checkedAt:
          new Date()
            .toISOString(),

        source:
          `${retailer}-scan-error`,

        error:
          error.message
      });

    /*
      A thrown timeout can also reuse
      cached display information safely.
    */
    if (
      String(
        error.message ||
        ""
      )
        .toLowerCase()
        .includes(
          "timed out"
        )
    ) {
      failedItem = {
        ...failedItem,

        source:
          "walmart-timeout"
      };

      failedItem =
        applySafeCache(
          failedItem
        );

      failedItem =
        prepareItem(
          failedItem
        );
    }

    return {
      ok:
        false,

      item:
        failedItem,

      alertSent:
        false,

      error:
        error.message
    };
  }
}


/* ========================================
   BATCH HELPER
======================================== */

function chunkArray(
  items,
  size
) {
  const chunks =
    [];

  for (
    let index = 0;
    index < items.length;
    index += size
  ) {
    chunks.push(
      items.slice(
        index,
        index + size
      )
    );
  }

  return chunks;
}


/* ========================================
   MAIN CATALOG SCAN
======================================== */

async function runCheck() {
  if (running) {
    return {
      ok:
        false,

      skipped:
        true,

      reason:
        "Catalog scan already running"
    };
  }

  running =
    true;

  const startedAt =
    new Date()
      .toISOString();

  let attempted =
    0;

  let completed =
    0;

  let failed =
    0;

  let alertsTriggered =
    0;

  let staleResults =
    0;

  try {
    const curatedProducts =
      loadProducts()
        .filter(
          product =>
            product.enabled !==
              false
        );

    let discoveredProducts =
      [];

    try {
      discoveredProducts =
        await discovery
          .getDiscoveredProducts();

    } catch (error) {
      console.error(
        "Could not load discovered products:",
        error.message
      );
    }

    const products = [
      ...curatedProducts,
      ...discoveredProducts
    ];


    /* ====================================
       BUILD SCAN JOBS
    ==================================== */

    const jobs =
      [];

    for (
      const product
      of products
    ) {
      const retailers =
        Array.isArray(
          product.retailers
        )
          ? product.retailers
          : [];

      for (
        const retailer
        of retailers
      ) {
        jobs.push({
          product,
          retailer
        });
      }
    }

    attempted =
      jobs.length;

    console.log(
      "Starting catalog scan:",
      {
        jobs:
          jobs.length,

        concurrency:
          SCAN_CONCURRENCY,

        curatedProducts:
          curatedProducts.length,

        discoveredProducts:
          discoveredProducts.length
      }
    );


    /* ====================================
       PROCESS IN CONCURRENT BATCHES
    ==================================== */

    const results =
      [];

    const batches =
      chunkArray(
        jobs,
        SCAN_CONCURRENCY
      );

    for (
      let batchIndex = 0;
      batchIndex <
        batches.length;
      batchIndex += 1
    ) {
      const batch =
        batches[
          batchIndex
        ];

      const settled =
        await Promise.all(
          batch.map(
            job =>
              scanJob(
                job.product,
                job.retailer
              )
          )
        );

      for (
        const result
        of settled
      ) {
        results.push(
          result.item
        );

        if (
          result.ok
        ) {
          completed +=
            1;

        } else {
          failed +=
            1;
        }

        if (
          result.alertSent
        ) {
          alertsTriggered +=
            1;
        }

        if (
          result.item
            ?.stale ===
          true
        ) {
          staleResults +=
            1;
        }
      }

      /*
        Publish partial results after
        each batch so the dashboard starts
        filling before the whole scan ends.
      */
      latest = [
        ...results
      ];

      console.log(
        `Catalog scan progress: ${results.length}/${jobs.length}`
      );
    }


    /* ====================================
       FINISH SCAN
    ==================================== */

    latest =
      results;

    lastRun =
      new Date()
        .toISOString();

    const summary = {
      ok:
        true,

      startedAt,

      finishedAt:
        lastRun,

      attempted,

      completed,

      failed,

      alertsTriggered,

      staleResults,

      count:
        results.length,

      concurrency:
        SCAN_CONCURRENCY,

      curatedProducts:
        curatedProducts.length,

      discoveredProducts:
        discoveredProducts.length
    };

    console.log(
      "Catalog scan completed:",
      summary
    );

    return summary;

  } finally {
    running =
      false;
  }
}


/* ========================================
   CURRENT RESULTS
======================================== */

function getLatest() {
  return {
    lastRun,

    running,

    count:
      latest.length,

    items:
      latest
  };
}


/* ========================================
   SCANNER STATE
======================================== */

function getScannerState() {
  const products =
    loadProducts()
      .filter(
        product =>
          product.enabled !==
            false
      );

  const retailerCounts =
    {};

  for (
    const product
    of products
  ) {
    for (
      const retailer
      of product.retailers ||
      []
    ) {
      retailerCounts[
        retailer
      ] =
        (
          retailerCounts[
            retailer
          ] ||
          0
        ) +
        1;
    }
  }

  return {
    running,

    lastRun,

    catalogProducts:
      products.length,

    retailerCounts,

    automaticPolling:
      false,

    restockBaselines:
      stockBaseline.size,

    scanConcurrency:
      SCAN_CONCURRENCY,

    currentResultCount:
      latest.length,

    cachedProductCount:
      lastGoodResults.size,

    staleResultCount:
      latest.filter(
        item =>
          item.stale ===
          true
      ).length
  };
}


/* ========================================
   EXPORTS
======================================== */

module.exports = {
  runCheck,
  getLatest,
  saveResult,
  getScannerState
};
