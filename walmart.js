const HOST =
  process.env.WALMART_RAPIDAPI_HOST ||
  "realtime-walmart-data.p.rapidapi.com";

const API_KEY = process.env.WALMART_RAPIDAPI_KEY;

function parsePrice(value) {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) ? number : null;
}

async function checkProduct(product, retailer) {
  // Walmart provider only handles Walmart products.
  if (retailer !== "walmart") {
    return {
      productId: product.id,
      name: product.name,
      set: product.set,
      retailer,
      inStock: false,
      price: null,
      msrp: product.msrp ?? null,
      url: null,
      seller: null,
      checkedAt: new Date().toISOString(),
      source: "walmart-rapidapi",
      error: "Retailer not supported by Walmart provider"
    };
  }

  if (!API_KEY) {
    throw new Error("WALMART_RAPIDAPI_KEY is missing");
  }

  const keyword = product.searchTerm || product.name || "Pokemon";

  const params = new URLSearchParams({
    page: "1",
    sort: "best_match",
    keyword
  });

  const response = await fetch(`https://${HOST}/search?${params}`, {
    method: "GET",
    headers: {
      "x-rapidapi-key": API_KEY,
      "x-rapidapi-host": HOST
    }
  });

  if (!response.ok) {
    throw new Error(`Walmart API returned ${response.status}`);
  }

  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];

  // Only accept products actually sold by Walmart.
  const match = results.find(
    item =>
      String(item.sellerName || "").trim().toLowerCase() === "walmart.com"
  );

  if (!match) {
    return {
      productId: product.id,
      name: product.name,
      set: product.set,
      retailer: "walmart",
      inStock: false,
      price: null,
      msrp: product.msrp ?? null,
      url: null,
      seller: null,
      checkedAt: new Date().toISOString(),
      source: "walmart-rapidapi",
      error: "No Walmart-sold result found"
    };
  }

  const price = parsePrice(match.price);

  const inStock =
    String(match.availability || "").trim().toLowerCase() === "in stock";

  return {
    productId: product.id,
    name: match.name || product.name,
    set: product.set,
    retailer: "walmart",
    inStock,
    price,
    msrp: product.msrp ?? null,
    url: match.canonicalUrl || null,
    seller: "Walmart",
    checkedAt: new Date().toISOString(),
    source: "walmart-rapidapi",
    walmartItemId: match.usItemId || null,
    image: match.image || null
  };
}

module.exports = { checkProduct };
