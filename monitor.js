const fs = require("fs");
const path = require("path");

const providerName = (process.env.DATA_PROVIDER || "mock").toLowerCase();
const provider = require(`./${providerName}.js`);
const productFile = path.join(__dirname, "products.json");

let latest = [];
let lastRun = null;
let running = false;

function loadProducts() {
  return JSON.parse(fs.readFileSync(productFile, "utf8"));
}

function directSellerOnly(item) {
  if (item.retailer === "target") return item.seller === "Target";
  if (item.retailer === "walmart") return item.seller === "Walmart";
  return false;
}

function withinPriceRule(item) {
  if (!item.price || !item.msrp) return true;
  return item.price <= item.msrp * 1.5;
}

async function runCheck() {
  if (running) return;
  running = true;
  try {
    const products = loadProducts().filter(p => p.enabled !== false);
    const results = [];
    for (const product of products) {
      for (const retailer of product.retailers || []) {
        try {
          const item = await provider.checkProduct(product, retailer);
          item.directSeller = directSellerOnly(item);
          item.withinPriceRule = withinPriceRule(item);
          results.push(item);
        } catch (error) {
          results.push({
            productId: product.id, name: product.name, set: product.set,
            retailer, inStock: false, error: error.message,
            checkedAt: new Date().toISOString()
          });
        }
      }
    }
    latest = results;
    lastRun = new Date().toISOString();
  } finally {
    running = false;
  }
}
function getLatest() { return { lastRun, items: latest }; }
module.exports = { runCheck, getLatest };
