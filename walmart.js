const HOST =
  process.env.WALMART_RAPIDAPI_HOST ||
  "realtime-walmart-data.p.rapidapi.com";

const API_KEY =
  process.env.WALMART_RAPIDAPI_KEY;

const REQUEST_TIMEOUT_MS =
  Math.max(
    3000,
    Number(
      process.env.WALMART_REQUEST_TIMEOUT_MS ||
      7000
    )
  );

const discoveredItems =
  new Map();


/* ========================================
   BASIC HELPERS
======================================== */

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

  const cleaned =
    String(value)
      .replace(/,/g, "")
      .replace(/[^0-9.]/g, "");

  if (!cleaned) {
    return null;
  }

  const number =
    Number(cleaned);

  return Number.isFinite(number)
    ? number
    : null;
}


function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function isWalmartSeller(value) {
  const seller =
    normalize(value);

  return (
    seller === "walmart" ||
    seller === "walmart com"
  );
}


function isTimeoutError(error) {
  return Boolean(
    error &&
    (
      error.code ===
        "WALMART_TIMEOUT" ||

      String(
        error.message ||
        ""
      ).toLowerCase()
        .includes(
          "timed out"
        )
    )
  );
}


function getSellerName(item) {
  if (item.sellerName) {
    return item.sellerName;
  }

  if (item.sellerDisplayName) {
    return item.sellerDisplayName;
  }

  if (
    typeof item.seller === "string"
  ) {
    return item.seller;
  }

  if (
    item.seller &&
    typeof item.seller === "object"
  ) {
    return (
      item.seller.name ||
      null
    );
  }

  return null;
}


function getSellerType(item) {
  return normalize(
    item.otherDetails
      ?.sellerType ||
    item.sellerType
  );
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


function getItemId(item) {
  return (
    item.usItemId ||
    item.itemId ||
    item.id ||
    null
  );
}


/* ========================================
   PRODUCT CLASSIFICATION
======================================== */

function detectSet(value) {
  const text =
    normalize(value);

  if (
    text.includes(
      "prismatic evolutions"
    )
  ) {
    return "prismatic-evolutions";
  }

  if (
    text.includes(
      "destined rivals"
    )
  ) {
    return "destined-rivals";
  }

  if (
    text.includes(
      "ascended heroes"
    )
  ) {
    return "ascended-heroes";
  }

  if (
    text.includes(
      "delta reign"
    )
  ) {
    return "delta-reign";
  }

  if (
    text.includes(
      "30th anniversary"
    ) ||
    text.includes(
      "30th celebration"
    )
  ) {
    return "30th-anniversary";
  }

  return null;
}


function detectProductType(value) {
  const text =
    normalize(value);

  if (
    text.includes(
      "elite trainer box"
    ) ||
    /\betb\b/.test(text)
  ) {
    return "etb";
  }

  if (
    text.includes(
      "booster bundle"
    )
  ) {
    return "booster-bundle";
  }

  if (
    text.includes(
      "booster box"
    ) ||
    text.includes(
      "display box"
    )
  ) {
    return "booster-box";
  }

  if (
    text.includes(
      "poster collection"
    )
  ) {
    return "poster-collection";
  }

  if (
    text.includes(
      "tech sticker"
    )
  ) {
    return "tech-sticker";
  }

  if (
    text.includes(
      "mini tin"
    )
  ) {
    return "mini-tin";
  }

  if (
    text.includes("tin")
  ) {
    return "tin";
  }

  if (
    text.includes(
      "collection"
    )
  ) {
    return "collection";
  }

  if (
    text.includes(
      "booster pack"
    )
  ) {
    return "booster-pack";
  }

  return null;
}


function isGradedListing(value) {
  const text =
    normalize(value);

  return (
    /\bpsa\s*[0-9]+\b/.test(text) ||
    /\bbgs\s*[0-9]+\b/.test(text) ||
    /\bcgc\s*[0-9]+\b/.test(text) ||
    text.includes("graded card") ||
    text.includes("graded pokemon")
  );
}


function isPokemonListing(value) {
  const text =
    normalize(value);

  return text.includes(
    "pokemon"
  );
}


/* ========================================
   GENERAL PRODUCT MATCHING
======================================== */

function productMatches(
  product,
  item
) {
  const expected =
    normalize(
      product.name ||
      product.searchTerm
    );

  const actual =
    normalize(
      item.name ||
      item.title
    );

  if (
    !expected ||
    !actual
  ) {
    return false;
  }

  if (!isPokemonListing(actual)) {
    return false;
  }

  const ignored =
    new Set([
      "pokemon",
      "tcg",
      "the",
      "and",
      "collection",
      "trading",
      "card",
      "game",
      "scarlet",
      "violet"
    ]);

  const words =
    expected
      .split(" ")
      .filter(
        word =>
          word.length > 2 &&
          !ignored.has(word)
      );

  if (!words.length) {
    return false;
  }

  const matches =
    words.filter(
      word =>
        actual.includes(word)
    ).length;

  return (
    matches /
    words.length
  ) >= 0.65;
}


/* ========================================
   STRICT DISPLAY MATCHING
======================================== */

function displayProductMatches(
  product,
  item
) {
  const actualName =
    item.name ||
    item.title ||
    "";

  const actual =
    normalize(actualName);

  if (!actual) {
    return false;
  }

  if (!isPokemonListing(actual)) {
    return false;
  }

  if (isGradedListing(actual)) {
    return false;
  }

  const expectedSet =
    detectSet(
      [
        product.set,
        product.name,
        product.searchTerm
      ]
        .filter(Boolean)
        .join(" ")
    );

  const actualSet =
    detectSet(actual);

  if (
    expectedSet &&
    actualSet &&
    actualSet !== expectedSet
  ) {
    return false;
  }

  const expectedType =
    detectProductType(
      [
        product.productType,
        product.name,
        product.searchTerm
      ]
        .filter(Boolean)
        .join(" ")
    );

  const actualType =
    detectProductType(actual);

  if (
    expectedType &&
    actualType &&
    actualType !== expectedType
  ) {
    return false;
  }

  if (
    expectedType === "etb" &&
    (
      actual.includes(
        "booster bundle"
      ) ||
      actual.includes(
        "2 pack"
      ) ||
      actual.includes(
        "2-pack"
      ) ||
      actual.includes(
        "two pack"
      )
    )
  ) {
    return false;
  }

  return productMatches(
    product,
    item
  );
}


/* ========================================
   STRICT MARKETPLACE MATCHING
======================================== */

function marketplaceProductMatches(
  product,
  item
) {
  if (
    !displayProductMatches(
      product,
      item
    )
  ) {
    return false;
  }

  const price =
    getPrice(item);

  if (
    price === null ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return false;
  }

  return true;
}


/* ========================================
   WALMART API REQUEST
======================================== */

async function apiRequest(path) {
  if (!API_KEY) {
    throw new Error(
      "WALMART_RAPIDAPI_KEY is missing"
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        `https://${HOST}${path}`,
        {
          method:
            "GET",

          headers: {
            "x-rapidapi-key":
              API_KEY,

            "x-rapidapi-host":
              HOST
          },

          signal:
            controller.signal
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
      error.name ===
        "AbortError"
    ) {
      const timeoutError =
        new Error(
          `Walmart API request timed out after ${REQUEST_TIMEOUT_MS}ms`
        );

      timeoutError.code =
        "WALMART_TIMEOUT";

      throw timeoutError;
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}


/* ========================================
   NORMALIZE WALMART RESULT
======================================== */

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
    isWalmartSeller(
      sellerName
    ) &&
    sellerType !==
      "external";

  const price =
    getPrice(item);

  const availability =
    getAvailability(item);

  const offerAvailable =
    availability ===
      "in stock" ||
    availability ===
      "instock" ||
    availability ===
      "available";

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
    productId:
      product.id,

    name:
      item.name ||
      item.title ||
      product.name,

    set:
      product.set,

    retailer:
      "walmart",

    channel:
      "online",

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
      new Date()
        .toISOString(),

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


/* ========================================
   SEARCH RESULT EXTRACTION
======================================== */

function extractSearchResults(
  data
) {
  if (
    Array.isArray(
      data?.results
    )
  ) {
    return data.results;
  }

  if (
    Array.isArray(
      data?.items
    )
  ) {
    return data.items;
  }

  if (
    Array.isArray(
      data?.products
    )
  ) {
    return data.products;
  }

  if (
    Array.isArray(
      data?.data
    )
  ) {
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
      data?.searchResult
        ?.items
    )
  ) {
    return (
      data.searchResult.items
    );
  }

  return [];
}


/* ========================================
   MARKETPLACE OFFER BUILDER
======================================== */

function buildMarketplaceOffers(
  product,
  results,
  source =
    "walmart-marketplace-search"
) {
  const offers =
    results
      .filter(
        item =>
          marketplaceProductMatches(
            product,
            item
          )
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
          item.price !== null &&
          Number.isFinite(
            Number(item.price)
          ) &&
          Number(item.price) > 0
      );

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

    const existing =
      unique.get(key);

    if (
      !existing ||
      Number(offer.price) <
        Number(existing.price)
    ) {
      unique.set(
        key,
        offer
      );
    }
  }

  return Array.from(
    unique.values()
  ).sort(
    (a, b) =>
      Number(a.price) -
      Number(b.price)
  );
}


/* ========================================
   MARKETPLACE SEARCH
======================================== */

async function searchMarketplaceOffers(
  product
) {
  const keyword =
    product.searchTerm ||
    product.name ||
    "Pokemon";

  const params =
    new URLSearchParams({
      page:
        "1",

      sort:
        "price_low",

      keyword
    });

  const data =
    await apiRequest(
      `/search?${params.toString()}`
    );

  const results =
    extractSearchResults(
      data
    );

  return buildMarketplaceOffers(
    product,
    results
  );
}


/* ========================================
   KNOWN ITEM CHECK
======================================== */

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
    typeof item !==
      "object" ||
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


/* ========================================
   WALMART-DIRECT DISCOVERY
======================================== */

async function discoverProduct(
  product
) {
  const keyword =
    product.searchTerm ||
    product.name ||
    "Pokemon";

  const params =
    new URLSearchParams({
      page:
        "1",

      sort:
        "best_match",

      keyword
    });

  const data =
    await apiRequest(
      `/search?${params.toString()}`
    );

  const results =
    extractSearchResults(
      data
    );


  /*
    FIRST:
    Find a Walmart-direct result.

    Only this result can count as
    direct Walmart stock.
  */

  const directMatch =
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


  if (directMatch) {
    const itemId =
      getItemId(
        directMatch
      );

    if (itemId) {
      discoveredItems.set(
        product.id,
        String(itemId)
      );
    }

    return {
      ...makeResult(
        product,
        directMatch,
        "walmart-discovery"
      ),

      discoveryMode:
        !itemId
    };
  }


  /*
    SECOND:
    If Walmart Direct is unavailable,
    find a safe display result.

    This may provide image/name/link,
    but can never trigger a Walmart
    direct stock alert.
  */

  const displayMatch =
    results.find(
      item =>
        displayProductMatches(
          product,
          item
        )
    );


  if (displayMatch) {
    const preview =
      makeResult(
        product,
        displayMatch,
        "walmart-display-preview"
      );

    return {
      ...preview,

      channel:
        "online",

      inStock:
        false,

      directSeller:
        false,

      marketplaceOnly:
        false,

      alertEligible:
        false,

      discoveryMode:
        true,

      previewOnly:
        true,

      previewSeller:
        preview.seller,

      error:
        "No validated Walmart-direct result found"
    };
  }


  /*
    Nothing safe enough was found.
  */

  return {
    productId:
      product.id,

    name:
      product.name,

    set:
      product.set,

    retailer:
      "walmart",

    channel:
      "online",

    inStock:
      false,

    directSeller:
      false,

    price:
      null,

    msrp:
      product.msrp ??
      null,

    url:
      null,

    seller:
      null,

    sellerType:
      null,

    checkedAt:
      new Date()
        .toISOString(),

    source:
      "walmart-discovery",

    discoveryMode:
      true,

    previewOnly:
      false,

    marketplaceOnly:
      false,

    offerAvailable:
      false,

    alertEligible:
      false,

    image:
      null,

    error:
      "No validated Walmart-direct result found"
  };
}


/* ========================================
   TIMEOUT RESULT
======================================== */

function makeTimeoutResult(
  product,
  message
) {
  return {
    productId:
      product.id,

    name:
      product.name,

    set:
      product.set,

    retailer:
      "walmart",

    channel:
      "online",

    inStock:
      false,

    directSeller:
      false,

    price:
      null,

    msrp:
      product.msrp ??
      null,

    url:
      product.walmartItemId
        ? `https://www.walmart.com/ip/${product.walmartItemId}`
        : null,

    seller:
      null,

    sellerType:
      null,

    checkedAt:
      new Date()
        .toISOString(),

    source:
      "walmart-timeout",

    marketplaceOnly:
      false,

    offerAvailable:
      false,

    alertEligible:
      false,

    image:
      null,

    error:
      message ||
      "Walmart API request timed out"
  };
}


/* ========================================
   MAIN STOCK CHECK
======================================== */

async function checkProduct(
  product,
  retailer
) {
  if (
    retailer !==
    "walmart"
  ) {
    return {
      productId:
        product.id,

      name:
        product.name,

      set:
        product.set,

      retailer,

      channel:
        "online",

      inStock:
        false,

      directSeller:
        false,

      price:
        null,

      msrp:
        product.msrp ??
        null,

      url:
        null,

      seller:
        null,

      sellerType:
        null,

      checkedAt:
        new Date()
          .toISOString(),

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

      /*
        IMPORTANT:
        If Walmart itself timed out,
        do NOT immediately make a second
        search request for the same item.

        That was causing a single timeout
        to become two slow requests.
      */
      if (
        isTimeoutError(error)
      ) {
        return makeTimeoutResult(
          product,
          error.message
        );
      }

      /*
        The saved ID is invalid or no
        longer matches. Remove it and
        allow discovery to find another.
      */
      discoveredItems.delete(
        product.id
      );
    }
  }

  try {
    return await discoverProduct(
      product
    );

  } catch (error) {
    if (
      isTimeoutError(error)
    ) {
      return makeTimeoutResult(
        product,
        error.message
      );
    }

    throw error;
  }
}


/* ========================================
   SAFE SEARCH DIAGNOSTIC
======================================== */

async function inspectSearchResponse(
  keyword =
    "Pokemon TCG"
) {
  const params =
    new URLSearchParams({
      page:
        "1",

      sort:
        "best_match",

      keyword
    });

  const data =
    await apiRequest(
      `/search?${params.toString()}`
    );

  const topLevelKeys =
    data &&
    typeof data ===
      "object"
      ? Object.keys(data)
      : [];

  const nestedDataKeys =
    data?.data &&
    typeof data.data ===
      "object" &&
    !Array.isArray(
      data.data
    )
      ? Object.keys(
          data.data
        )
      : [];

  const results =
    extractSearchResults(
      data
    );

  return {
    keyword,

    requestTimeoutMs:
      REQUEST_TIMEOUT_MS,

    topLevelKeys,

    nestedDataKeys,

    extractedCount:
      results.length,

    sampleItemKeys:
      results[0] &&
      typeof results[0] ===
        "object"
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


/* ========================================
   EXPORTS
======================================== */

module.exports = {
  checkProduct,
  searchMarketplaceOffers,
  buildMarketplaceOffers,
  inspectSearchResponse,
  extractSearchResults
};
