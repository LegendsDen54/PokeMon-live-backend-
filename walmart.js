const HOST =
  process.env.WALMART_RAPIDAPI_HOST ||
  "realtime-walmart-data.p.rapidapi.com";

const API_KEY = process.env.WALMART_RAPIDAPI_KEY;

const discoveredItems = new Map();

function parsePrice(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const number = Number(
    String(value).replace(/[^0-9.]/g, "")
  );

  return Number.isFinite(number)
    ? number
    : null;
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
  if (item.sellerName) {
    return item.sellerName;
  }

  if (item.sellerDisplayName) {
    return item.sellerDisplayName;
  }

  if (typeof item.seller === "string") {
    return item.seller;
  }

  if (
    item.seller &&
    typeof item.seller === "object"
  ) {
    return item.seller.name || null;
  }

  return null;
}

function getPrice(item) {
  return parsePrice(
    item.priceDetails?.currentPrice?.price ??
    item.priceDetails?.currentPrice?.priceString ??
    item.price ??
    item.currentPrice ??
    item.salePrice
  );
}

function getImage(item) {
  if (
    Array.isArray(item.images) &&
    item.images.length > 0
  ) {
    return item.images[0];
  }

  return (
    item.image ||
    item.imageUrl ||
    item.thumbnailUrl ||
    null
  );
}

function getAvailability(item) {
  return normalize(
    item.otherDetails?.availabilityStatusV2?.value ||
    item.otherDetails?.availabilityStatusV2?.display ||
    item.otherDetails?.availabilityStatus ||
    item.shippingOption?.availabilityStatus ||
    item.availability ||
    item.availabilityStatus ||
    item.stockStatus
  );
}

function getSellerType(item) {
  return normalize(
    item.otherDetails?.sellerType ||
    item.sellerType
  );
}

function makeResult(product, item, source) {
  const sellerName =
    getSellerName(item);

  const sellerType =
    getSellerType(item);

  const directSeller =
    isWalmartSeller(sellerName) &&
    sellerType !== "external";

  const price =
    getPrice(item);

  const availability =
    getAvailability(item);

  const rawInStock =
    availability === "in stock" ||
    availability === "instock" ||
    availability === "available";

  /*
    IMPORTANT:
    Marketplace inventory may be IN_STOCK too.

    We only mark the product as in stock for
    our monitor when Walmart itself is the seller.
  */
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

  const image =
    getImage(item);

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

    msrp:
      product.msrp ?? null,

    url,

    seller:
      directSeller
        ? "Walmart"
        : sellerName,

    sellerType:
      sellerType || null,

    checkedAt:
      new Date().toISOString(),

    source,

    walmartItemId:
      itemId,

    image,

    marketplaceOnly:
      !directSeller,

    offerAvailable:
      rawInStock
  };
}

async function checkKnownItem(
  product,
  itemId
) {
  const data = await apiRequest(
    `/product?itemId=${encodeURIComponent(
      itemId
    )}`
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

  const params =
    new URLSearchParams({
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

  /*
    Discovery only accepts a listing as
    Walmart-direct when Walmart is the seller.
  */
  const match = results.find(
    item =>
      isWalmartSeller(
        getSellerName(item)
      ) &&
      productMatches(
        product,
        item
      )
  );

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

      sellerType: null,

      checkedAt:
        new Date().toISOString(),

      source:
        "walmart-discovery",

      discoveryMode: true,

      marketplaceOnly: false,

      offerAvailable: false,

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

      sellerType: null,

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
      console.error(
        `Known Walmart item failed for ${product.id}:`,
        error.message
      );

      discoveredItems.delete(
        product.id
      );
    }
  }

  return discoverProduct(
    product
  );
}

module.exports = {
  checkProduct
};
