const catalogProducts = require("./products.json");

/* ========================================
   WALMART PROVIDER CONFIG
======================================== */

const RAPIDAPI_HOST =
  process.env.WALMART_RAPIDAPI_HOST ||
  "axesso-walmart-data-service.p.rapidapi.com";

const RAPIDAPI_KEY =
  process.env.WALMART_RAPIDAPI_KEY;

const HASDATA_API_KEY =
  process.env.HASDATA_API_KEY;

const RAPIDAPI_TIMEOUT_MS = Math.max(
  5000,
  Number(
    process.env.WALMART_REQUEST_TIMEOUT_MS ||
    12000
  )
);

const HASDATA_TIMEOUT_MS = Math.max(
  3000,
  Number(
    process.env.HASDATA_TIMEOUT_MS ||
    7000
  )
);

const HASDATA_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(
    3,
    Number(
      process.env.HASDATA_MAX_ATTEMPTS ||
      2
    )
  )
);

const HASDATA_RETRY_DELAY_MS = Math.max(
  100,
  Number(
    process.env.HASDATA_RETRY_DELAY_MS ||
    500
  )
);

/*
  Do not lock Walmart for an hour anymore.
  A temporary authentication/provider failure
  will cool down for 5 minutes.
*/
const RAPIDAPI_AUTH_COOLDOWN_MS = Math.max(
  60000,
  Number(
    process.env.RAPIDAPI_AUTH_COOLDOWN_MS ||
    300000
  )
);

const discoveredItems = new Map();

let lastUpcoming = [];
let lastDiscoveredDeals = [];

let rapidApiCircuit = {
  open: false,
  reason: null,
  openedAt: null,
  retryAfter: null
};

const providerHealth = {
  axesso: {
    requests: 0,
    successes: 0,
    failures: 0,
    blockedRequests: 0,
    lastSuccess: null,
    lastError: null
  },

  hasdata: {
    requests: 0,
    successes: 0,
    failures: 0,
    retries: 0,
    lastSuccess: null,
    lastError: null
  }
};


/* ========================================
   BASIC HELPERS
======================================== */

function markProviderStart(name) {
  if (!providerHealth[name]) return;

  providerHealth[name].requests += 1;
}

function markProviderSuccess(name) {
  if (!providerHealth[name]) return;

  providerHealth[name].successes += 1;
  providerHealth[name].lastSuccess =
    new Date().toISOString();

  providerHealth[name].lastError = null;
}

function markProviderFailure(
  name,
  error
) {
  if (!providerHealth[name]) return;

  providerHealth[name].failures += 1;

  providerHealth[name].lastError =
    error?.message ||
    String(error);
}

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value === "number"
  ) {
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


/* ========================================
   SELLER RULES
======================================== */

function isWalmartSeller(value) {
  const seller =
    normalize(value);

  return (
    seller === "walmart" ||
    seller === "walmart com" ||
    seller === "walmartcom" ||
    seller === "walmart inc"
  );
}

function isGtApprovedSeller(value) {
  const seller =
    normalize(value);

  if (!seller) {
    return false;
  }

  return (
    seller.includes(
      "gt collectibles"
    ) ||
    seller.includes(
      "gt collectible"
    ) ||
    seller.includes(
      "gt mj holdings"
    ) ||
    seller.includes(
      "gtmj holdings"
    ) ||
    (
      seller.includes("gt") &&
      seller.includes("collectibles")
    )
  );
}

function isApprovedSeller(value) {
  return (
    isWalmartSeller(value) ||
    isGtApprovedSeller(value)
  );
}


/* ========================================
   AXESSO FIELD READERS
======================================== */

function getSellerName(item) {
  if (!item) {
    return null;
  }

  if (
    typeof item.sellerName ===
    "string"
  ) {
    return item.sellerName;
  }

  if (
    typeof item.sellerDisplayName ===
    "string"
  ) {
    return item.sellerDisplayName;
  }

  if (
    typeof item.seller ===
    "string"
  ) {
    return item.seller;
  }

  if (
    item.seller &&
    typeof item.seller ===
      "object"
  ) {
    return (
      item.seller.name ||
      item.seller.displayName ||
      item.seller.sellerName ||
      null
    );
  }

  return (
    item?.sellerInfo?.sellerName ||
    item?.sellerInfo?.displayName ||
    item?.sellerInfo?.name ||
    item?.sellerDisplayName ||
    null
  );
}

function getSellerType(item) {
  return normalize(
    item?.sellerType ||
    item?.sellerInfo?.sellerType ||
    item?.otherDetails?.sellerType
  );
}

function getPrice(item) {
  return parsePrice(
    item?.priceInfo
      ?.currentPrice
      ?.price ??

    item?.priceInfo
      ?.currentPrice
      ?.priceString ??

    item?.priceInfo
      ?.currentPrice
      ?.displayValue ??

    item?.priceInfo
      ?.currentPrice ??

    item?.price
      ?.currentPrice ??

    item?.price
      ?.currentPriceDisplay ??

    item?.priceDetails
      ?.currentPrice
      ?.price ??

    item?.priceDetails
      ?.currentPrice
      ?.priceString ??

    item?.currentPrice ??

    item?.salePrice ??

    (
      typeof item?.price ===
        "number"
        ? item.price
        : null
    )
  );
}

function getImage(item) {
  if (!item) {
    return null;
  }

  if (
    item?.imageInfo?.thumbnailUrl
  ) {
    return (
      item.imageInfo.thumbnailUrl
    );
  }

  if (
    item?.imageInfo?.imageUrl
  ) {
    return (
      item.imageInfo.imageUrl
    );
  }

  if (
    item?.imageInfo?.allImages &&
    Array.isArray(
      item.imageInfo.allImages
    ) &&
    item.imageInfo.allImages.length
  ) {
    const first =
      item.imageInfo.allImages[0];

    if (
      typeof first === "string"
    ) {
      return first;
    }

    return (
      first?.url ||
      first?.imageUrl ||
      first?.thumbnailUrl ||
      null
    );
  }

  if (
    Array.isArray(item.images) &&
    item.images.length
  ) {
    const first =
      item.images[0];

    if (
      typeof first === "string"
    ) {
      return first;
    }

    return (
      first?.url ||
      first?.imageUrl ||
      first?.src ||
      null
    );
  }

  return (
    item.image ||
    item.imageUrl ||
    item.thumbnailUrl ||
    item.primaryImage ||
    null
  );
}

function getAvailability(item) {
  return normalize(
    item?.availabilityStatusV2
      ?.value ||

    item?.availabilityStatusV2
      ?.display ||

    item?.availability ||

    item?.availabilityStatus ||

    item?.stockStatus ||

    item?.otherDetails
      ?.availabilityStatusV2
      ?.value ||

    item?.otherDetails
      ?.availabilityStatusV2
      ?.display ||

    item?.otherDetails
      ?.availabilityStatus ||

    item?.shippingOption
      ?.availabilityStatus
  );
}

function getItemId(item) {
  return (
    item?.usItemId ||
    item?.itemId ||
    item?.id ||
    item?.productId ||
    null
  );
}

function getProductName(item) {
  return (
    item?.name ||
    item?.title ||
    item?.productName ||
    ""
  );
}

function getProductUrl(item) {
  const itemId =
    getItemId(item);

  let url =
    item?.canonicalUrl ||
    item?.productUrl ||
    item?.url ||
    null;

  if (
    url &&
    String(url).startsWith("/")
  ) {
    url =
      `https://www.walmart.com${url}`;
  }

  if (!url && itemId) {
    url =
      `https://www.walmart.com/ip/${itemId}`;
  }

  return url;
}


/* ========================================
   PRODUCT STATUS
======================================== */

function normalizeStatus(
  value,
  inStock = false
) {
  const text =
    normalize(value);

  if (
    /pre ?order|raffle|drawing|scheduled drop|coming soon/
      .test(text)
  ) {
    return "preorder";
  }

  if (
    text.includes("on hand")
  ) {
    return "onhand";
  }

  if (
    text.includes("transit")
  ) {
    return "transit";
  }

  if (
    text.includes("ordered")
  ) {
    return "ordered";
  }

  /*
    Negative status MUST
    be checked first.
  */
  if (
    /out of stock|unavailable|sold out|not available|out_of_stock/
      .test(text)
  ) {
    return "out";
  }

  if (
    /in stock|instock|available|in_stock/
      .test(text) ||
    inStock === true
  ) {
    return "instock";
  }

  return "out";
}

function detectDropType(item) {
  const text =
    normalize(
      [
        item?.title,
        item?.name,
        item?.availability,
        item?.availabilityStatus,
        item?.availabilityStatusV2
          ?.display,
        item?.url,
        item?.canonicalUrl
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (
    /raffle|drawing|lottery/
      .test(text)
  ) {
    return "raffle";
  }

  if (
    /pre ?order/
      .test(text)
  ) {
    return "preorder";
  }

  if (
    /scheduled drop|coming soon/
      .test(text)
  ) {
    return "scheduled";
  }

  return null;
}


/* ========================================
   POKEMON DETECTION
======================================== */

function isPokemonListing(value) {
  return normalize(value)
    .includes("pokemon");
}

function isGradedListing(value) {
  const text =
    normalize(value);

  return (
    /\bpsa\s*[0-9]+\b/
      .test(text) ||

    /\bbgs\s*[0-9]+\b/
      .test(text) ||

    /\bcgc\s*[0-9]+\b/
      .test(text) ||

    text.includes(
      "graded card"
    ) ||

    text.includes(
      "graded pokemon"
    )
  );
}

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
    /\betb\b/
      .test(text)
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


/* ========================================
   MATCHING
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
      getProductName(item)
    );

  if (
    !expected ||
    !actual ||
    !isPokemonListing(actual) ||
    isGradedListing(actual)
  ) {
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
      words.length >=
    0.65
  );
}

function displayProductMatches(
  product,
  item
) {
  const actualName =
    getProductName(item);

  const actual =
    normalize(actualName);

  if (
    !actual ||
    !isPokemonListing(actual) ||
    isGradedListing(actual)
  ) {
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
    actualSet !==
      expectedSet
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
    detectProductType(
      actual
    );

  if (
    expectedType &&
    actualType &&
    actualType !==
      expectedType
  ) {
    return false;
  }

  return productMatches(
    product,
    item
  );
}


/* ========================================
   MSRP / PRICE QUALIFICATION
======================================== */

function findCatalogMatchForItem(
  item
) {
  const name =
    getProductName(item);

  if (
    !name ||
    !isPokemonListing(name)
  ) {
    return null;
  }

  let best = null;
  let bestScore = 0;

  for (
    const product of
    catalogProducts
  ) {
    if (
      product.enabled === false ||
      product.msrp == null
    ) {
      continue;
    }

    const expected =
      normalize(
        product.name ||
        product.searchTerm
      );

    const actual =
      normalize(name);

    if (
      !expected ||
      !actual
    ) {
      continue;
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
      continue;
    }

    const matched =
      words.filter(
        word =>
          actual.includes(word)
      ).length;

    const score =
      matched /
      words.length;

    if (
      score > bestScore
    ) {
      bestScore = score;
      best = product;
    }
  }

  if (
    bestScore < 0.65
  ) {
    return null;
  }

  return best;
}

function resolveMsrp(
  item,
  requestedProduct = null
) {
  if (
    requestedProduct &&
    requestedProduct.msrp != null &&
    displayProductMatches(
      requestedProduct,
      item
    )
  ) {
    return Number(
      requestedProduct.msrp
    );
  }

  const catalogMatch =
    findCatalogMatchForItem(
      item
    );

  if (
    !catalogMatch ||
    catalogMatch.msrp == null
  ) {
    return null;
  }

  const msrp =
    Number(
      catalogMatch.msrp
    );

  return Number.isFinite(msrp)
    ? msrp
    : null;
}

function withinPriceRule(
  price,
  msrp
) {
  const amount =
    Number(price);

  const retail =
    Number(msrp);

  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(retail) ||
    amount <= 0 ||
    retail <= 0
  ) {
    return false;
  }

  return (
    amount <=
    retail * 1.5
  );
}


/* ========================================
   HTTP
======================================== */

async function fetchJson(
  url,
  options,
  timeoutMs,
  timeoutCode,
  timeoutLabel
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          ...options,
          signal:
            controller.signal
        }
      );

    if (!response.ok) {
      const body =
        await response.text()
          .catch(
            () => ""
          );

      const error =
        new Error(
          `${timeoutLabel} returned ${response.status}` +
          (
            body
              ? `: ${body.slice(0, 200)}`
              : ""
          )
        );

      error.status =
        response.status;

      throw error;
    }

    return await response.json();

  } catch (error) {

    if (
      error?.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error(
          `${timeoutLabel} request timed out after ${timeoutMs}ms`
        );

      timeoutError.code =
        timeoutCode;

      throw timeoutError;
    }

    throw error;

  } finally {

    clearTimeout(
      timeout
    );
  }
}


/* ========================================
   AXESSO CIRCUIT
======================================== */

function openRapidApiCircuit(
  error
) {
  const now =
    Date.now();

  rapidApiCircuit = {
    open: true,

    reason:
      error?.message ||
      "RapidAPI authentication failure",

    openedAt:
      new Date(
        now
      ).toISOString(),

    retryAfter:
      new Date(
        now +
        RAPIDAPI_AUTH_COOLDOWN_MS
      ).toISOString()
  };

  console.error(
    "Axesso circuit opened:",
    rapidApiCircuit
  );
}

function closeRapidApiCircuit() {
  rapidApiCircuit = {
    open: false,
    reason: null,
    openedAt: null,
    retryAfter: null
  };
}

function rapidApiCircuitIsBlocking() {
  if (
    !rapidApiCircuit.open
  ) {
    return false;
  }

  const retryAfterMs =
    Date.parse(
      rapidApiCircuit.retryAfter ||
      ""
    );

  if (
    Number.isFinite(
      retryAfterMs
    ) &&
    Date.now() >=
      retryAfterMs
  ) {
    closeRapidApiCircuit();

    return false;
  }

  return true;
}

async function axessoRequest(
  path
) {
  if (!RAPIDAPI_KEY) {
    const error =
      new Error(
        "WALMART_RAPIDAPI_KEY is missing"
      );

    error.code =
      "RAPIDAPI_NOT_CONFIGURED";

    throw error;
  }

  if (
    rapidApiCircuitIsBlocking()
  ) {
    providerHealth
      .axesso
      .blockedRequests += 1;

    const error =
      new Error(
        `Axesso temporarily disabled. Retry after ${rapidApiCircuit.retryAfter}`
      );

    error.code =
      "RAPIDAPI_CIRCUIT_OPEN";

    throw error;
  }

  markProviderStart(
    "axesso"
  );

  try {
    const data =
      await fetchJson(
        `https://${RAPIDAPI_HOST}${path}`,

        {
          method: "GET",

          headers: {
            "x-rapidapi-key":
              RAPIDAPI_KEY,

            "x-rapidapi-host":
              RAPIDAPI_HOST
          }
        },

        RAPIDAPI_TIMEOUT_MS,
        "WALMART_TIMEOUT",
        "Axesso Walmart API"
      );

    markProviderSuccess(
      "axesso"
    );

    closeRapidApiCircuit();

    return data;

  } catch (error) {

    markProviderFailure(
      "axesso",
      error
    );

    if (
      error?.status === 401 ||
      error?.status === 403
    ) {
      openRapidApiCircuit(
        error
      );
    }

    throw error;
  }
}


/* ========================================
   AXESSO SEARCH
======================================== */

function extractSearchResults(
  data
) {
  const found = [];

  const add =
    items => {

      if (
        !Array.isArray(items)
      ) {
        return;
      }

      for (
        const item of items
      ) {
        if (
          item &&
          typeof item ===
            "object"
        ) {
          found.push(
            item
          );
        }
      }
    };

  /*
    Axesso response observed:
    item
      .props
      .pageProps
      .initialData
      .searchResult
      .itemStacks[]
      .items[]
  */

  const searchResult =
    data?.item
      ?.props
      ?.pageProps
      ?.initialData
      ?.searchResult ||

    data?.props
      ?.pageProps
      ?.initialData
      ?.searchResult ||

    data?.pageProps
      ?.initialData
      ?.searchResult ||

    data?.initialData
      ?.searchResult ||

    data?.searchResult ||
    null;

  if (
    Array.isArray(
      searchResult?.itemStacks
    )
  ) {
    for (
      const stack of
      searchResult.itemStacks
    ) {
      add(
        stack?.items
      );
    }
  }

  add(
    searchResult?.items
  );

  add(
    data?.items
  );

  add(
    data?.products
  );

  add(
    data?.results
  );

  add(
    data?.data?.items
  );

  add(
    data?.data?.products
  );

  add(
    data?.data?.results
  );

  const unique =
    new Map();

  for (
    const item of found
  ) {
    const key =
      String(
        getItemId(item) ||
        getProductUrl(item) ||
        getProductName(item)
      );

    if (
      !key ||
      key === "undefined"
    ) {
      continue;
    }

    if (
      !unique.has(key)
    ) {
      unique.set(
        key,
        item
      );
    }
  }

  return Array.from(
    unique.values()
  );
}

async function axessoSearch(
  keyword
) {
  const params =
    new URLSearchParams({
      sortBy:
        "best_match",

      page:
        "1",

      keyword:
        keyword ||
        "Pokemon TCG"
    });

  const data =
    await axessoRequest(
      `/wlm/walmart-search-by-keyword?${params.toString()}`
    );

  return {
    raw: data,

    results:
      extractSearchResults(
        data
      )
  };
}


/* ========================================
   OPTIONAL HASDATA BACKUP
======================================== */

function isTransientHasDataError(
  error
) {
  if (
    error?.code ===
    "HASDATA_TIMEOUT"
  ) {
    return true;
  }

  const status =
    Number(
      error?.status
    );

  return (
    status === 408 ||
    status === 429 ||
    (
      status >= 500 &&
      status <= 599
    )
  );
}

async function hasDataSearchOnce(
  query
) {
  const params =
    new URLSearchParams({
      q:
        query,

      domain:
        "walmart.com",

      language:
        "en",

      sort:
        "bestMatch",

      page:
        "1",

      deliveryType:
        "shipping"
    });

  return await fetchJson(
    `https://api.hasdata.com/scrape/walmart/search?${params.toString()}`,

    {
      method:
        "GET",

      headers: {
        "x-api-key":
          HASDATA_API_KEY,

        "Content-Type":
          "application/json"
      }
    },

    HASDATA_TIMEOUT_MS,
    "HASDATA_TIMEOUT",
    "HasData Walmart"
  );
}

async function hasDataSearch(
  query
) {
  if (
    !HASDATA_API_KEY
  ) {
    throw new Error(
      "HASDATA_API_KEY is missing"
    );
  }

  let lastError =
    null;

  for (
    let attempt = 1;
    attempt <=
      HASDATA_MAX_ATTEMPTS;
    attempt += 1
  ) {
    markProviderStart(
      "hasdata"
    );

    try {
      const data =
        await hasDataSearchOnce(
          query
        );

      markProviderSuccess(
        "hasdata"
      );

      return Array.isArray(
        data?.productResults
      )
        ? data.productResults
        : [];

    } catch (error) {

      lastError =
        error;

      markProviderFailure(
        "hasdata",
        error
      );

      const canRetry =
        attempt <
          HASDATA_MAX_ATTEMPTS &&
        isTransientHasDataError(
          error
        );

      if (!canRetry) {
        break;
      }

      providerHealth
        .hasdata
        .retries += 1;

      await sleep(
        HASDATA_RETRY_DELAY_MS *
        attempt
      );
    }
  }

  throw (
    lastError ||
    new Error(
      "HasData request failed"
    )
  );
}


/* ========================================
   RESULT BUILDER
======================================== */

function makeResult(
  product,
  item,
  source
) {
  const sellerName =
    getSellerName(item);

  const directSeller =
    isWalmartSeller(
      sellerName
    );

  const approvedSeller =
    isApprovedSeller(
      sellerName
    );

  const gtApprovedSeller =
    isGtApprovedSeller(
      sellerName
    );

  const sellerType =
    getSellerType(item);

  const price =
    getPrice(item);

  const msrp =
    resolveMsrp(
      item,
      product
    );

  const priceQualified =
    withinPriceRule(
      price,
      msrp
    );

  const availability =
    getAvailability(item);

  const status =
    normalizeStatus(
      availability
    );

  const offerAvailable =
    status ===
    "instock";

  const itemId =
    getItemId(item);

  const dropType =
    detectDropType(item);

  /*
    Only qualifying approved sellers
    are considered visible deals.
  */
  const displayEligible =
    approvedSeller &&
    priceQualified;

  /*
    Existing push behavior stays conservative:
    Walmart Direct only.
    GT remains visible but separate.
  */
  const inStock =
    directSeller &&
    offerAvailable &&
    priceQualified;

  return {
    productId:
      product?.id ||
      (
        itemId
          ? `walmart-${itemId}`
          : null
      ),

    name:
      getProductName(item) ||
      product?.name ||
      "Walmart Pokémon Product",

    set:
      product?.set ||
      detectSet(
        getProductName(item)
      ) ||
      "Auto Discovered",

    productType:
      product?.productType ||
      detectProductType(
        getProductName(item)
      ),

    retailer:
      "walmart",

    retailerLabel:
      "Walmart",

    channel:
      "online",

    storeId:
      null,

    storeName:
      null,

    status,

    rawStatus:
      availability ||
      "",

    dropType,

    upcoming:
      status ===
        "preorder" ||
      Boolean(
        dropType
      ),

    inStock,

    offerAvailable,

    price,

    msrp,

    withinPriceRule:
      priceQualified,

    displayEligible,

    directSeller,

    approvedSeller,

    gtApprovedSeller,

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
            gtApprovedSeller
              ? "gt-approved"
              : (
                  sellerType ||
                  "marketplace"
                )
          ),

    marketplaceOnly:
      !directSeller,

    alertEligible:
      directSeller &&
      offerAvailable &&
      priceQualified,

    walmartItemId:
      itemId,

    image:
      getImage(item),

    url:
      getProductUrl(item),

    checkedAt:
      new Date()
        .toISOString(),

    source,

    autoDiscovered:
      !product?.id
  };
}


/* ========================================
   DISCOVER QUALIFYING DEALS
======================================== */

function collectQualifiedDeals(
  results
) {
  const deals = [];

  for (
    const item of results
  ) {
    const name =
      getProductName(item);

    if (
      !isPokemonListing(
        name
      ) ||
      isGradedListing(
        name
      )
    ) {
      continue;
    }

    const seller =
      getSellerName(item);

    if (
      !isApprovedSeller(
        seller
      )
    ) {
      continue;
    }

    const msrp =
      resolveMsrp(
        item
      );

    const price =
      getPrice(item);

    /*
      User rule:
      if MSRP is unknown,
      do not qualify it yet.
    */
    if (
      !withinPriceRule(
        price,
        msrp
      )
    ) {
      continue;
    }

    const result =
      makeResult(
        null,
        item,
        "axesso-discovered-deal"
      );

    deals.push(
      result
    );
  }

  const unique =
    new Map();

  for (
    const deal of deals
  ) {
    const key =
      deal.walmartItemId ||
      deal.url ||
      `${deal.name}|${deal.seller}|${deal.price}`;

    if (
      !unique.has(
        key
      )
    ) {
      unique.set(
        key,
        deal
      );
    }
  }

  return Array.from(
    unique.values()
  );
}


/* ========================================
   MARKETPLACE SEARCH
======================================== */

function buildMarketplaceOffers(
  product,
  results,
  source =
    "axesso-walmart-search"
) {
  const offers = [];

  for (
    const item of results
  ) {
    const name =
      getProductName(item);

    if (
      !isPokemonListing(
        name
      ) ||
      isGradedListing(
        name
      )
    ) {
      continue;
    }

    const seller =
      getSellerName(item);

    if (
      !isApprovedSeller(
        seller
      )
    ) {
      continue;
    }

    const price =
      getPrice(item);

    const msrp =
      resolveMsrp(
        item,
        product
      );

    if (
      !withinPriceRule(
        price,
        msrp
      )
    ) {
      continue;
    }

    const matchedProduct =
      findCatalogMatchForItem(
        item
      );

    const result =
      makeResult(
        matchedProduct ||
        product,
        item,
        source
      );

    if (
      result.displayEligible
    ) {
      offers.push(
        result
      );
    }
  }

  const unique =
    new Map();

  for (
    const offer of offers
  ) {
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
      Number(
        offer.price
      ) <
      Number(
        existing.price
      )
    ) {
      unique.set(
        key,
        offer
      );
    }
  }

  return Array.from(
    unique.values()
  )
    .sort(
      (a, b) =>
        Number(a.price) -
        Number(b.price)
    );
}

async function searchMarketplaceOffers(
  product
) {
  const keyword =
    product?.searchTerm ||
    product?.name ||
    "Pokemon TCG";

  const search =
    await axessoSearch(
      keyword
    );

  const discovered =
    collectQualifiedDeals(
      search.results
    );

  if (
    discovered.length
  ) {
    const combined =
      [
        ...lastDiscoveredDeals,
        ...discovered
      ];

    const unique =
      new Map();

    for (
      const item of combined
    ) {
      const key =
        item.walmartItemId ||
        item.url ||
        `${item.name}|${item.seller}|${item.price}`;

      unique.set(
        String(key),
        item
      );
    }

    lastDiscoveredDeals =
      Array.from(
        unique.values()
      );
  }

  return buildMarketplaceOffers(
    product,
    search.results,
    "axesso-walmart-search"
  );
}


/* ========================================
   PRODUCT LOOKUP
======================================== */

function chooseBestMatch(
  product,
  results
) {
  /*
    Prefer Walmart Direct.
  */
  const walmartDirect =
    results.find(
      item =>
        isWalmartSeller(
          getSellerName(item)
        ) &&
        displayProductMatches(
          product,
          item
        )
    );

  if (
    walmartDirect
  ) {
    return {
      item:
        walmartDirect,

      direct:
        true,

      approved:
        true
    };
  }

  /*
    Next preference:
    GT approved seller.
  */
  const gtMatch =
    results.find(
      item =>
        isGtApprovedSeller(
          getSellerName(item)
        ) &&
        displayProductMatches(
          product,
          item
        )
    );

  if (
    gtMatch
  ) {
    return {
      item:
        gtMatch,

      direct:
        false,

      approved:
        true
    };
  }

  return null;
}

async function discoverProduct(
  product
) {
  const keyword =
    product.searchTerm ||
    product.name ||
    "Pokemon TCG";

  const search =
    await axessoSearch(
      keyword
    );

  const results =
    search.results;

  const discovered =
    collectQualifiedDeals(
      results
    );

  if (
    discovered.length
  ) {
    lastDiscoveredDeals =
      discovered;
  }

  const match =
    chooseBestMatch(
      product,
      results
    );

  if (!match) {
    return emptyResult(
      product,
      "axesso-no-match",
      "No qualifying Walmart or GT seller result found"
    );
  }

  const itemId =
    getItemId(
      match.item
    );

  if (
    itemId
  ) {
    discoveredItems.set(
      product.id,
      String(itemId)
    );
  }

  const result =
    makeResult(
      product,
      match.item,
      "axesso-walmart-search"
    );

  /*
    If product exists but is over
    the allowed price ceiling,
    it must not count as a deal.
  */
  if (
    !result.withinPriceRule
  ) {
    return {
      ...result,
      inStock:
        false,
      alertEligible:
        false,
      displayEligible:
        false,
      error:
        "Product is above 150% of MSRP or MSRP is unknown"
    };
  }

  return result;
}


/* ========================================
   EMPTY RESULT
======================================== */

function emptyResult(
  product,
  source,
  error = null
) {
  return {
    productId:
      product.id,

    name:
      product.name,

    set:
      product.set,

    productType:
      product.productType,

    retailer:
      "walmart",

    retailerLabel:
      "Walmart",

    channel:
      "online",

    storeId:
      null,

    storeName:
      null,

    status:
      "out",

    rawStatus:
      "",

    dropType:
      null,

    upcoming:
      false,

    inStock:
      false,

    offerAvailable:
      false,

    directSeller:
      false,

    approvedSeller:
      false,

    gtApprovedSeller:
      false,

    price:
      null,

    msrp:
      product.msrp ??
      null,

    withinPriceRule:
      false,

    displayEligible:
      false,

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

    source,

    marketplaceOnly:
      false,

    alertEligible:
      false,

    image:
      null,

    error
  };
}


/* ========================================
   UPCOMING DETECTION
======================================== */

function collectUpcoming(
  results
) {
  const candidates = [];

  for (
    const item of results
  ) {
    const name =
      getProductName(item);

    if (
      !isPokemonListing(
        name
      )
    ) {
      continue;
    }

    const seller =
      getSellerName(item);

    if (
      !isApprovedSeller(
        seller
      )
    ) {
      continue;
    }

    const rawStatus =
      getAvailability(item);

    const status =
      normalizeStatus(
        rawStatus
      );

    const dropType =
      detectDropType(
        item
      );

    if (
      status !==
        "preorder" &&
      !dropType
    ) {
      continue;
    }

    const itemId =
      getItemId(item);

    candidates.push({
      retailer:
        "walmart",

      retailerLabel:
        "Walmart",

      name,

      productId:
        itemId
          ? `walmart-upcoming-${itemId}`
          : null,

      walmartItemId:
        itemId,

      status:
        "preorder",

      rawStatus,

      dropType:
        dropType ||
        "scheduled",

      price:
        getPrice(item),

      msrp:
        resolveMsrp(item),

      seller,

      directSeller:
        isWalmartSeller(
          seller
        ),

      approvedSeller:
        isApprovedSeller(
          seller
        ),

      image:
        getImage(item),

      url:
        getProductUrl(item),

      checkedAt:
        new Date()
          .toISOString(),

      source:
        "axesso-upcoming-detection"
    });
  }

  return candidates;
}


/* ========================================
   BATCH SCANNING
======================================== */

function buildQueryForGroup(
  products
) {
  const first =
    products[0] ||
    {};

  const set =
    String(
      first.set ||
      ""
    ).trim();

  if (
    set &&
    !/auto discovered|other pokemon/i
      .test(set)
  ) {
    return (
      `Pokemon TCG ${set}`
    );
  }

  return "Pokemon TCG";
}

function groupCuratedProducts(
  products
) {
  const groups =
    new Map();

  for (
    const product of products
  ) {
    const key =
      detectSet(
        [
          product.set,
          product.name,
          product.searchTerm
        ]
          .filter(Boolean)
          .join(" ")
      ) ||
      normalize(
        product.set ||
        "other"
      );

    if (
      !groups.has(key)
    ) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(key)
      .push(product);
  }

  return Array.from(
    groups.values()
  );
}

async function checkProductsBatch(
  products
) {
  if (
    !Array.isArray(products) ||
    !products.length
  ) {
    return null;
  }

  const groups =
    groupCuratedProducts(
      products
    );

  const output = [];
  const upcomingMap =
    new Map();

  const discoveredDealMap =
    new Map();

  for (
    const group of groups
  ) {
    const query =
      buildQueryForGroup(
        group
      );

    let results = [];

    /*
      AXESSO = PRIMARY
    */
    try {
      const search =
        await axessoSearch(
          query
        );

      results =
        search.results;

    } catch (axessoError) {

      console.error(
        `Axesso search failed for "${query}":`,
        axessoError.message
      );

      /*
        HASDATA = BACKUP ONLY
      */
      if (
        HASDATA_API_KEY
      ) {
        try {
          results =
            await hasDataSearch(
              query
            );

        } catch (hasDataError) {

          console.error(
            `HasData backup failed for "${query}":`,
            hasDataError.message
          );

          for (
            const product of group
          ) {
            output.push(
              emptyResult(
                product,
                "walmart-provider-error",
                `Axesso: ${axessoError.message}; HasData: ${hasDataError.message}`
              )
            );
          }

          continue;
        }

      } else {

        for (
          const product of group
        ) {
          output.push(
            emptyResult(
              product,
              "walmart-provider-error",
              axessoError.message
            )
          );
        }

        continue;
      }
    }

    /*
      Save all qualifying deals
      found during this scan.
    */
    const discovered =
      collectQualifiedDeals(
        results
      );

    for (
      const deal of discovered
    ) {
      const key =
        deal.walmartItemId ||
        deal.url ||
        `${deal.name}|${deal.seller}|${deal.price}`;

      discoveredDealMap.set(
        String(key),
        deal
      );
    }

    /*
      Upcoming products.
    */
    for (
      const upcoming of
      collectUpcoming(
        results
      )
    ) {
      const key =
        upcoming.walmartItemId ||
        upcoming.name;

      upcomingMap.set(
        String(key),
        upcoming
      );
    }

    /*
      Match curated products.
    */
    for (
      const product of group
    ) {
      const match =
        chooseBestMatch(
          product,
          results
        );

      if (!match) {
        output.push(
          emptyResult(
            product,
            "axesso-no-match",
            "No qualifying Walmart or GT seller result found"
          )
        );

        continue;
      }

      const result =
        makeResult(
          product,
          match.item,
          "axesso-walmart-search"
        );

      if (
        !result.withinPriceRule
      ) {
        output.push({
          ...result,

          inStock:
            false,

          alertEligible:
            false,

          displayEligible:
            false,

          error:
            "Above 150% of MSRP or MSRP unavailable"
        });

        continue;
      }

      output.push(
        result
      );
    }
  }

  lastUpcoming =
    Array.from(
      upcomingMap.values()
    );

  lastDiscoveredDeals =
    Array.from(
      discoveredDealMap.values()
    )
      .sort(
        (a, b) =>
          Number(a.price) -
          Number(b.price)
      );

  return output;
}


/* ========================================
   SINGLE PRODUCT
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
      ...emptyResult(
        product,
        "walmart-provider",
        "Retailer not supported by Walmart provider"
      ),
      retailer
    };
  }

  try {
    return await discoverProduct(
      product
    );

  } catch (error) {

    console.error(
      `Walmart lookup failed for ${product.id}:`,
      error.message
    );

    /*
      Try HasData only when Axesso
      actually fails.
    */
    if (
      HASDATA_API_KEY
    ) {
      try {
        const results =
          await hasDataSearch(
            product.searchTerm ||
            product.name ||
            "Pokemon TCG"
          );

        const match =
          chooseBestMatch(
            product,
            results
          );

        if (match) {
          return makeResult(
            product,
            match.item,
            "hasdata-walmart-backup"
          );
        }

      } catch (
        backupError
      ) {
        console.error(
          `HasData backup also failed for ${product.id}:`,
          backupError.message
        );
      }
    }

    return emptyResult(
      product,
      "walmart-provider-error",
      error.message
    );
  }
}


/* ========================================
   DEBUG
======================================== */

async function inspectSearchResponse(
  keyword =
    "Pokemon TCG"
) {
  const search =
    await axessoSearch(
      keyword
    );

  const results =
    search.results;

  const first =
    results[0] ||
    null;

  return {
    keyword,

    provider:
      "axesso",

    rapidApiHost:
      RAPIDAPI_HOST,

    rapidApiTimeoutMs:
      RAPIDAPI_TIMEOUT_MS,

    extractedCount:
      results.length,

    sampleItemKeys:
      first &&
      typeof first ===
        "object"
        ? Object.keys(
            first
          )
        : [],

    sampleName:
      first
        ? getProductName(
            first
          )
        : null,

    samplePrice:
      first
        ? getPrice(
            first
          )
        : null,

    sampleSeller:
      first
        ? getSellerName(
            first
          )
        : null,

    sampleAvailability:
      first
        ? getAvailability(
            first
          )
        : null,

    sampleItemId:
      first
        ? getItemId(
            first
          )
        : null,

    sampleUrl:
      first
        ? getProductUrl(
            first
          )
        : null,

    qualifyingDeals:
      collectQualifiedDeals(
        results
      ).length
  };
}


/* ========================================
   STATE
======================================== */

function getUpcoming() {
  return lastUpcoming;
}

function getDiscoveredDeals() {
  return lastDiscoveredDeals;
}

function getProviderInfo() {
  const blocked =
    rapidApiCircuitIsBlocking();

  return {
    primary:
      "axesso",

    fallback:
      HASDATA_API_KEY
        ? "hasdata"
        : null,

    fallbackEnabled:
      Boolean(
        HASDATA_API_KEY
      ),

    rapidApiHost:
      RAPIDAPI_HOST,

    rapidApiConfigured:
      Boolean(
        RAPIDAPI_KEY
      ),

    hasDataConfigured:
      Boolean(
        HASDATA_API_KEY
      ),

    rapidApiBlocked:
      blocked,

    rapidApiCircuit: {
      ...rapidApiCircuit
    },

    rapidApiTimeoutMs:
      RAPIDAPI_TIMEOUT_MS,

    rapidApiAuthCooldownMs:
      RAPIDAPI_AUTH_COOLDOWN_MS,

    hasDataTimeoutMs:
      HASDATA_TIMEOUT_MS,

    hasDataMaxAttempts:
      HASDATA_MAX_ATTEMPTS,

    hasDataRetryDelayMs:
      HASDATA_RETRY_DELAY_MS,

    upcomingCount:
      lastUpcoming.length,

    discoveredDealCount:
      lastDiscoveredDeals.length,

    sellerRules: {
      walmart:
        true,

      gtCollectibles:
        true,

      otherMarketplaceSellers:
        false
    },

    priceRule: {
      maxPercentOfMsrp:
        150,

      maxPercentOverMsrp:
        50,

      unknownMsrpQualifies:
        false
    },

    health:
      JSON.parse(
        JSON.stringify(
          providerHealth
        )
      )
  };
}


/* ========================================
   EXPORTS
======================================== */

module.exports = {
  checkProduct,
  checkProductsBatch,
  searchMarketplaceOffers,
  buildMarketplaceOffers,
  inspectSearchResponse,
  extractSearchResults,
  getUpcoming,
  getDiscoveredDeals,
  getProviderInfo
};
