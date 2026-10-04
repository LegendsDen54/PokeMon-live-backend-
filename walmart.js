const RAPIDAPI_HOST =

  process.env.WALMART_RAPIDAPI_HOST ||

  "realtime-walmart-data.p.rapidapi.com";

const RAPIDAPI_KEY = process.env.WALMART_RAPIDAPI_KEY;

const HASDATA_API_KEY = process.env.HASDATA_API_KEY;

const RAPIDAPI_TIMEOUT_MS = Math.max(

  5000,

  Number(process.env.WALMART_REQUEST_TIMEOUT_MS || 10000)

);

const HASDATA_TIMEOUT_MS = Math.max(

  3000,

  Number(process.env.HASDATA_TIMEOUT_MS || 7000)

);

const discoveredItems = new Map();

let lastUpcoming = [];

const providerHealth = {

  hasdata: {

    requests: 0,

    successes: 0,

    failures: 0,

    retries: 0,

    lastSuccess: null,

    lastError: null

  },

  rapidapi: {

    requests: 0,

    successes: 0,

    failures: 0,

    blockedRequests: 0,

    lastSuccess: null,

    lastError: null

  }

};

const HASDATA_MAX_ATTEMPTS = Math.max(

  1,

  Math.min(3, Number(process.env.HASDATA_MAX_ATTEMPTS || 2))

);

const HASDATA_RETRY_DELAY_MS = Math.max(

  100,

  Number(process.env.HASDATA_RETRY_DELAY_MS || 500)

);

const RAPIDAPI_AUTH_COOLDOWN_MS = Math.max(

  60000,

  Number(process.env.RAPIDAPI_AUTH_COOLDOWN_MS || 3600000)

);

let rapidApiCircuit = {

  open: false,

  reason: null,

  openedAt: null,

  retryAfter: null

};

function markProviderStart(name) {

  providerHealth[name].requests += 1;

}

function markProviderSuccess(name) {

  providerHealth[name].successes += 1;

  providerHealth[name].lastSuccess = new Date().toISOString();

  providerHealth[name].lastError = null;

}

function markProviderFailure(name, error) {

  providerHealth[name].failures += 1;

  providerHealth[name].lastError = error?.message || String(error);

}

function sleep(ms) {

  return new Promise(resolve => setTimeout(resolve, ms));

}

function parsePrice(value) {

  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const cleaned = String(value)

    .replace(/,/g, "")

    .replace(/[^0-9.]/g, "");

  if (!cleaned) return null;

  const number = Number(cleaned);

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

  const seller = normalize(value);

  return (

    seller === "walmart" ||

    seller === "walmart com" ||

    seller === "walmartcom"

  );

}

function getSellerName(item) {

  if (!item) return null;

  if (typeof item.seller === "string") {

    return item.seller;

  }

  if (

    item.seller &&

    typeof item.seller === "object"

  ) {

    return (

      item.seller.name ||

      item.seller.displayName ||

      null

    );

  }

  return (

    item.sellerName ||

    item.sellerDisplayName ||

    null

  );

}

function getSellerType(item) {

  return normalize(

    item?.otherDetails?.sellerType ||

    item?.sellerType

  );

}

function getPrice(item) {

  return parsePrice(

    item?.price?.currentPrice ??

    item?.price?.currentPriceDisplay ??

    item?.priceDetails?.currentPrice?.price ??

    item?.priceDetails?.currentPrice?.priceString ??

    item?.currentPrice ??

    item?.salePrice ??

    (

      typeof item?.price === "number"

        ? item.price

        : null

    )

  );

}

function getImage(item) {

  if (!item) return null;

  if (

    Array.isArray(item.images) &&

    item.images.length

  ) {

    const first = item.images[0];

    if (typeof first === "string") {

      return first;

    }

    if (

      first &&

      typeof first === "object"

    ) {

      return (

        first.url ||

        first.imageUrl ||

        first.src ||

        null

      );

    }

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

    item?.availability ||

    item?.availabilityStatus ||

    item?.stockStatus ||

    item?.otherDetails?.availabilityStatusV2?.value ||

    item?.otherDetails?.availabilityStatusV2?.display ||

    item?.otherDetails?.availabilityStatus ||

    item?.shippingOption?.availabilityStatus

  );

}

function getItemId(item) {

  return (

    item?.itemId ||

    item?.id ||

    item?.usItemId ||

    null

  );

}

function normalizeStatus(value, inStock = false) {

  const text = normalize(value);

  if (

    /pre ?order|raffle|drawing|scheduled drop|coming soon/

      .test(text)

  ) {

    return "preorder";

  }

  if (/on hand/.test(text)) {

    return "onhand";

  }

  if (/transit/.test(text)) {

    return "transit";

  }

  if (/ordered/.test(text)) {

    return "ordered";

  }

  if (

    /out of stock|unavailable|sold out|not available/

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

  const text = normalize(

    [

      item?.title,

      item?.name,

      item?.availability,

      item?.availabilityStatus,

      item?.url

    ]

      .filter(Boolean)

      .join(" ")

  );

  if (/raffle|drawing|lottery/.test(text)) {

    return "raffle";

  }

  if (/pre ?order/.test(text)) {

    return "preorder";

  }

  if (/scheduled drop|coming soon/.test(text)) {

    return "scheduled";

  }

  return null;

}

function detectSet(value) {

  const text = normalize(value);

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

  const text = normalize(value);

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

    text.includes(

      "tin"

    )

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

  const text = normalize(value);

  return (

    /\bpsa\s*[0-9]+\b/.test(text) ||

    /\bbgs\s*[0-9]+\b/.test(text) ||

    /\bcgc\s*[0-9]+\b/.test(text) ||

    text.includes("graded card") ||

    text.includes("graded pokemon")

  );

}

function isPokemonListing(value) {

  return normalize(value)

    .includes("pokemon");

}

function productMatches(product, item) {

  const expected =

    normalize(

      product.name ||

      product.searchTerm

    );

  const actual =

    normalize(

      item?.name ||

      item?.title

    );

  if (

    !expected ||

    !actual ||

    !isPokemonListing(actual)

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

function displayProductMatches(product, item) {

  const actualName =

    item?.name ||

    item?.title ||

    "";

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

function marketplaceProductMatches(

  product,

  item

) {

  return (

    displayProductMatches(

      product,

      item

    ) &&

    Number(

      getPrice(item)

    ) > 0

  );

}

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

      const error =

        new Error(

          `${timeoutLabel} returned ${response.status}`

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

    clearTimeout(timeout);

  }

}

function openRapidApiCircuit(error) {

  const now = Date.now();

  rapidApiCircuit = {

    open: true,

    reason:

      error?.message ||

      "RapidAPI authentication failure",

    openedAt:

      new Date(now).toISOString(),

    retryAfter:

      new Date(

        now +

        RAPIDAPI_AUTH_COOLDOWN_MS

      ).toISOString()

  };

  console.error(

    "RapidAPI circuit opened:",

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

  if (!rapidApiCircuit.open) {

    return false;

  }

  const retryAfterMs =

    Date.parse(

      rapidApiCircuit.retryAfter || ""

    );

  if (

    Number.isFinite(retryAfterMs) &&

    Date.now() >= retryAfterMs

  ) {

    closeRapidApiCircuit();

    return false;

  }

  return true;

}

async function rapidApiRequest(path) {

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

      .rapidapi

      .blockedRequests += 1;

    const error =

      new Error(

        `RapidAPI temporarily disabled after authentication failure. Retry after ${rapidApiCircuit.retryAfter}`

      );

    error.code =

      "RAPIDAPI_CIRCUIT_OPEN";

    throw error;

  }

  markProviderStart(

    "rapidapi"

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

        "Walmart API"

      );

    markProviderSuccess(

      "rapidapi"

    );

    closeRapidApiCircuit();

    return data;

  } catch (error) {

    markProviderFailure(

      "rapidapi",

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

      q: query,

      domain: "walmart.com",

      language: "en",

      sort: "bestMatch",

      page: "1",

      deliveryType: "shipping"

    });

  return await fetchJson(

    `https://api.hasdata.com/scrape/walmart/search?${params.toString()}`,

    {

      method: "GET",

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

async function hasDataSearch(query) {

  if (!HASDATA_API_KEY) {

    throw new Error(

      "HASDATA_API_KEY is missing"

    );

  }

  let lastError = null;

  for (

    let attempt = 1;

    attempt <= HASDATA_MAX_ATTEMPTS;

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

      if (

        !Array.isArray(

          data?.productResults

        )

      ) {

        return [];

      }

      return data.productResults;

    } catch (error) {

      lastError = error;

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

      const delay =

        HASDATA_RETRY_DELAY_MS *

        attempt;

      console.warn(

        `HasData transient failure for "${query}". Retrying in ${delay}ms (${attempt}/${HASDATA_MAX_ATTEMPTS})...`,

        error.message

      );

      await sleep(

        delay

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

  const status =

    normalizeStatus(

      availability

    );

  const offerAvailable =

    status ===

    "instock";

  const inStock =

    directSeller &&

    offerAvailable;

  const itemId =

    getItemId(item);

  const url =

    item?.canonicalUrl ||

    item?.productUrl ||

    item?.url ||

    (

      itemId

        ? `https://www.walmart.com/ip/${itemId}`

        : null

    );

  const dropType =

    detectDropType(item);

  return {

    productId:

      product.id,

    name:

      item?.name ||

      item?.title ||

      product.name,

    set:

      product.set,

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

      availability || "",

    dropType,

    upcoming:

      status ===

        "preorder" ||

      Boolean(

        dropType

      ),

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

    offerAvailable,

    alertEligible:

      directSeller &&

      inStock

  };

}

function extractSearchResults(data) {

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

      data

        ?.searchResult

        ?.items

    )

  ) {

    return data

      .searchResult

      .items;

  }

  return [];

}

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

          Number(

            item.price

          ) > 0

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

    await rapidApiRequest(

      `/search?${params.toString()}`

    );

  return buildMarketplaceOffers(

    product,

    extractSearchResults(

      data

    )

  );

}

async function checkKnownItem(

  product,

  itemId

) {

  const data =

    await rapidApiRequest(

      `/product?itemId=${encodeURIComponent(itemId)}`

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

  const data =

    await rapidApiRequest(

      `/search?${params.toString()}`

    );

  const results =

    extractSearchResults(

      data

    );

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

      inStock: false,

      directSeller: false,

      marketplaceOnly: false,

      alertEligible: false,

      discoveryMode: true,

      previewOnly: true,

      previewSeller:

        preview.seller,

      error:

        "No validated Walmart-direct result found"

    };

  }

  return emptyResult(

    product,

    "walmart-discovery",

    "No validated Walmart-direct result found"

  );

}

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

    source,

    marketplaceOnly:

      false,

    offerAvailable:

      false,

    alertEligible:

      false,

    image:

      null,

    error

  };

}

function buildQueryForGroup(products) {

  const first =

    products[0] || {};

  const set =

    String(

      first.set || ""

    ).trim();

  if (

    set &&

    !/auto discovered|other pokemon/i

      .test(set)

  ) {

    return `Pokemon TCG ${set}`;

  }

  return "Pokemon TCG";

}

function groupCuratedProducts(

  products

) {

  const groups =

    new Map();

  for (const product of products) {

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

function chooseBestMatch(

  product,

  results

) {

  const direct =

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

  if (direct) {

    return {

      item:

        direct,

      direct:

        true

    };

  }

  const display =

    results.find(

      item =>

        displayProductMatches(

          product,

          item

        )

    );

  if (display) {

    return {

      item:

        display,

      direct:

        false

    };

  }

  return null;

}

function collectUpcoming(results) {

  const candidates = [];

  for (const item of results) {

    const rawStatus =

      getAvailability(item);

    const status =

      normalizeStatus(

        rawStatus

      );

    const dropType =

      detectDropType(item);

    if (

      status !== "preorder" &&

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

      name:

        item?.title ||

        item?.name ||

        "Upcoming Walmart Pokémon item",

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

      seller:

        getSellerName(item),

      directSeller:

        isWalmartSeller(

          getSellerName(item)

        ),

      image:

        getImage(item),

      url:

        item?.url ||

        item?.productUrl ||

        (

          itemId

            ? `https://www.walmart.com/ip/${itemId}`

            : null

        ),

      checkedAt:

        new Date()

          .toISOString(),

      source:

        "hasdata-upcoming-detection"

    });

  }

  return candidates;

}

async function checkProductsBatch(products) {

  if (

    !HASDATA_API_KEY ||

    !Array.isArray(products) ||

    !products.length

  ) {

    return null;

  }

  const groups =

    groupCuratedProducts(products);

  const output = [];

  const upcomingMap = new Map();

  for (const group of groups) {

    const query =

      buildQueryForGroup(group);

    let results = [];

    try {

      results =

        await hasDataSearch(query);

    } catch (error) {

      console.error(

        `HasData Walmart search failed for "${query}":`,

        error.message

      );

      for (const product of group) {

        output.push({

          ...emptyResult(

            product,

            "hasdata-scan-error",

            error.message

          ),

          error:

            error.message

        });

      }

      continue;

    }

    for (

      const upcoming

      of collectUpcoming(results)

    ) {

      const key =

        upcoming.walmartItemId ||

        upcoming.name;

      upcomingMap.set(

        String(key),

        upcoming

      );

    }

    for (const product of group) {

      const match =

        chooseBestMatch(

          product,

          results

        );

      if (!match) {

        output.push(

          emptyResult(

            product,

            "hasdata-no-match",

            "No matching Walmart result in batch search"

          )

        );

        continue;

      }

      const result =

        makeResult(

          product,

          match.item,

          "hasdata-walmart-search"

        );

      if (!match.direct) {

        output.push({

          ...result,

          inStock: false,

          directSeller: false,

          marketplaceOnly: false,

          alertEligible: false,

          previewOnly: true,

          previewSeller:

            result.seller,

          error:

            "No validated Walmart-direct result found"

        });

      } else {

        output.push(result);

      }

    }

  }

  lastUpcoming =

    Array.from(

      upcomingMap.values()

    );

  return output;

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

        "walmart-rapidapi",

        "Retailer not supported by Walmart provider"

      ),

      retailer

    };

  }

  if (

    rapidApiCircuitIsBlocking()

  ) {

    return emptyResult(

      product,

      "walmart-timeout",

      `RapidAPI fallback temporarily unavailable until ${rapidApiCircuit.retryAfter}`

    );

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

      if (

        error?.status === 401 ||

        error?.status === 403 ||

        error?.code ===

          "RAPIDAPI_CIRCUIT_OPEN" ||

        error?.code ===

          "WALMART_TIMEOUT"

      ) {

        return emptyResult(

          product,

          "walmart-timeout",

          error.message

        );

      }

      discoveredItems.delete(

        product.id

      );

    }

  }

  if (

    rapidApiCircuitIsBlocking()

  ) {

    return emptyResult(

      product,

      "walmart-timeout",

      `RapidAPI fallback temporarily unavailable until ${rapidApiCircuit.retryAfter}`

    );

  }

  try {

    return await discoverProduct(

      product

    );

  } catch (error) {

    if (

      error?.status === 401 ||

      error?.status === 403 ||

      error?.code ===

        "RAPIDAPI_CIRCUIT_OPEN" ||

      error?.code ===

        "WALMART_TIMEOUT"

    ) {

      return emptyResult(

        product,

        "walmart-timeout",

        error.message

      );

    }

    throw error;

  }

}

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

    await rapidApiRequest(

      `/search?${params.toString()}`

    );

  const results =

    extractSearchResults(data);

  return {

    keyword,

    rapidApiTimeoutMs:

      RAPIDAPI_TIMEOUT_MS,

    hasDataConfigured:

      Boolean(

        HASDATA_API_KEY

      ),

    hasDataTimeoutMs:

      HASDATA_TIMEOUT_MS,

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

function getUpcoming() {

  return lastUpcoming;

}

function getProviderInfo() {

  const rapidApiBlocked =

    rapidApiCircuitIsBlocking();

  return {

    primary:

      HASDATA_API_KEY

        ? "hasdata"

        : "rapidapi",

    fallback:

      HASDATA_API_KEY &&

      RAPIDAPI_KEY

        ? "rapidapi"

        : null,

    fallbackEnabled:

      Boolean(

        HASDATA_API_KEY &&

        RAPIDAPI_KEY &&

        !rapidApiBlocked

      ),

    hasDataConfigured:

      Boolean(

        HASDATA_API_KEY

      ),

    rapidApiConfigured:

      Boolean(

        RAPIDAPI_KEY

      ),

    rapidApiBlocked,

    rapidApiCircuit: {

      ...rapidApiCircuit

    },

    hasDataTimeoutMs:

      HASDATA_TIMEOUT_MS,

    hasDataMaxAttempts:

      HASDATA_MAX_ATTEMPTS,

    hasDataRetryDelayMs:

      HASDATA_RETRY_DELAY_MS,

    rapidApiTimeoutMs:

      RAPIDAPI_TIMEOUT_MS,

    rapidApiAuthCooldownMs:

      RAPIDAPI_AUTH_COOLDOWN_MS,

    upcomingCount:

      lastUpcoming.length,

    health:

      JSON.parse(

        JSON.stringify(

          providerHealth

        )

      )

  };

}

module.exports = {

  checkProduct,

  checkProductsBatch,

  searchMarketplaceOffers,

  buildMarketplaceOffers,

  inspectSearchResponse,

  extractSearchResults,

  getUpcoming,

  getProviderInfo

};
