const HOST =

  process.env.WALMART_RAPIDAPI_HOST ||

  "realtime-walmart-data.p.rapidapi.com";

const API_KEY = process.env.WALMART_RAPIDAPI_KEY;

async function checkProduct(product, retailer) {

  // This provider only handles Walmart.

  if (retailer !== "walmart") {

    return {

      productId: product.id,

      name: product.name,

      set: product.set,

      retailer,

      inStock: false,

      price: null,

      msrp: product.msrp ?? null,

      url: product.targetUrl ?? null,

      seller: retailer === "target" ? "Target" : null,

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

  const results =

    data.results ||

    data.products ||

    data.data?.results ||

    data.data?.products ||

    [];

  const match = Array.isArray(results) ? results[0] : null;

  if (!match) {

    return {

      productId: product.id,

      name: product.name,

      set: product.set,

      retailer: "walmart",

      inStock: false,

      price: null,

      msrp: product.msrp ?? null,

      url: product.walmartUrl ?? null,

      seller: "Walmart",

      checkedAt: new Date().toISOString(),

      source: "walmart-rapidapi"

    };

  }

  const price = Number(

    match.price ??

    match.currentPrice ??

    match.current_price ??

    match.priceInfo?.currentPrice?.price ??

    0

  ) || null;

  return {

    productId: product.id,

    name: match.title || match.name || product.name,

    set: product.set,

    retailer: "walmart",

    inStock: match.inStock ?? match.in_stock ?? true,

    price,

    msrp: product.msrp ?? null,

    url:

      match.url ||

      match.productUrl ||

      match.product_url ||

      product.walmartUrl ||

      null,

    seller:

      match.seller ||

      match.sellerName ||

      match.seller_name ||

      "Walmart",

    checkedAt: new Date().toISOString(),

    source: "walmart-rapidapi"

  };

}

module.exports = { checkProduct }
