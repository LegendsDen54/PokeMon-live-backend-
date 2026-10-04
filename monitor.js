const fs = require("fs");
const path = require("path");
const push = require("./push");
const discovery = require("./discovery");

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

let latest = [];
let lastRun = null;
let running = false;

const stockBaseline = new Map();

function loadProducts() {
  return JSON.parse(
    fs.readFileSync(
      productFile,
      "utf8"
    )
  );
}

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

function withinPriceRule(item) {
  if (item.price == null) {
    return true;
  }

  /*
    Auto-discovered products must have
    verified MSRP before qualifying.
  */
  if (
    item.autoDiscovered === true &&
    item.msrp == null
  ) {
    return false;
  }

  /*
    Preserve existing behavior for
    curated products without MSRP.
  */
  if (item.msrp == null) {
    return true;
  }

  const price =
    Number(item.price);

  const msrp =
    Number(item.msrp);

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(msrp) ||
    msrp <= 0
  ) {
    return false;
  }

  return price <= msrp * 1.5;
}

function prepareItem(item) {
  return {
    ...item,

    directSeller:
      directSellerOnly(item),

    withinPriceRule:
      withinPriceRule(item)
  };
}

function getStockKey(item) {
  return [
    item.retailer || "unknown",
    item.productId || "unknown"
  ].join(":");
}

function qualifiesForRestock(item) {
  return (
    item.retailer === "walmart" &&
    item.directSeller === true &&
    item.inStock === true &&
    item.withinPriceRule === true
  );
}

async function processRestockState(item) {
  const key =
    getStockKey(item);

  const currentQualifies =
    qualifiesForRestock(item);

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

  stockBaseline.set(
    key,
    currentQualifies
  );

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
    const curatedProducts =
      loadProducts().filter(
        product =>
          product.enabled !== false
      );

    let discoveredProducts = [];

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
              product.autoDiscovered === true
          };

          const prepared =
            prepareItem(
              enrichedItem
            );

          results.push(prepared);

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

              autoDiscovered:
                product.autoDiscovered === true,

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
        }
      }
    }

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
        results.length,

      curatedProducts:
        curatedProducts.length,

      discoveredProducts:
        discoveredProducts.length
    };

  } finally {
    running = false;
  }
}

function getLatest() {
  return {
    lastRun,
    running,
    count:
      latest.length,
    items: latest
  };
}

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