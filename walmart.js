const HOST =
  process.env.WALMART_RAPIDAPI_HOST ||
  "realtime-walmart-data.p.rapidapi.com";

const API_KEY =
  process.env.WALMART_RAPIDAPI_KEY;

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
    return Number.isFinite(value)
      ? value
      : null;
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

  return (
    matches / words.length
  ) >= 0.65;
}


async function apiRequest(path) {
  if (!API_KEY) {
    throw new Error(
      "WALMART_RAPIDAPI_KEY is missing"
    );
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const response = await fetch(
      `https://${HOST}${path}`,
      {
        method: "GET",

        headers: {
          "x-rapidapi-key": API_KEY,
          "x-rapidapi-host": HOST
        },

        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        `Walmart API returned ${response.status}`
      );
    }

    return await response.json();

  } catch (error) {
    if (
      error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "Walmart API request timed out"
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
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
    item.priceDetails
      ?.currentPrice
      ?.price ??

    item.priceDetails
      ?.currentPrice
      ?.priceString ??

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
    item.otherDetails
      ?.availabilityStatusV2
      ?.value ||

    item.otherDetails
      ?.availabilityStatusV2
      ?.display ||

    item.otherDetails
      ?.availabilityStatus ||

    item.shippingOption
      ?.availabilityStatus ||

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


function getItemId(item) {
  return (
    item.usItemId ||
    item.itemId ||
    item.id ||
    null
  );
}


function makeResult(
  product,
  item,
  source
) {
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

  const offerAvailable =
    availability === "in stock" ||
    availability === "instock" ||
    availability === "available";

  /*
    IMPORTANT:

    "inStock" remains Walmart-direct only.

    This preserves the existing alert system.
    Marketplace availability is represented by
    offerAvailable instead.
  */
  const inStock =
    directSeller &&
    offerAvailable;

  const itemId =
    getItemId(item);

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

    msrp:
      product.msrp ??
      null,

    url,

    seller:
      directSeller
        ? "Walmart"
        : (
            sellerName ||
            "Marketplace Seller"
          ),

    sellerType:
      directSeller
        ? "walmart"
        : (
            sellerType ||
            "marketplace"
          ),

    checkedAt:
      new Date().toISOString(),

    source,

    walmartItemId:
      itemId,

    image:
      getImage(item),

    marketplaceOnly:
      !directSeller,

    offerAvailable
  };
}


function extractSearchResults(data) {
  if (Array.isArray(data?.results)) {
    return data.results;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  if (Array.isArray(data?.products)) {
    return data.products;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (
    Array.isArray(
      data?.data?.results
    )
  ) {
    return data.data.results;
  }

  if (
    Array.isArray(
      data?.data?.items
    )
  ) {
    return data.data.items;
  }

  if (
    Array.isArray(
      data?.searchResult?.items
    )
  ) {
    return data.searchResult.items;
  }

  return [];
}


/*
  Convert Walmart search results into
  dashboard offers.

  Unlike the alert scanner, this DOES NOT
  reject third-party sellers.
*/
function buildMarketplaceOffers(
  product,
  results,
  source = "walmart-marketplace-search"
) {
  const offers = results
    .filter(
      item =>
        productMatches(product, item)
    )
    .map(
      item =>
        makeResult(
          product,
          item,
          source
        )
    )
    .filter(
      item =>
        item.price !== null
    );

  /*
    Remove duplicate Walmart item IDs.
  */
  const unique =
    new Map();

  for (const offer of offers) {
    const key =
      offer.walmartItemId
        ? String(
            offer.walmartItemId
          )
        : [
            offer.name,
            offer.seller,
            offer.price
          ].join("|");

    if (!unique.has(key)) {
      unique.set(key, offer);
    }
  }

  /*
    Lowest price first.
  */
  return Array.from(
    unique.values()
  ).sort(
    (a, b) =>
      Number(a.price) -
      Number(b.price)
  );
}


async function searchMarketplaceOffers(
  product
) {
  const keyword =
    product.searchTerm ||
    product.name ||
    "Pokemon";

  const params =
    new URLSearchParams({
      page: "1",
      sort: "price_low",
      keyword
    });

  const data =
    await apiRequest(
      `/search?${params.toString()}`
    );

  const results =
    extractSearchResults(data);

  return buildMarketplaceOffers(
    product,
    results
  );
}


async function checkKnownItem(
  product,
  itemId
) {
  const data =
    await apiRequest(
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

  if (
    !productMatches(
      product,
      item
    )
  ) {
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


async function discoverProduct(
  product
) {
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

  const data =
    await apiRequest(
      `/search?${params.toString()}`
    );

  const results =
    extractSearchResults(data);

  /*
    ALERT SCANNER STILL LOOKS FOR
    WALMART-DIRECT ONLY.
  */
  const match =
    results.find(
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
        product.msrp ??
        null,

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
    getItemId(match);

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
        product.msrp ??
        null,

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

  return discoverProduct(product);
}


/*
  SAFE SEARCH DIAGNOSTIC
*/
async function inspectSearchResponse(
  keyword = "Pokemon TCG"
) {
  const params =
    new URLSearchParams({
      page: "1",
      sort: "best_match",
      keyword
    });

  const data =
    await apiRequest(
      `/search?${params.toString()}`
    );

  const topLevelKeys =
    data &&
    typeof data === "object"
      ? Object.keys(data)
      : [];

  const nestedDataKeys =
    data?.data &&
    typeof data.data === "object" &&
    !Array.isArray(data.data)
      ? Object.keys(data.data)
      : [];

  const results =
    extractSearchResults(data);

  return {
    keyword,

    topLevelKeys,

    nestedDataKeys,

    extractedCount:
      results.length,

    sampleItemKeys:
      results[0] &&
      typeof results[0] === "object"
        ? Object.keys(
            results[0]
          )
        : [],

    sampleName:
      results[0]
        ? (
            results[0].name ||
            results[0].title ||
            null
          )
        : null
  };
}


module.exports = {
  checkProduct,
  searchMarketplaceOffers,
  buildMarketplaceOffers,
  inspectSearchResponse,
  extractSearchResults
};
