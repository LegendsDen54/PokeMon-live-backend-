const fs = require("fs");
const path = require("path");
const push = require("./push");

const providerName =
  (process.env.DATA_PROVIDER || "mock")
    .toLowerCase();

const provider =
  require(`./${providerName}.js`);

const productFile =
  path.join(
    __dirname,
    "products.json"
  );

/*
  CURRENT DASHBOARD STATE

  This stays in memory for now.
  Persistent storage will be added
  later.
*/
let latest = [];
let lastRun = null;
let running = false;

/*
  STOCK BASELINE

  IMPORTANT:

  This is intentionally separate
  from the dashboard state.

  A product must first establish
  a baseline during a REAL catalog
  scan before it can generate a
  restock notification.

  This prevents a backend restart
  from immediately producing a
  false restock alert.
*/
const stockBaseline = new Map();


/*
  LOAD PRODUCT CATALOG
*/
function loadProducts() {
  return JSON.parse(
    fs.readFileSync(
      productFile,
      "utf8"
    )
  );
}


/*
  DETERMINE WHETHER THE OFFER
  IS SOLD DIRECTLY BY THE RETAILER
*/
function directSellerOnly(item) {
  if (
    typeof item.directSeller === "boolean"
  ) {
    return item.directSeller;
  }

  if (item.retailer === "target") {
    return item.seller === "Target";
  }

  if (item.retailer === "walmart") {
    return item.seller === "Walmart";
  }

  if (item.retailer === "bestbuy") {
    return item.seller === "Best Buy";
  }

  return false;
}


/*
  PRICE RULE

  When MSRP is known:
  maximum allowed price = MSRP × 1.50

  When MSRP is not known yet,
  keep the result visible instead
  of incorrectly rejecting it.
*/
function withinPriceRule(item) {
  if (
    item.price == null ||
    item.msrp == null
  ) {
    return true;
  }

  return (
    Number(item.price) <=
    Number(item.msrp) * 1.5
  );
}


/*
  NORMALIZE EVERY RETAILER RESULT
*/
function prepareItem(item) {
  return {
    ...item,

    directSeller:
      directSellerOnly(item),

    withinPriceRule:
      withinPriceRule(item)
  };
}


/*
  UNIQUE STOCK-STATE KEY
*/
function getStockKey(item) {
  return [
    item.retailer || "unknown",
    item.productId || "unknown"
  ].join(":");
}


/*
  DOES THIS RESULT QUALIFY
  AS A REAL RESTOCK?

  For now production alerts are
  Walmart-only.

  Requirements:

  - Walmart result
  - Walmart/direct seller
  - Actually in stock
  - Passes configured price rule
*/
function qualifiesForRestock(item) {
  return (
    item.retailer === "walmart" &&
    item.directSeller === true &&
    item.inStock === true &&
    item.withinPriceRule !== false
  );
}


/*
  PROCESS REAL SCANNER STOCK STATE

  IMPORTANT:

  This function is used ONLY by
  the real catalog scanner.

  saveResult(), which is used by
  controlled test routes, does NOT
  call this function.

  Therefore controlled Walmart
  tests cannot trigger real
  restock notifications.
*/
async function processRestockState(item) {
  const key =
    getStockKey(item);

  const currentQualifies =
    qualifiesForRestock(item);

  /*
    FIRST REAL OBSERVATION

    Establish baseline only.

    No notification is sent.
  */
  if (!stockBaseline.has(key)) {

    stockBaseline.set(
      key,
      currentQualifies
    );

    console.log(
      `Stock baseline established for ${key}:`,
      currentQualifies
    );

    return {
      baselineEstablished: true,
      alertSent: false
    };
  }

  const previousQualifies =
    stockBaseline.get(key);

  /*
    Update state before attempting
    the push so repeated scans do
    not spam the same transition.
  */
  stockBaseline.set(
    key,
    currentQualifies
  );

  /*
    Alert ONLY when:

    previous = false
    current  = true
  */
  if (
    previousQualifies === false &&
    currentQualifies === true
  ) {

    console.log(
      `RESTOCK transition detected for ${key}`
    );

    try {

      const pushResult =
        await push.sendRestockAlert(
          item
        );

      console.log(
        `Restock push processed for ${key}:`,
        pushResult
      );

      return {
        baselineEstablished: false,
        alertSent: true,
        pushResult
      };

    } catch (error) {

      console.error(
        `Restock push failed for ${key}:`,
        error
      );

      /*
        Scanner continues even if
        push delivery fails.
      */
      return {
        baselineEstablished: false,
        alertSent: false,
        pushError:
          error.message
      };
    }
  }

  return {
    baselineEstablished: false,
    alertSent: false
  };
}


/*
  SAVE OR UPDATE ONE RESULT

  CONTROLLED TEST PATH.

  This intentionally DOES NOT call
  processRestockState().

  Therefore:

  /api/test/product/:productId

  and

  /api/test/prismatic-etb

  can update the dashboard without
  sending real restock alerts.
*/
function saveResult(item) {
  const prepared =
    prepareItem(item);

  const index =
    latest.findIndex(
      existing =>
        existing.productId ===
          prepared.productId &&
        existing.retailer ===
          prepared.retailer
    );

  if (index >= 0) {
    latest[index] = prepared;
  } else {
    latest.push(prepared);
  }

  lastRun =
    new Date().toISOString();

  return prepared;
}


/*
  FULL CATALOG SCAN ENGINE

  This is the REAL scanner path.

  IMPORTANT:

  Deploying this file alone does
  NOT start Walmart polling.

  Automatic polling still requires:

  ENABLE_FULL_POLLING=true

  in Render.
*/
async function runCheck() {
  if (running) {
    return {
      ok: false,
      skipped: true,
      reason:
        "Catalog scan already running"
    };
  }

  running = true;

  const startedAt =
    new Date().toISOString();

  let attempted = 0;
  let completed = 0;
  let failed = 0;
  let alertsTriggered = 0;

  try {
    const products =
      loadProducts().filter(
        product =>
          product.enabled !== false
      );

    const results = [];

    for (const product of products) {
      const retailers =
        Array.isArray(product.retailers)
          ? product.retailers
          : [];

      for (const retailer of retailers) {
        attempted += 1;

        try {
          const item =
            await provider.checkProduct(
              product,
              retailer
            );

          const prepared =
            prepareItem(item);

          results.push(prepared);

          /*
            ONLY the real catalog scan
            enters restock transition
            detection.
          */
          const restockResult =
            await processRestockState(
              prepared
            );

          if (
            restockResult.alertSent ===
            true
          ) {
            alertsTriggered += 1;
          }

          completed += 1;

        } catch (error) {
          failed += 1;

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

              inStock: false,

              directSeller: false,

              price: null,

              msrp:
                product.msrp ?? null,

              url: null,

              seller: null,

              checkedAt:
                new Date()
                  .toISOString(),

              source:
                `${retailer}-scan-error`,

              error:
                error.message
            });

          results.push(
            failedItem
          );

          /*
            Scan errors intentionally
            do NOT alter the stock
            baseline.

            A temporary API/network
            failure should not turn an
            in-stock item into a fake
            out-of-stock transition.
          */
        }
      }
    }

    /*
      Replace dashboard state only
      after the catalog pass finishes.
    */
    latest = results;

    lastRun =
      new Date().toISOString();

    return {
      ok: true,
      startedAt,
      finishedAt: lastRun,
      attempted,
      completed,
      failed,
      alertsTriggered,
      count:
        results.length
    };

  } finally {
    running = false;
  }
}


/*
  RETURN CURRENT DASHBOARD STATE

  Reading this does NOT contact
  Walmart, Target, or Best Buy.
*/
function getLatest() {
  return {
    lastRun,
    running,
    count:
      latest.length,
    items: latest
  };
}


/*
  BASIC SCANNER INFORMATION
*/
function getScannerState() {
  const products =
    loadProducts().filter(
      product =>
        product.enabled !== false
    );

  const retailerCounts = {};

  for (const product of products) {
    for (
      const retailer
      of product.retailers || []
    ) {
      retailerCounts[retailer] =
        (retailerCounts[retailer] || 0) +
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
      stockBaseline.size
  };
}


module.exports = {
  runCheck,
  getLatest,
  saveResult,
  getScannerState
};
