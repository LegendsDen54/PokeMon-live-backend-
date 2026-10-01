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

let latest = [];
let lastRun = null;
let running = false;

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

  return false;
}

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
  Save or replace ONE product result.

  This lets our controlled test update the
  dashboard without running all products.
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

async function runCheck() {
  if (running) {
    return;
  }

  running = true;

  try {
    const products =
      loadProducts().filter(
        product =>
          product.enabled !== false
      );

    const results = [];

    for (const product of products) {
      for (
        const retailer
        of product.retailers || []
      ) {
        try {
          const item =
            await provider.checkProduct(
              product,
              retailer
            );

          results.push(
            prepareItem(item)
          );
        } catch (error) {
          results.push(
            prepareItem({
              productId:
                product.id,

              name:
                product.name,

              set:
                product.set,

              retailer,

              inStock: false,

              error:
                error.message,

              checkedAt:
                new Date()
                  .toISOString()
            })
          );
        }
      }
    }

    latest = results;

    lastRun =
      new Date().toISOString();

  } finally {
    running = false;
  }
}

function getLatest() {
  return {
    lastRun,
    items: latest
  };
}

module.exports = {
  runCheck,
  getLatest,
  saveResult
};
