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
  require(
    `./${providerName}.js`
  );

const productFile =
  path.join(
    __dirname,
    "products.json"
  );

/*
  Small amount of concurrency keeps the
  scanner fast without hammering the API.

  Default: 4 products at once.

  You can change this later through:
  SCAN_CONCURRENCY
*/
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

let latest = [];
let lastRun = null;
let running = false;

const stockBaseline =
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
    until a verified MSRP is available.
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
    live price is temporarily unavailable.
  */
  if (
    item.price == null
  ) {
    return true;
  }

  /*
    Preserve existing behavior for
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
    Maximum allowed price:
    150% of MSRP.

    Example:
    $50 MSRP -> $75 max.
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
  return {
    ...item,

    /*
      Walmart and Target are ONLINE ONLY.

      This makes sure Walmart results
      cannot accidentally appear as
      store-level inventory.
    */
    channel:
      item.retailer ===
        "walmart" ||
      item.retailer ===
        "target"
        ? "online"
        : (
            item.channel ||
            "online"
          ),

    storeId:
      item.retailer ===
        "walmart" ||
      item.retailer ===
        "target"
        ? null
        : (
            item.storeId ??
            null
          ),

    storeName:
      item.retailer ===
        "walmart" ||
      item.retailer ===
        "target"
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
   RESTOCK STATE
======================================== */

function getStockKey(item) {
  return [
    item.retailer ||
      "unknown",

    item.productId ||
      "unknown"
  ].join(":");
}


function qualifiesForRestock(item) {
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
  const prepared =
    prepareItem(
      item
    );

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

    /*
      Carry catalog metadata through
      the provider response.
    */
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

    const prepared =
      prepareItem(
        enrichedItem
      );

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
          .alertSent === true
    };

  } catch (error) {
    const failedItem =
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

    /*
      Build a flat work queue.

      Each product/retailer combination
      becomes one independent job.
    */
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

      /*
        Products inside each batch run
        concurrently.

        A slow or timed-out product no
        longer blocks every product
        behind it.
      */
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
      }

      /*
        IMPORTANT:
        Publish partial results after
        every batch.

        The dashboard can start showing
        Walmart cards while the rest of
        the scan is still finishing.
      */
      latest = [
        ...results
      ];

      console.log(
        `Catalog scan progress: ${results.length}/${jobs.length}`
      );
    }

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
      latest.length
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
