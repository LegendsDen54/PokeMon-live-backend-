const fs = require("fs");
const path = require("path");
const push = require("./push");
const discovery = require("./discovery");

const providerName =
  (process.env.DATA_PROVIDER || "mock").toLowerCase();

const provider = require(`./${providerName}.js`);

const productFile = path.join(__dirname, "products.json");

const SCAN_CONCURRENCY = Math.min(
  6,
  Math.max(1, Number(process.env.SCAN_CONCURRENCY || 2))
);

const SCAN_DISCOVERED_PRODUCTS =
  String(process.env.SCAN_DISCOVERED_PRODUCTS || "false").toLowerCase() === "true";

let latest = [];
let lastRun = null;
let running = false;

const stockBaseline = new Map();
const lastGoodResults = new Map();

function loadProducts() {
  return JSON.parse(fs.readFileSync(productFile, "utf8"));
}

function getItemKey(item) {
  return [item.retailer || "unknown", item.productId || "unknown"].join(":");
}

function isTimeoutItem(item) {
  if (!item) return false;
  const message = String(item.error || "").toLowerCase();
  return item.source === "walmart-timeout" || message.includes("timed out");
}

function isSoftFailure(item) {
  if (!item) return false;
  return (
    isTimeoutItem(item) ||
    item.source === "hasdata-scan-error" ||
    item.source === "hasdata-no-match"
  );
}

function isUsableResult(item) {
  if (!item || isSoftFailure(item)) return false;
  return Boolean(
    item.image ||
    item.url ||
    item.price != null ||
    item.seller ||
    item.directSeller === true
  );
}

function directSellerOnly(item) {
  if (typeof item.directSeller === "boolean") return item.directSeller;
  if (item.retailer === "target") return item.seller === "Target";
  if (item.retailer === "walmart") return item.seller === "Walmart";
  if (item.retailer === "bestbuy") return item.seller === "Best Buy";
  return false;
}

function withinPriceRule(item) {
  if (item.autoDiscovered === true && item.msrp == null) return false;
  if (item.price == null) return true;
  if (item.msrp == null) return true;

  const price = Number(item.price);
  const msrp = Number(item.msrp);

  if (!Number.isFinite(price) || !Number.isFinite(msrp) || msrp <= 0) {
    return false;
  }

  return price <= msrp * 1.5;
}

function prepareItem(item) {
  const onlineOnly = item.retailer === "walmart" || item.retailer === "target";

  return {
    ...item,
    channel: onlineOnly ? "online" : (item.channel || "online"),
    storeId: onlineOnly ? null : (item.storeId ?? null),
    storeName: onlineOnly ? null : (item.storeName ?? null),
    directSeller: directSellerOnly(item),
    withinPriceRule: withinPriceRule(item)
  };
}

function cacheGoodResult(item) {
  if (!isUsableResult(item)) return;
  lastGoodResults.set(getItemKey(item), { ...item });
}

function applySafeCache(item) {
  if (!isSoftFailure(item)) return item;

  const cached = lastGoodResults.get(getItemKey(item));

  if (!cached) {
    return {
      ...item,
      inStock: false,
      offerAvailable: false,
      alertEligible: false,
      stale: false
    };
  }

  return {
    ...cached,
    productId: item.productId,
    retailer: item.retailer,
    channel: "online",
    storeId: null,
    storeName: null,
    inStock: false,
    offerAvailable: false,
    alertEligible: false,
    checkedAt: item.checkedAt || new Date().toISOString(),
    source: "walmart-stale-cache",
    stale: true,
    staleReason: item.error || "Temporary Walmart source failure",
    error: item.error || "Temporary Walmart source failure",
    image: cached.image || null,
    url: cached.url || null,
    price: cached.price ?? null,
    seller: cached.seller || null,
    sellerType: cached.sellerType || null,
    walmartItemId: cached.walmartItemId || null,
    directSeller: cached.directSeller === true,
    marketplaceOnly: cached.marketplaceOnly === true,
    autoDiscovered:
      item.autoDiscovered === true || cached.autoDiscovered === true
  };
}

function qualifiesForRestock(item) {
  if (item.stale === true || isSoftFailure(item)) return false;

  return (
    item.retailer === "walmart" &&
    item.directSeller === true &&
    item.inStock === true &&
    item.withinPriceRule === true
  );
}

async function processRestockState(item) {
  const key = getItemKey(item);

  if (item.stale === true || isSoftFailure(item)) {
    return {
      baselineEstablished: false,
      alertSent: false,
      baselineUnchanged: true
    };
  }

  const currentQualifies = qualifiesForRestock(item);

  if (!stockBaseline.has(key)) {
    stockBaseline.set(key, currentQualifies);
    console.log(`Stock baseline established for ${key}:`, currentQualifies);
    return { baselineEstablished: true, alertSent: false };
  }

  const previousQualifies = stockBaseline.get(key);
  stockBaseline.set(key, currentQualifies);

  if (previousQualifies === false && currentQualifies === true) {
    console.log(`RESTOCK transition detected for ${key}`);

    try {
      const pushResult = await push.sendRestockAlert(item);
      console.log(`Restock push processed for ${key}:`, pushResult);
      return {
        baselineEstablished: false,
        alertSent: true,
        pushResult
      };
    } catch (error) {
      console.error(`Restock push failed for ${key}:`, error);
      return {
        baselineEstablished: false,
        alertSent: false,
        pushError: error.message
      };
    }
  }

  return { baselineEstablished: false, alertSent: false };
}

function saveResult(item) {
  let prepared = prepareItem(item);
  prepared = applySafeCache(prepared);
  prepared = prepareItem(prepared);

  if (!isSoftFailure(prepared) && prepared.stale !== true) {
    cacheGoodResult(prepared);
  }

  const index = latest.findIndex(
    existing =>
      existing.productId === prepared.productId &&
      existing.retailer === prepared.retailer
  );

  if (index >= 0) latest[index] = prepared;
  else latest.push(prepared);

  lastRun = new Date().toISOString();
  return prepared;
}

async function finalizeScannedItem(item, product) {
  const enriched = {
    ...item,
    msrp: item.msrp ?? product.msrp ?? null,
    autoDiscovered: product.autoDiscovered === true
  };

  let prepared = prepareItem(enriched);
  prepared = applySafeCache(prepared);
  prepared = prepareItem(prepared);

  if (!isSoftFailure(prepared) && prepared.stale !== true) {
    cacheGoodResult(prepared);
  }

  const restockResult = await processRestockState(prepared);

  return {
    item: prepared,
    alertSent: restockResult.alertSent === true
  };
}

async function scanJob(product, retailer) {
  try {
    const item = await provider.checkProduct(product, retailer);
    const finalized = await finalizeScannedItem(item, product);

    return {
      ok: !isSoftFailure(finalized.item),
      item: finalized.item,
      alertSent: finalized.alertSent
    };
  } catch (error) {
    let failedItem = prepareItem({
      productId: product.id,
      name: product.name,
      set: product.set,
      productType: product.productType,
      retailer,
      channel: "online",
      inStock: false,
      directSeller: false,
      price: null,
      msrp: product.msrp ?? null,
      autoDiscovered: product.autoDiscovered === true,
      url: null,
      seller: null,
      checkedAt: new Date().toISOString(),
      source: `${retailer}-scan-error`,
      error: error.message
    });

    if (String(error.message || "").toLowerCase().includes("timed out")) {
      failedItem = {
        ...failedItem,
        source: "walmart-timeout"
      };
    }

    failedItem = applySafeCache(failedItem);
    failedItem = prepareItem(failedItem);

    return {
      ok: false,
      item: failedItem,
      alertSent: false,
      error: error.message
    };
  }
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function scanWalmartBatch(curatedProducts) {
  if (providerName !== "walmart" || typeof provider.checkProductsBatch !== "function") {
    return null;
  }

  let batchResults;

  try {
    batchResults = await provider.checkProductsBatch(curatedProducts);
  } catch (error) {
    console.error("Walmart batch provider failed:", error.message);
    return null;
  }

  if (!Array.isArray(batchResults)) return null;

  const byProductId = new Map(
    curatedProducts.map(product => [product.id, product])
  );

  const results = [];

  for (const rawItem of batchResults) {
    const product = byProductId.get(rawItem.productId);
    if (!product) continue;

    const finalized = await finalizeScannedItem(rawItem, product);
    results.push({
      ok: !isSoftFailure(finalized.item),
      item: finalized.item,
      alertSent: finalized.alertSent
    });
  }

  return results;
}

async function runCheck() {
  if (running) {
    return {
      ok: false,
      skipped: true,
      reason: "Catalog scan already running"
    };
  }

  running = true;
  const startedAt = new Date().toISOString();

  let attempted = 0;
  let alertsTriggered = 0;
  let batchMode = false;
  let rapidApiFallbacks = 0;

  try {
    const curatedProducts = loadProducts().filter(product => product.enabled !== false);

    let discoveredProducts = [];

    if (SCAN_DISCOVERED_PRODUCTS) {
      try {
        discoveredProducts = await discovery.getDiscoveredProducts();
      } catch (error) {
        console.error("Could not load discovered products:", error.message);
      }
    }

    const resultMap = new Map();
    const failedBatchProductIds = new Set();

    function publish(item) {
      resultMap.set(getItemKey(item), item);
      latest = Array.from(resultMap.values());
    }

    const walmartCurated = curatedProducts.filter(product =>
      Array.isArray(product.retailers) && product.retailers.includes("walmart")
    );

    const batchResults = await scanWalmartBatch(walmartCurated);

    if (Array.isArray(batchResults)) {
      batchMode = true;
      attempted += walmartCurated.length;

      for (const result of batchResults) {
        publish(result.item);
        if (result.alertSent) alertsTriggered += 1;
        if (!result.ok || isSoftFailure(result.item)) {
          failedBatchProductIds.add(result.item.productId);
        }
      }

      console.log(
        `Walmart HasData batch published ${batchResults.length}/${walmartCurated.length}; ` +
        `${failedBatchProductIds.size} item(s) queued for RapidAPI fallback`
      );
    }

    const fallbackJobs = [];

    for (const product of curatedProducts) {
      const retailers = Array.isArray(product.retailers) ? product.retailers : [];

      for (const retailer of retailers) {
        if (retailer === "walmart" && batchMode) {
          if (failedBatchProductIds.has(product.id)) {
            fallbackJobs.push({ product, retailer, fallback: true });
          }
          continue;
        }

        fallbackJobs.push({ product, retailer, fallback: false });
      }
    }

    for (const product of discoveredProducts) {
      const retailers = Array.isArray(product.retailers) ? product.retailers : [];
      for (const retailer of retailers) {
        fallbackJobs.push({ product, retailer, fallback: false });
      }
    }

    attempted += fallbackJobs.length;
    rapidApiFallbacks = fallbackJobs.filter(job => job.fallback).length;

    const batches = chunkArray(fallbackJobs, SCAN_CONCURRENCY);

    for (const batch of batches) {
      const settled = await Promise.all(
        batch.map(job => scanJob(job.product, job.retailer))
      );

      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        const job = batch[index];
        const key = getItemKey(result.item);
        const existing = resultMap.get(key);

        // When HasData had a soft failure, prefer a usable RapidAPI fallback.
        // If both providers fail, keep the safe stale-cache result with the
        // most useful display metadata available.
        if (
          !existing ||
          !job?.fallback ||
          !isSoftFailure(result.item) ||
          isSoftFailure(existing)
        ) {
          publish(result.item);
        }

        if (result.alertSent) alertsTriggered += 1;
      }

      console.log(`Catalog scan progress: ${resultMap.size} product result(s) published`);
    }

    const results = Array.from(resultMap.values());
    latest = results;
    lastRun = new Date().toISOString();

    const failed = results.filter(item => isSoftFailure(item)).length;
    const staleResults = results.filter(item => item.stale === true).length;
    const completed = results.length - failed;

    const summary = {
      ok: true,
      startedAt,
      finishedAt: lastRun,
      attempted,
      completed,
      failed,
      alertsTriggered,
      staleResults,
      count: results.length,
      concurrency: SCAN_CONCURRENCY,
      batchMode,
      rapidApiFallbacks,
      curatedProducts: curatedProducts.length,
      discoveredProducts: discoveredProducts.length,
      scanDiscoveredProducts: SCAN_DISCOVERED_PRODUCTS
    };

    console.log("Catalog scan completed:", summary);
    return summary;
  } finally {
    running = false;
  }
}

function getLatest() {
  return {
    lastRun,
    running,
    count: latest.length,
    items: latest
  };
}

function getScannerState() {
  const products = loadProducts().filter(product => product.enabled !== false);
  const retailerCounts = {};

  for (const product of products) {
    for (const retailer of product.retailers || []) {
      retailerCounts[retailer] = (retailerCounts[retailer] || 0) + 1;
    }
  }

  return {
    running,
    lastRun,
    catalogProducts: products.length,
    retailerCounts,
    automaticPolling: false,
    restockBaselines: stockBaseline.size,
    scanConcurrency: SCAN_CONCURRENCY,
    currentResultCount: latest.length,
    cachedProductCount: lastGoodResults.size,
    staleResultCount: latest.filter(item => item.stale === true).length,
    scanDiscoveredProducts: SCAN_DISCOVERED_PRODUCTS,
    batchProviderAvailable: typeof provider.checkProductsBatch === "function"
  };
}

module.exports = {
  runCheck,
  getLatest,
  saveResult,
  getScannerState
};
