const products = require("./products.json");

function walmartSearchUrl(term) {
  return `https://www.walmart.com/search?q=${encodeURIComponent(term || "Pokemon TCG")}`;
}

function getConfiguredWatchlist() {
  return products
    .filter(product =>
      product.enabled !== false &&
      Array.isArray(product.retailers) &&
      product.retailers.includes("walmart")
    )
    .map(product => ({
      retailer: "walmart",
      retailerLabel: "Walmart",
      productId: product.id,
      name: product.name,
      set: product.set || null,
      productType: product.productType || null,
      status: "watching",
      rawStatus: "Configured watchlist item",
      dropType: null,
      inStock: false,
      directSeller: false,
      price: null,
      msrp: product.msrp ?? null,
      seller: null,
      walmartItemId: product.walmartItemId || null,
      image: null,
      url: product.walmartItemId
        ? `https://www.walmart.com/ip/${product.walmartItemId}`
        : walmartSearchUrl(product.searchTerm || product.name),
      checkedAt: null,
      source: "configured-watchlist",
      watchOnly: true,
      alertEligible: false
    }));
}

function mergeUpcomingWithWatchlist(upcoming = []) {
  const detected = Array.isArray(upcoming) ? upcoming : [];
  const watchlist = getConfiguredWatchlist();

  const detectedIds = new Set(
    detected
      .flatMap(item => [item.productId, item.walmartItemId])
      .filter(Boolean)
      .map(String)
  );

  const detectedNames = new Set(
    detected.map(item => String(item.name || "").toLowerCase()).filter(Boolean)
  );

  const watching = watchlist.filter(item => {
    if (detectedIds.has(String(item.productId))) return false;
    if (item.walmartItemId && detectedIds.has(String(item.walmartItemId))) return false;
    if (detectedNames.has(String(item.name || "").toLowerCase())) return false;
    return true;
  });

  return {
    detected,
    watching,
    all: [...detected, ...watching]
  };
}

module.exports = {
  getConfiguredWatchlist,
  mergeUpcomingWithWatchlist
};
