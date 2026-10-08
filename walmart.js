const rawCatalog = require("./products.json");
const providerCooldown = require("./provider-cooldown");

const catalogProducts =
  Array.isArray(rawCatalog)
    ? rawCatalog
    : Array.isArray(rawCatalog?.products)
      ? rawCatalog.products
      : [];


/* ========================================
   CONFIG
======================================== */

const RAPIDAPI_HOST =
  process.env.WALMART_RAPIDAPI_HOST ||
  "axesso-walmart-data-service.p.rapidapi.com";

const RAPIDAPI_KEY =
  process.env.WALMART_RAPIDAPI_KEY || "";

const HASDATA_API_KEY =
  process.env.HASDATA_API_KEY || "";

const RAPIDAPI_TIMEOUT_MS = Math.max(
  5000,
  Number(
    process.env.WALMART_REQUEST_TIMEOUT_MS ||
    10000
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

const RAPIDAPI_AUTH_COOLDOWN_MS = Math.max(
  60000,
  Number(
    process.env.RAPIDAPI_AUTH_COOLDOWN_MS ||
    300000
  )
);

// Provider quota failures are not recoverable by retrying every scan cycle.
// Keep the scheduler active, but pause this provider until its cooldown ends.
const PROVIDER_QUOTA_COOLDOWN_MS =
  providerCooldown.DEFAULT_QUOTA_COOLDOWN_MS;

const discoveredItems =
  new Map();

let lastUpcoming = [];
let lastDiscoveredDeals = [];
let lastRaffles = [];

let rapidApiCircuit = {
  open: false,
  reason: null,
  openedAt: null,
  retryAfter: null
};

let hasDataCircuit = {
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

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function nowIso() {
  return new Date()
    .toISOString();
}

function markProviderStart(name) {
  if (!providerHealth[name]) {
    return;
  }

  providerHealth[name]
    .requests += 1;
}

function markProviderSuccess(name) {
  if (!providerHealth[name]) {
    return;
  }

  providerHealth[name]
    .successes += 1;

  providerHealth[name]
    .lastSuccess =
      nowIso();

  providerHealth[name]
    .lastError =
      null;
}

function markProviderFailure(
  name,
  error
) {
  if (!providerHealth[name]) {
    return;
  }

  providerHealth[name]
    .failures += 1;

  providerHealth[name]
    .lastError =
      error?.message ||
      String(error);
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
  // Actual seller identity is required; price eligibility is checked separately.
  return Boolean(String(value || '').trim()) && !/^(?:unknown|marketplace seller)$/i.test(String(value).trim());
}


/* ========================================
   AXESSO FIELD READERS
======================================== */

function getProductName(item) {
  return (
    item?.name ||
    item?.title ||
    item?.productName ||
    ""
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
    item?.sellerInfo
      ?.sellerName ||

    item?.sellerInfo
      ?.displayName ||

    item?.sellerInfo
      ?.name ||

    null
  );
}

function getSellerType(item) {
  return normalize(
    item?.sellerType ||
    item?.sellerInfo?.sellerType ||
    item?.otherDetails
      ?.sellerType
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
    item?.imageInfo
      ?.thumbnailUrl
  ) {
    return (
      item.imageInfo
        .thumbnailUrl
    );
  }

  if (
    item?.imageInfo
      ?.imageUrl
  ) {
    return (
      item.imageInfo
        .imageUrl
    );
  }

  if (
    typeof item.image ===
    "string"
  ) {
    return item.image;
  }

  if (
    item.image &&
    typeof item.image ===
      "object"
  ) {
    return (
      item.image.url ||
      item.image.imageUrl ||
      item.image.thumbnailUrl ||
      null
    );
  }

  if (
    Array.isArray(
      item.images
    ) &&
    item.images.length
  ) {
    const first =
      item.images[0];

    if (
      typeof first ===
      "string"
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

    item?.availabilityStatusDisplayValue ||

    item?.availabilityStatus ||

    item?.availability ||

    item?.stockStatus ||

    item?.otherDetails
      ?.availabilityStatusV2
      ?.value ||

    item?.otherDetails
      ?.availabilityStatusV2
      ?.display ||

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
    item?.externalInfoUrl ||
    null;

  if (
    url &&
    String(url)
      .startsWith("/")
  ) {
    url =
      `https://www.walmart.com${url}`;
  }

  if (
    !url &&
    itemId
  ) {
    url =
      `https://www.walmart.com/ip/${itemId}`;
  }

  return url;
}


/* ========================================
   STOCK STATUS
======================================== */

function normalizeStatus(
  value,
  inStock = false
) {
  const text =
    normalize(value);

  if (
    /pre ?order|coming soon|scheduled drop/
      .test(text)
  ) {
    return "preorder";
  }

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

  return "out";
}


/* ========================================
   POKEMON PRODUCT FILTER
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
      "ultra premium collection"
    ) ||
    /\bupc\b/
      .test(text)
  ) {
    return "ultra-premium-collection";
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
      "sleeved booster"
    )
  ) {
    return "sleeved-booster";
  }

  if (
    text.includes(
      "booster pack"
    )
  ) {
    return "booster-pack";
  }

  if (
    text.includes(
      "3 pack blister"
    ) ||
    text.includes(
      "three pack blister"
    )
  ) {
    return "3-pack-blister";
  }

  if (
    text.includes(
      "blister pack"
    )
  ) {
    return "blister";
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
      "knockout box"
    ) ||
    text.includes(
      "knockout collection"
    )
  ) {
    return "knockout-box";
  }

  if (
    text.includes(
      "mini tin"
    )
  ) {
    return "mini-tin";
  }

  if (
    text.includes(
      "collector tin"
    ) ||
    text.includes(
      "collection tin"
    ) ||
    /\btin\b/
      .test(text)
  ) {
    return "tin";
  }

  if (
    text.includes(
      "build battle"
    ) ||
    text.includes(
      "build and battle"
    )
  ) {
    return "build-and-battle";
  }

  if (
    text.includes(
      "premium collection"
    )
  ) {
    return "premium-collection";
  }

  if (
    text.includes(
      "special collection"
    )
  ) {
    return "special-collection";
  }

  if (
    text.includes(
      "ex collection"
    ) ||
    text.includes(
      "ex box"
    )
  ) {
    return "ex-box";
  }

  if (
    text.includes(
      "collection box"
    ) ||
    text.includes(
      "collection"
    )
  ) {
    return "collection";
  }

  if (
    text.includes(
      "pin collection"
    )
  ) {
    return "pin-collection";
  }

  return null;
}

function isOfficialSealedPokemonProduct(
  itemOrName
) {
  const name =
    typeof itemOrName ===
      "string"
      ? itemOrName
      : getProductName(
          itemOrName
        );

  const text =
    normalize(name);

  if (
    !text ||
    !isPokemonListing(text) ||
    isGradedListing(text)
  ) {
    return false;
  }

  /*
    Hard reject seller-made junk,
    mystery packs, repacks,
    guaranteed-hit bundles, singles,
    lots and similar listings.
  */
  const rejectedPatterns = [
    /\bmystery\b/,
    /\brepack\b/,
    /\brepacked\b/,
    /\bcustom pack\b/,
    /\bcustom bundle\b/,
    /\brandom pack\b/,
    /\brandom cards\b/,
    /\bassorted cards\b/,
    /\bcard lot\b/,
    /\blot of cards\b/,
    /\bsingle card\b/,
    /\bguaranteed ex\b/,
    /\bguaranteed gx\b/,
    /\bguaranteed v\b/,
    /\bguaranteed vmax\b/,
    /\bguaranteed vstar\b/,
    /\bguaranteed hit\b/,
    /\bguaranteed rare\b/,
    /\bbonus card\b/,
    /\bhot pack\b/,
    /\bgod pack\b/,
    /\bmega pack\b/,
    /\bmystery box\b/
  ];

  if (
    rejectedPatterns.some(
      pattern =>
        pattern.test(text)
    )
  ) {
    return false;
  }

  const type =
    detectProductType(
      text
    );

  return Boolean(type);
}


/* ========================================
   SET DETECTION
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


/* ========================================
   CATALOG MATCHING / MSRP
======================================== */

function wordMatchScore(
  expectedValue,
  actualValue
) {
  const expected =
    normalize(
      expectedValue
    );

  const actual =
    normalize(
      actualValue
    );

  if (
    !expected ||
    !actual
  ) {
    return 0;
  }

  const ignored =
    new Set([
      "pokemon",
      "tcg",
      "trading",
      "card",
      "game",
      "the",
      "and",
      "with",
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
    return 0;
  }

  const matched =
    words.filter(
      word =>
        actual.includes(word)
    ).length;

  return (
    matched /
    words.length
  );
}

function productMatches(
  product,
  item
) {
  const actualName =
    getProductName(item);

  if (
    !isOfficialSealedPokemonProduct(
      actualName
    )
  ) {
    return false;
  }

  const score =
    wordMatchScore(
      product?.name ||
      product?.searchTerm,
      actualName
    );

  if (
    score < 0.65
  ) {
    return false;
  }

  const expectedType =
    detectProductType(
      [
        product?.productType,
        product?.name,
        product?.searchTerm
      ]
        .filter(Boolean)
        .join(" ")
    );

  const actualType =
    detectProductType(
      actualName
    );

  if (
    expectedType &&
    actualType &&
    expectedType !==
      actualType
  ) {
    return false;
  }

  return true;
}

function findCatalogMatchForItem(
  item
) {
  const name =
    getProductName(item);

  if (
    !isOfficialSealedPokemonProduct(
      name
    )
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
      product?.enabled === false ||
      product?.msrp == null
    ) {
      continue;
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
        name
      );

    if (
      expectedType &&
      actualType &&
      expectedType !==
        actualType
    ) {
      continue;
    }

    const score =
      wordMatchScore(
        product.name ||
        product.searchTerm,
        name
      );

    if (
      score > bestScore
    ) {
      bestScore =
        score;

      best =
        product;
    }
  }

  return (
    bestScore >= 0.65
      ? best
      : null
  );
}

function resolveMsrp(
  item,
  requestedProduct = null
) {
  if (
    requestedProduct?.msrp != null &&
    productMatches(
      requestedProduct,
      item
    )
  ) {
    const value =
      Number(
        requestedProduct.msrp
      );

    if (
      Number.isFinite(value) &&
      value > 0
    ) {
      return value;
    }
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

  return (
    Number.isFinite(msrp) &&
    msrp > 0
      ? msrp
      : null
  );
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
  label
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
        await response
          .text()
          .catch(
            () => ""
          );

      const error =
        new Error(
          `${label} returned ${response.status}` +
          (
            body
              ? `: ${body.slice(0, 180)}`
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
          `${label} timed out after ${timeoutMs}ms`
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
  error,
  cooldownMs = RAPIDAPI_AUTH_COOLDOWN_MS
) {
  const now =
    Date.now();

  rapidApiCircuit = {
    open: true,

    reason:
      error?.message ||
      "RapidAPI authentication failure",

    openedAt:
      new Date(now)
        .toISOString(),

    retryAfter:
      new Date(
        now +
        cooldownMs
      ).toISOString()
  };
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

  const retryAfter =
    Date.parse(
      rapidApiCircuit
        .retryAfter ||
      ""
    );

  if (
    Number.isFinite(
      retryAfter
    ) &&
    Date.now() >=
      retryAfter
  ) {
    closeRapidApiCircuit();

    return false;
  }

  return true;
}

async function axessoRequest(
  path
) {
  if (
    !RAPIDAPI_KEY
  ) {
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
        `Axesso temporarily disabled until ${rapidApiCircuit.retryAfter}`
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
    } else if (
      error?.status === 429 &&
      /monthly quota|quota.*exceed|requests.*plan/i.test(error.message || "")
    ) {
      openRapidApiCircuit(
        error,
        PROVIDER_QUOTA_COOLDOWN_MS
      );
    }

    throw error;
  }
}


/* ========================================
   AXESSO RESULT EXTRACTION
======================================== */

function extractSearchResults(
  data
) {
  const results = [];

  function add(items) {
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
        results.push(
          item
        );
      }
    }
  }

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
      searchResult
        ?.itemStacks
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
    const item of results
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
  keyword =
    "Pokemon TCG"
) {
  const params =
    new URLSearchParams({
      sortBy:
        "best_match",

      page:
        "1",

      keyword
    });

  const raw =
    await axessoRequest(
      `/wlm/walmart-search-by-keyword?${params.toString()}`
    );

  return {
    raw,

    results:
      extractSearchResults(
        raw
      )
  };
}


/* ========================================
   HASDATA FALLBACK
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

function hasDataCircuitIsBlocking() {
  if (!hasDataCircuit.open) return false;
  const retryAfter = Date.parse(hasDataCircuit.retryAfter || "");
  if (Number.isFinite(retryAfter) && Date.now() >= retryAfter) {
    hasDataCircuit = {open:false, reason:null, openedAt:null, retryAfter:null};
    return false;
  }
  return true;
}

function openHasDataCircuit(error) {
  const now = Date.now();
  hasDataCircuit = {
    open: true,
    reason: error?.message || "HasData credits or access unavailable",
    openedAt: new Date(now).toISOString(),
    retryAfter: new Date(now + PROVIDER_QUOTA_COOLDOWN_MS).toISOString()
  };
  providerCooldown.block(
    "hasdata",
    error?.message || "HasData credits or access unavailable"
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

  if (hasDataCircuitIsBlocking()) {
    providerHealth.hasdata.blockedRequests =
      (providerHealth.hasdata.blockedRequests || 0) + 1;
    const error = new Error(
      `HasData temporarily disabled until ${hasDataCircuit.retryAfter}`
    );
    error.code = "HASDATA_CIRCUIT_OPEN";
    throw error;
  }

  if (providerCooldown.isBlocked("hasdata")) {
    const error = new Error(
      `HasData temporarily disabled until ${providerCooldown.getState("hasdata").retryAfter}`
    );
    error.code = "HASDATA_CIRCUIT_OPEN";
    throw error;
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

      if (
        error?.status === 403 ||
        (error?.status === 429 && /quota|credit|plan/i.test(error.message || ""))
      ) {
        openHasDataCircuit(error);
      }

      const retry =
        attempt <
          HASDATA_MAX_ATTEMPTS &&
        isTransientHasDataError(
          error
        );

      if (!retry) {
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
   RAFFLE / DRAW DETECTION
======================================== */

function getRaffleText(item) {
  const values = [
    getProductName(item),

    item?.badge,
    item?.badges,
    item?.annualEvent,
    item?.annualEventV2,
    item?.earlyAccessEvent,
    item?.preEarlyAccessEvent,
    item?.showDrawCTA,
    item?.showBuyNow,
    item?.type,
    item?.itemType,
    item?.classType,
    item?.promoData,
    item?.eventAttributes,
    item?.fulfillmentTitle,
    item?.availabilityStatus,
    item?.availabilityStatusV2
  ];

  try {
    return normalize(
      values
        .map(
          value =>
            typeof value ===
              "object"
              ? JSON.stringify(
                  value
                )
              : String(
                  value ?? ""
                )
        )
        .join(" ")
    );

  } catch {
    return normalize(
      getProductName(item)
    );
  }
}

function isRaffleItem(item) {
  if (
    !isOfficialSealedPokemonProduct(
      item
    )
  ) {
    return false;
  }

  if (
    item?.showDrawCTA ===
    true
  ) {
    return true;
  }

  const text =
    getRaffleText(
      item
    );

  return (
    /\bdraw\b|\bdrawing\b|\braffle\b|\blottery\b/
      .test(text)
  );
}

function findDateValue(
  value,
  depth = 0
) {
  if (
    depth > 5 ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value ===
    "string"
  ) {
    const parsed =
      Date.parse(value);

    if (
      Number.isFinite(parsed) &&
      /20[0-9]{2}/
        .test(value)
    ) {
      return new Date(
        parsed
      ).toISOString();
    }

    return null;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      const found =
        findDateValue(
          item,
          depth + 1
        );

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (
    typeof value ===
    "object"
  ) {
    const preferredKeys = [
      "startDateTime",
      "startTime",
      "startDate",
      "eventStartTime",
      "eventStartDate",
      "drawStartTime",
      "drawingStartTime",
      "dateTime"
    ];

    for (
      const key of
      preferredKeys
    ) {
      if (
        value[key] !==
        undefined
      ) {
        const found =
          findDateValue(
            value[key],
            depth + 1
          );

        if (found) {
          return found;
        }
      }
    }

    for (
      const nested of
      Object.values(value)
    ) {
      const found =
        findDateValue(
          nested,
          depth + 1
        );

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function getRaffleStatus(item) {
  const text =
    getRaffleText(
      item
    );

  if (
    /\bclosed\b|\bended\b|\bdrawing ended\b|\bdraw ended\b/
      .test(text)
  ) {
    return "closed";
  }

  if (
    /\bactive drawing\b|\bdrawing open\b|\benter drawing\b|\benter now\b|\bjoin drawing\b|\bdraw live\b/
      .test(text)
  ) {
    return "live";
  }

  if (
    /\bupcoming\b|\bcoming soon\b|\bstarts\b|\bscheduled\b/
      .test(text)
  ) {
    return "upcoming";
  }

  if (
    item?.showDrawCTA ===
    true
  ) {
    return "detected";
  }

  return "detected";
}

function rafflePriority(status) {
  switch (status) {
    case "live":
      return 0;

    case "upcoming":
      return 1;

    case "detected":
      return 2;

    case "closed":
      return 3;

    default:
      return 4;
  }
}

function collectRaffles(
  results
) {
  const map =
    new Map();

  for (
    const item of results
  ) {
    if (
      !isRaffleItem(
        item
      )
    ) {
      continue;
    }

    const itemId =
      getItemId(item);

    const seller =
      getSellerName(item);

    const status =
      getRaffleStatus(
        item
      );

    const raffle = {
      productId:
        itemId
          ? `walmart-raffle-${itemId}`
          : `walmart-raffle-${normalize(
              getProductName(item)
            ).replace(/\s+/g, "-")}`,

      walmartItemId:
        itemId,

      retailer:
        "walmart",

      retailerLabel:
        "Walmart",

      name:
        getProductName(item),

      productType:
        detectProductType(
          getProductName(item)
        ),

      set:
        detectSet(
          getProductName(item)
        ) ||
        "Raffle",

      raffle:
        true,

      raffleStatus:
        status,

      status:
        status === "live"
          ? "instock"
          : status,

      startsAt:
        findDateValue(
          item?.annualEventV2 ||
          item?.annualEvent ||
          item?.eventAttributes ||
          item?.earlyAccessEvent ||
          item
        ),

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
        nowIso(),

      source:
        "axesso-walmart-raffle"
    };

    const key =
      String(
        itemId ||
        raffle.url ||
        raffle.name
      );

    const existing =
      map.get(key);

    if (
      !existing ||
      rafflePriority(
        raffle.raffleStatus
      ) <
      rafflePriority(
        existing.raffleStatus
      )
    ) {
      map.set(
        key,
        raffle
      );
    }
  }

  return Array
    .from(
      map.values()
    )
    .sort(
      (a, b) => {
        const priority =
          rafflePriority(
            a.raffleStatus
          ) -
          rafflePriority(
            b.raffleStatus
          );

        if (priority !== 0) {
          return priority;
        }

        const aTime =
          Date.parse(
            a.startsAt || ""
          );

        const bTime =
          Date.parse(
            b.startsAt || ""
          );

        if (
          Number.isFinite(aTime) &&
          Number.isFinite(bTime)
        ) {
          return aTime - bTime;
        }

        return 0;
      }
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
  const name =
    getProductName(item) ||
    product?.name ||
    "Pokémon Product";

  const seller =
    getSellerName(item);

  const directSeller =
    isWalmartSeller(
      seller
    );

  const gtApprovedSeller =
    isGtApprovedSeller(
      seller
    );

  const approvedSeller =
    isApprovedSeller(seller);

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

  const rawStatus =
    getAvailability(
      item
    );

  const status =
    normalizeStatus(
      rawStatus,
      item?.isOutOfStock ===
        false
    );

  const offerAvailable =
    status === "instock";

  const officialProduct =
    isOfficialSealedPokemonProduct(
      name
    );

  const itemId =
    getItemId(item);

  /*
    Actual sellers retain their labels. Every seller needs
    verified MSRP, a qualifying price and fresh availability.
  */
  const inStock =
    approvedSeller &&
    offerAvailable &&
    priceQualified &&
    officialProduct;

  const displayEligible =
    approvedSeller &&
    priceQualified &&
    officialProduct;

  return {
    productId:
      product?.id ||
      (
        itemId
          ? `walmart-${itemId}`
          : `walmart-${normalize(
              name
            ).replace(/\s+/g, "-")}`
      ),

    name,

    set:
      product?.set ||
      detectSet(name) ||
      "Auto Discovered",

    productType:
      product?.productType ||
      detectProductType(name),

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

    rawStatus,

    inStock,

    offerAvailable,

    directSeller,

    gtApprovedSeller,

    approvedSeller,

    /*
      Compatibility with marketplace offer handling.
    */
    approvedMarketplace:
      !directSeller && approvedSeller && priceQualified,

    seller:
      directSeller
        ? "Walmart"
        : (
            seller ||
            "Marketplace Seller"
          ),

    sellerType:
      directSeller
        ? "walmart"
        : gtApprovedSeller
          ? "gt-approved"
          : (
              getSellerType(item) ||
              "marketplace"
            ),

    price,

    msrp,

    withinPriceRule:
      priceQualified,

    officialSealedProduct:
      officialProduct,

    displayEligible,

    alertEligible:
      approvedSeller &&
      offerAvailable &&
      priceQualified &&
      officialProduct,

    walmartItemId:
      itemId,

    image:
      getImage(item) || product?.image || null,

    url:
      getProductUrl(item),

    checkedAt:
      nowIso(),

    source,

    marketplaceOnly:
      !directSeller,

    autoDiscovered:
      !product?.id
  };
}

function emptyResult(
  product,
  source,
  error = null
) {
  return {
    productId:
      product?.id,

    name:
      product?.name,

    set:
      product?.set,

    productType:
      product?.productType,

    retailer:
      "walmart",

    retailerLabel:
      "Walmart",

    channel:
      "online",

    status:
      source === "axesso-no-match" ||
      String(source || "").endsWith("provider-error")
        ? "unknown"
        : "out",

    rawStatus:
      "",

    inStock:
      false,

    offerAvailable:
      false,

    directSeller:
      false,

    gtApprovedSeller:
      false,

    approvedSeller:
      false,

    approvedMarketplace:
      false,

    seller:
      null,

    sellerType:
      null,

    price:
      null,

    msrp:
      product?.msrp ??
      null,

    withinPriceRule:
      false,

    officialSealedProduct:
      true,

    displayEligible:
      false,

    alertEligible:
      false,

    walmartItemId:
      product?.walmartItemId ||
      null,

    image:
      null,

    url:
      product?.walmartItemId
        ? `https://www.walmart.com/ip/${product.walmartItemId}`
        : null,

    checkedAt:
      nowIso(),

    source,

    marketplaceOnly:
      false,

    autoDiscovered:
      product?.autoDiscovered ===
        true,

    error
  };
}


/* ========================================
   QUALIFYING DISCOVERED PRODUCTS
======================================== */

function collectQualifiedDeals(
  results
) {
  const map =
    new Map();

  for (
    const item of results
  ) {
    const name =
      getProductName(item);

    if (
      !isOfficialSealedPokemonProduct(
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
      resolveMsrp(item);

    if (
      !withinPriceRule(
        price,
        msrp
      )
    ) {
      continue;
    }

    const catalogMatch =
      findCatalogMatchForItem(
        item
      );

    const result =
      makeResult(
        catalogMatch,
        item,
        "axesso-discovered-deal"
      );

    if (
      !result.displayEligible
    ) {
      continue;
    }

    const key =
      String(
        result.walmartItemId ||
        result.url ||
        `${result.name}|${result.seller}|${result.price}`
      );

    const existing =
      map.get(key);

    if (
      !existing ||
      Number(
        result.price
      ) <
      Number(
        existing.price
      )
    ) {
      map.set(
        key,
        result
      );
    }
  }

  return Array
    .from(
      map.values()
    )
    .sort(
      (a, b) =>
        Number(a.price) -
        Number(b.price)
    );
}


/* ========================================
   UPCOMING PRODUCT DETECTION
======================================== */

function collectUpcoming(
  results
) {
  const output = [];

  for (
    const item of results
  ) {
    const name =
      getProductName(item);

    if (
      !isOfficialSealedPokemonProduct(
        name
      )
    ) {
      continue;
    }

    const text =
      normalize(
        [
          name,
          item?.preOrder,
          item?.preOrderBadge,
          item?.availabilityStatus,
          item?.availabilityStatusV2,
          item?.badge,
          item?.badges
        ]
          .map(
            value =>
              typeof value ===
                "object"
                ? JSON.stringify(
                    value
                  )
                : String(
                    value ?? ""
                  )
          )
          .join(" ")
      );

    if (
      !/pre ?order|coming soon|scheduled/
        .test(text)
    ) {
      continue;
    }

    const itemId =
      getItemId(item);

    output.push({
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

      rawStatus:
        getAvailability(item),

      dropType:
        "scheduled",

      price:
        getPrice(item),

      msrp:
        resolveMsrp(item),

      seller:
        getSellerName(item),

      directSeller:
        isWalmartSeller(
          getSellerName(item)
        ),

      image:
        getImage(item),

      url:
        getProductUrl(item),

      checkedAt:
        nowIso(),

      source:
        "axesso-upcoming"
    });
  }

  return output;
}


/* ========================================
   MARKETPLACE / OFFER SEARCH
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
    if (
      !isOfficialSealedPokemonProduct(
        item
      )
    ) {
      continue;
    }

    if (
      product &&
      !productMatches(
        product,
        item
      )
    ) {
      continue;
    }

    const result =
      makeResult(
        product ||
        findCatalogMatchForItem(
          item
        ),
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
      String(
        offer.walmartItemId ||
        offer.url ||
        `${offer.name}|${offer.seller}|${offer.price}`
      );

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

  return Array
    .from(
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

  updateDiscoveryState(
    search.results
  );

  return buildMarketplaceOffers(
    product,
    search.results
  );
}


/* ========================================
   STATE MERGING
======================================== */

function mergeUnique(
  previous,
  incoming,
  keyGetter
) {
  const map =
    new Map();

  for (
    const item of [
      ...previous,
      ...incoming
    ]
  ) {
    const key =
      String(
        keyGetter(item)
      );

    if (
      !key ||
      key === "undefined" ||
      key === "null"
    ) {
      continue;
    }

    map.set(
      key,
      item
    );
  }

  return Array.from(
    map.values()
  );
}

function updateDiscoveryState(
  results
) {
  const discovered =
    collectQualifiedDeals(
      results
    );

  const upcoming =
    collectUpcoming(
      results
    );

  const raffles =
    collectRaffles(
      results
    );

  lastDiscoveredDeals =
    mergeUnique(
      lastDiscoveredDeals,
      discovered,
      item =>
        item.walmartItemId ||
        item.url ||
        item.name
    )
      .filter(
        item =>
          item.displayEligible ===
          true
      )
      .sort(
        (a, b) =>
          Number(a.price) -
          Number(b.price)
      );

  lastUpcoming =
    mergeUnique(
      lastUpcoming,
      upcoming,
      item =>
        item.walmartItemId ||
        item.url ||
        item.name
    );

  /*
    A raffle search is a current snapshot. Do not carry prior
    results forward: completed drawings must disappear before the
    next weekly set is published.
  */
  lastRaffles =
    raffles
      .sort(
        (a, b) =>
          rafflePriority(
            a.raffleStatus
          ) -
          rafflePriority(
            b.raffleStatus
          )
      );
}


/* ========================================
   SINGLE PRODUCT SEARCH
======================================== */

function chooseBestMatch(
  product,
  results
) {
  const qualified = results.filter(item =>
    productMatches(product, item) &&
    isApprovedSeller(getSellerName(item)) &&
    withinPriceRule(getPrice(item), resolveMsrp(item, product))
  ).sort((a, b) => {
    const available = item => normalizeStatus(getAvailability(item), item?.isOutOfStock === false) === 'instock';
    return Number(available(b)) - Number(available(a)) || getPrice(a) - getPrice(b);
  });
  if (qualified.length) return qualified[0];
  const walmartMatch =
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

  if (
    walmartMatch
  ) {
    return walmartMatch;
  }

  const gtMatch =
    results.find(
      item =>
        isGtApprovedSeller(
          getSellerName(item)
        ) &&
        productMatches(
          product,
          item
        )
    );

  return (
    gtMatch ||
    null
  );
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

  updateDiscoveryState(
    search.results
  );

  const match =
    chooseBestMatch(
      product,
      search.results
    );

  if (!match) {
    return emptyResult(
      product,
      "axesso-no-match",
      "No qualifying Walmart or GT official sealed product found"
    );
  }

  const itemId =
    getItemId(match);

  if (
    itemId &&
    product?.id
  ) {
    discoveredItems.set(
      product.id,
      String(itemId)
    );
  }

  return makeResult(
    product,
    match,
    "axesso-walmart-search"
  );
}

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

  } catch (
    axessoError
  ) {
    console.error(
      `Axesso failed for ${product.id}:`,
      axessoError.message
    );

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

        updateDiscoveryState(
          results
        );

        const match =
          chooseBestMatch(
            product,
            results
          );

        if (match) {
          return makeResult(
            product,
            match,
            "hasdata-walmart-backup"
          );
        }

      } catch (
        hasDataError
      ) {
        console.error(
          `HasData backup failed for ${product.id}:`,
          hasDataError.message
        );
      }
    }

    return emptyResult(
      product,
      "walmart-provider-error",
      axessoError.message
    );
  }
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
      normalize(
        product.set ||
        detectSet(
          [
            product.name,
            product.searchTerm
          ]
            .filter(Boolean)
            .join(" ")
        ) ||
        "pokemon"
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

  const allResults = [];

  for (
    const group of groups
  ) {
    const query =
      buildQueryForGroup(
        group
      );

    let results = [];

    try {
      const search =
        await axessoSearch(
          query
        );

      results =
        search.results;

    } catch (
      axessoError
    ) {
      console.error(
        `Axesso batch failed for "${query}":`,
        axessoError.message
      );

      if (
        HASDATA_API_KEY
      ) {
        try {
          results =
            await hasDataSearch(
              query
            );

        } catch (
          hasDataError
        ) {
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

    allResults.push(
      ...results
    );

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
            "No qualifying official sealed Walmart or GT result found"
          )
        );

        continue;
      }

      output.push(
        makeResult(
          product,
          match,
          "axesso-walmart-search"
        )
      );
    }
  }

  /*
    Also run one broad Pokemon search so
    products not already in products.json
    can still be discovered.
  */
  try {
    const broad =
      await axessoSearch(
        "Pokemon TCG"
      );

    allResults.push(
      ...broad.results
    );

  } catch (error) {
    console.error(
      "Broad Walmart discovery search failed:",
      error.message
    );
  }

  updateDiscoveryState(
    allResults
  );

  return output;
}


/* ========================================
   RAFFLE REFRESH
======================================== */

async function refreshRaffles() {
  /*
    Run dedicated searches so raffle
    products can be discovered even when
    they are not in our normal catalog.
  */

  const queries = [
    "Pokemon TCG",
    "Pokemon Collectibles Draw"
  ];

  const all = [];

  for (
    const query of queries
  ) {
    try {
      const search =
        await axessoSearch(
          query
        );

      all.push(
        ...search.results
      );

    } catch (error) {
      console.error(
        `Walmart raffle search failed for "${query}":`,
        error.message
      );
    }
  }

  const raffles =
    collectRaffles(
      all
    );

  lastRaffles =
    mergeUnique(
      lastRaffles,
      raffles,
      item =>
        item.walmartItemId ||
        item.url ||
        item.name
    )
      .sort(
        (a, b) =>
          rafflePriority(
            a.raffleStatus
          ) -
          rafflePriority(
            b.raffleStatus
          )
      );

  return lastRaffles;
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

  updateDiscoveryState(
    results
  );

  const first =
    results[0] ||
    null;

  const official =
    results.filter(
      item =>
        isOfficialSealedPokemonProduct(
          item
        )
    );

  const walmartOfficial =
    official.filter(
      item =>
        isWalmartSeller(
          getSellerName(item)
        )
    );

  const gtOfficial =
    official.filter(
      item =>
        isGtApprovedSeller(
          getSellerName(item)
        )
    );

  const randomRejected =
    results.filter(
      item =>
        isPokemonListing(
          getProductName(item)
        ) &&
        !isOfficialSealedPokemonProduct(
          item
        )
    );

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

    officialSealedCount:
      official.length,

    rejectedNonOfficialCount:
      randomRejected.length,

    walmartOfficialCount:
      walmartOfficial.length,

    gtOfficialCount:
      gtOfficial.length,

    qualifyingDeals:
      collectQualifiedDeals(
        results
      ).length,

    raffleItemsDetected:
      collectRaffles(
        results
      ).length,

    sampleItemKeys:
      first
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
        : null
  };
}


/* ========================================
   PUBLIC STATE
======================================== */

function getUpcoming() {
  return lastUpcoming;
}

function getDiscoveredDeals() {
  return lastDiscoveredDeals;
}

function getRaffles() {
  return lastRaffles;
}

function getProviderInfo() {
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
      rapidApiCircuitIsBlocking(),

    rapidApiCircuit: {
      ...rapidApiCircuit
    },

    rapidApiTimeoutMs:
      RAPIDAPI_TIMEOUT_MS,

    rapidApiAuthCooldownMs:
      RAPIDAPI_AUTH_COOLDOWN_MS,

    providerQuotaCooldownMs:
      PROVIDER_QUOTA_COOLDOWN_MS,

    hasDataCircuit: {
      ...providerCooldown.getState("hasdata")
    },

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

    raffleCount:
      lastRaffles.length,

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

    productFilter: {
      officialSealedOnly:
        true,

      mysteryProducts:
        false,

      repacks:
        false,

      randomBundles:
        false,

      guaranteedHitPacks:
        false,

      singleCards:
        false,

      gradedCards:
        false
    },

    raffles: {
      enabled:
        true,

      states: [
        "detected",
        "upcoming",
        "live",
        "closed"
      ]
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

  isOfficialSealedPokemonProduct,

  refreshRaffles,

  getUpcoming,
  getDiscoveredDeals,
  getRaffles,

  getProviderInfo
};
