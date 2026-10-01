const fs = require("fs");
const path = require("path");

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
  A database/persistent cache can be
  added later.
*/
let latest = [];
let lastRun = null;
let running = false;

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
  we keep the result visible instead
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
  SAVE OR UPDATE ONE RESULT

  This is what our controlled
  single-product Walmart test uses.

  Later Target and Best Buy can feed
  results through this same function.
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

  IMPORTANT:
  This function EXISTS, but our
  server currently does NOT schedule
  it automatically.

  So merely deploying this file
  will NOT burn Walmart API calls.
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

          results.push(
            prepareItem(item)
          );

          completed += 1;

        } catch (error) {
          failed += 1;

          results.push(
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
            })
          );
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

  Useful later when the frontend
  displays each retailer engine.
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
      false
  };
}

module.exports = {
  runCheck,
  getLatest,
  saveResult,
  getScannerState
};
