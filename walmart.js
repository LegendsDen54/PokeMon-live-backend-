const HOST =
  process.env.WALMART_RAPIDAPI_HOST ||
  "realtime-walmart-data.p.rapidapi.com";

const API_KEY = process.env.WALMART_RAPIDAPI_KEY;

const discoveredItems = new Map();

function parsePrice(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(
    String(value).replace(/[^0-9.]/g, "")
  );

  return Number.isFinite(number) ? number : null;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isWalmartSeller(value) {
  const seller = normalize(value);

  return (
    seller === "walmart" ||
    seller === "walmart com"
  );
}

function productMatches(product, item) {
  const expected = normalize(product.name);

  const actual = normalize(
    item.name ||
    item.title
  );

  if (!expected || !actual) {
    return false;
  }

  const ignored = new Set([
    "pokemon",
    "tcg",
    "the",
    "and",
    "collection"
  ]);

  const words = expected
    .split(" ")
    .filter(
      word =>
        word.length > 2 &&
        !ignored.has(word)
    );

  if (!words.length) {
    return false;
  }

  const matches = words.filter(
    word => actual.includes(word)
  ).length;

  return matches / words.length >= 0.65;
}

async function apiRequest(path) {
  if (!API_KEY) {
    throw new Error(
      "WALMART_RAPIDAPI_KEY is missing"
    );
  }

  const response = await fetch(
    `https://${HOST}${path}`,
    {
      method: "GET",
      headers: {
        "x-rapidapi-key": API_KEY,
        "x-rapidapi-host": HOST
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Walmart API returned ${response.status}`
    );
  }

  return response.json();
}

function getSellerName(item) {
  return (
    item.sellerName ||
    item.sellerDisplayName ||
    (
      typeof item.seller === "string"
        ? item.seller
        : item.seller?.name
    ) ||
    null
  );
}

function makeResult(product, item, source) {
  const sellerName = getSellerName(item);

  const price = parsePrice(
    item.price ??
    item.currentPrice ??
    item.salePrice
  );

  const availability = normalize(
    item.availability ||
    item.availabilityStatus ||
    item.stockStatus
  );

  const directSeller =
    isWalmartSeller(sellerName);

  const rawInStock =
    availability.includes("in stock") ||
    availability === "instock";

  const inStock =
    directSeller && rawInStock;

  const itemId =
    item.usItemId ||
    item.itemId ||
    item.id ||
    null;

  const url =
    item.canonicalUrl ||
    item.productUrl ||
    item.url ||
    (
      itemId
        ? `https://www.walmart.com/ip/${itemId}`
        : null
    );

  return {
    productId: product.id,

    name:
      item.name ||
      item.title ||
      product.name,

    set: product.set,

    retailer: "walmart",

    inStock,

    directSeller,

    price,

    msrp: product.msrp ?? null,

    url,

    seller:
      directSeller
        ? "Walmart"
        : sellerName,

    checkedAt:
      new Date().toISOString(),

    source,

    walmartItemId: itemId,

    image:
      item.image ||
      item.imageUrl ||
      item.thumbnailUrl ||
      null,

    marketplaceOnly:
      !directSeller
  };
}

async function checkKnownItem(
  product,
  itemId
) {
  const data = await apiRequest(
    `/product?itemId=${encodeURIComponent(itemId)}`
  );

  /*
    TEMPORARY DIAGNOSTIC

    This prints the complete Product Details
    response to the Render server logs.

    It lets us determine the exact locations of:
    - Walmart seller information
    - price
    - availability
    - image
    - offer data

    Remove this after mapping is complete.
  */
  console.log(
    "WALMART PRODUCT DEBUG:",
    JSON.stringify(data, null, 2)
  );

  const item =
    data.product ||
    data.data ||
    data.item ||
    data;

  if (
    !item ||
    typeof item !== "object" ||
    Array.isArray(item)
  ) {
    throw new Error(
      "Invalid Walmart Product Details response"
    );
  }

  if (!productMatches(product, item)) {
    throw new Error(
      "Saved Walmart itemId failed product validation"
    );
  }

  return makeResult(
    product,
    item,
    "walmart-product-details"
  );
}

async function discoverProduct(product) {
  const keyword =
    product.searchTerm ||
    product.name ||
    "Pokemon";

  const params = new URLSearchParams({
    page: "1",
    sort: "best_match",
    keyword
  });

  const data = await apiRequest(
    `/search?${params.toString()}`
  );

  const results =
    Array.isArray(data.results)
      ? data.results
      : [];

  const match = results.find(item => {
    return (
      isWalmartSeller(
        getSellerName(item)
      ) &&
      productMatches(
        product,
        item
      )
    );
  });

  if (!match) {
    return {
      productId: product.id,

      name: product.name,

      set: product.set,

      retailer: "walmart",

      inStock: false,

      directSeller: false,

      price: null,

      msrp:
        product.msrp ?? null,

      url: null,

      seller: null,

      checkedAt:
        new Date().toISOString(),

      source:
        "walmart-discovery",

      discoveryMode: true,

      marketplaceOnly: false,

      error:
        "No validated Walmart-direct result found"
    };
  }

  const itemId =
    match.usItemId ||
    match.itemId ||
    match.id ||
    null;

  if (itemId) {
    discoveredItems.set(
      product.id,
      String(itemId)
    );
  }

  return {
    ...makeResult(
      product,
      match,
      "walmart-discovery"
    ),

    discoveryMode:
      !itemId
  };
}

async function checkProduct(
  product,
  retailer
) {
  if (retailer !== "walmart") {
    return {
      productId: product.id,

      name: product.name,

      set: product.set,

      retailer,

      inStock: false,

      directSeller: false,

      price: null,

      msrp:
        product.msrp ?? null,

      url: null,

      seller: null,

      checkedAt:
        new Date().toISOString(),

      source:
        "walmart-rapidapi",

      error:
        "Retailer not supported by Walmart provider"
    };
  }

  const knownItemId =
    product.walmartItemId ||
    discoveredItems.get(
      product.id
    );

  if (knownItemId) {
    try {
      return await checkKnownItem(
        product,
        knownItemId
      );
    } catch (error) {
      discoveredItems.delete(
        product.id
      );
    }
  }

 
