const push = require("./push");
const discovery = require("./discovery");

const HASDATA_API_KEY =
  process.env.HASDATA_API_KEY || "";
const providerCooldown = require("./provider-cooldown");

const HASDATA_TIMEOUT_MS =
  Math.max(
    3000,
    Number(
      process.env.HASDATA_TIMEOUT_MS ||
      7000
    )
  );

const MAX_PRICE_MULTIPLIER =
  Math.max(
    1,
    Number(
      process.env.WALMART_MAX_MSRP_MULTIPLIER ||
      1.5
    )
  );

/*
  ==================================================
  WALMART POKEMON SEALED-PRODUCT DISCOVERY
  ==================================================

  GOALS

  - Broad discovery of sealed Pokemon TCG products
  - Walmart Direct
  - GT Collectibles and Toys
  - English / U.S. products
  - No singles
  - No graded cards
  - No loose individual booster packs

  WALMART DIRECT ALERT RULE

  In stock
  AND
  verified/reference MSRP is known
  AND
  Walmart price <= 150% of MSRP

  GT COLLECTIBLES RULE

  In stock AND within the same verified price
  range used for Walmart Direct listings.

  IMPORTANT

  Newly discovered qualifying IN-STOCK products
  ARE allowed to alert immediately.

  Missing from a search page does NOT mean
  out of stock.
*/


/* ========================================
   SEARCH POOL

   "Pokemon TCG" runs every cycle.

   The other searches rotate so we get much
   broader coverage without burning every API
   query on every scan.
======================================== */

const ALWAYS_SEARCH_TERMS = [
  "Pokemon TCG",
  "Pokemon TCG Booster Box",
  "Pokemon TCG 30th Celebration Booster Box"
];

const ROTATING_SEARCH_TERMS = [
  "Pokemon TCG Elite Trainer Box",
  "Pokemon TCG Booster Bundle",
  "Pokemon TCG Booster Box",
  "Pokemon TCG Collection Box",
  "Pokemon TCG Premium Collection",
  "Pokemon TCG Tin",
  "Pokemon TCG Mini Tin",
  "Pokemon TCG Blister",
  "Pokemon TCG Poster Collection",
  "Pokemon TCG Tech Sticker",
  "Pokemon TCG Knock Out Collection",
  "Pokemon TCG 30th Anniversary",
  "Pokemon Prismatic Evolutions",
  "Pokemon Destined Rivals",
  "Pokemon Ascended Heroes",
  "Pokemon Delta Reign",
  "Pokemon Chaos Rising"
];

const ROTATING_QUERIES_PER_RUN =
  Math.max(
    1,
    Math.min(
      ROTATING_SEARCH_TERMS.length,
      Number(
        process.env
          .WALMART_DISCOVERY_ROTATING_QUERIES ||
        3
      )
    )
  );

let rotationIndex = 0;


/* ========================================
   ALERT STATE
======================================== */

/*
  Stores the last explicit stock state
  observed for qualifying products.

  First qualifying IN-STOCK observation:
  alert.

  OUT -> IN:
  alert.

  IN -> IN:
  do not alert repeatedly.
*/
const stockState =
  new Map();


/* ========================================
   MAIN STATE
======================================== */

let state = {
  running: false,

  lastRun: null,

  lastSuccess: null,

  lastError: null,

  queryCount: 0,

  totalQueryPool:
    ALWAYS_SEARCH_TERMS.length +
    ROTATING_SEARCH_TERMS.length,

  queries: [],

  count: 0,

  directCount: 0,

  approvedMarketplaceCount: 0,

  availableDirectCount: 0,

  availableApprovedMarketplaceCount: 0,

  qualifyingDirectCount: 0,

  unknownMsrpDirectCount: 0,

  alertsTriggered: 0,

  items: []
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
   SELLERS
======================================== */

function isWalmartSeller(value) {
  const seller =
    normalize(value);

  return (
    seller === "walmart" ||
    seller === "walmart com" ||
    seller === "walmartcom"
  );
}


function isApprovedMarketplaceSeller(
  value
) {
  const seller =
    normalize(value);

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


function getSellerName(item) {
  if (!item) {
    return null;
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
    item
      ?.otherDetails
      ?.sellerType ||

    item?.sellerType
  );
}


/* ========================================
   PRODUCT ID
======================================== */

function getItemId(item) {
  return (
    item?.itemId ||
    item?.id ||
    item?.usItemId ||
    null
  );
}


/* ========================================
   CURRENT PRICE
======================================== */

function getPrice(item) {
  return parsePrice(
    item
      ?.price
      ?.currentPrice ??

    item
      ?.price
      ?.currentPriceDisplay ??

    item
      ?.priceDetails
      ?.currentPrice
      ?.price ??

    item
      ?.priceDetails
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


/* ========================================
   MSRP / REFERENCE PRICE

   We intentionally do NOT make up MSRP.

   Only structured reference/list/MSRP values
   returned with the listing are considered.

   This protects the <=150% rule.
======================================== */

function getReferenceMsrp(item) {
  const known = require('./products.json').find(product =>
    product.walmartItemId && String(product.walmartItemId) === String(getItemId(item))
  );
  if (known && Number(known.msrp) > 0) return Number(known.msrp);
  const candidates = [
    item?.msrp,

    item?.manufacturerSuggestedRetailPrice,

    item?.listPrice,

    item?.regularPrice,

    item?.price?.listPrice,

    item?.price?.regularPrice,

    item?.price?.wasPrice,

    item?.price?.strikeThroughPrice,

    item?.price?.strikethroughPrice,

    item
      ?.priceDetails
      ?.listPrice
      ?.price,

    item
      ?.priceDetails
      ?.regularPrice
      ?.price,

    item
      ?.priceDetails
      ?.wasPrice
      ?.price,

    item
      ?.priceDetails
      ?.strikeThroughPrice
      ?.price,

    item
      ?.priceInfo
      ?.listPrice,

    item
      ?.priceInfo
      ?.regularPrice
  ];

  for (
    const candidate
    of candidates
  ) {
    const parsed =
      parsePrice(candidate);

    if (
      parsed !== null &&
      parsed > 0
    ) {
      return parsed;
    }
  }

  return null;
}


/* ========================================
   IMAGE
======================================== */

function getImage(item) {
  if (!item) {
    return null;
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

    if (
      first &&
      typeof first ===
        "object"
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


/* ========================================
   AVAILABILITY
======================================== */

function getAvailability(item) {
  return normalize(
    item?.availability ||

    item?.availabilityStatus ||

    item?.stockStatus ||

    item
      ?.otherDetails
      ?.availabilityStatusV2
      ?.value ||

    item
      ?.otherDetails
      ?.availabilityStatusV2
      ?.display ||

    item
      ?.otherDetails
      ?.availabilityStatus ||

    item
      ?.shippingOption
      ?.availabilityStatus
  );
}


function normalizeStatus(value) {
  const text =
    normalize(value);

  if (
    /pre ?order|raffle|drawing|scheduled drop|coming soon/
      .test(text)
  ) {
    return "preorder";
  }

  /*
    Negative terms MUST be checked before
    "available".
  */
  if (
    /out of stock|unavailable|sold out|not available/
      .test(text)
  ) {
    return "out";
  }

  if (
    /in stock|instock|available|in_stock/
      .test(text)
  ) {
    return "instock";
  }

  return "unknown";
}


/* ========================================
   LISTING TEXT
======================================== */

function getListingText(item) {
  return normalize(
    [
      item?.title,
      item?.name,
      item?.description,
      item?.shortDescription,
      item?.brand,
      item?.canonicalUrl,
      item?.productUrl,
      item?.url
    ]
      .filter(Boolean)
      .join(" ")
  );
}


/* ========================================
   POKEMON TCG CHECK
======================================== */

function isPokemonListing(item) {
  const text =
    getListingText(item);

  if (
    !text.includes("pokemon")
  ) {
    return false;
  }

  const tcgSignals = [
    "tcg",
    "trading card",
    "elite trainer",
    "booster",
    "collection",
    "tin",
    "blister",
    "etb",
    "deck"
  ];

  return tcgSignals.some(
    term =>
      text.includes(term)
  );
}


/* ========================================
   FOREIGN LANGUAGE FILTER
======================================== */

function isForeignLanguageProduct(item) {
  const text =
    getListingText(item);

  const blockedLanguages = [
    "simplified chinese",
    "traditional chinese",
    "chinese",
    "japanese",
    "korean",
    "spanish",
    "german",
    "french",
    "italian",
    "portuguese",
    "thai",
    "indonesian"
  ];

  return blockedLanguages.some(
    language =>
      text.includes(language)
  );
}


/* ========================================
   SINGLE / GRADED FILTER
======================================== */

function isSingleCardOrCollectible(item) {
  const text =
    getListingText(item);

  if (!text) {
    return false;
  }

  const gradingPatterns = [
    /\bpsa\s*\d+\b/,
    /\bbgs\s*\d+\b/,
    /\bcgc\s*\d+\b/,
    /\bsgc\s*\d+\b/
  ];

  if (
    gradingPatterns.some(
      pattern =>
        pattern.test(text)
    )
  ) {
    return true;
  }

  if (
    /\b\d{1,4}\s*\/\s*\d{1,4}\b/
      .test(text)
  ) {
    return true;
  }

  const blockedPhrases = [
    "single card",
    "individual card",
    "trading card single",
    "pokemon card single",
    "graded card",
    "raw card",
    "near mint card",
    "near mint or better",
    "holo card",
    "reverse holo",
    "holographic card",
    "card only",
    "foil card",
    "promo card single"
  ];

  if (
    blockedPhrases.some(
      phrase =>
        text.includes(phrase)
    )
  ) {
    return true;
  }

  return false;
}


/* ========================================
   LOOSE BOOSTER FILTER
======================================== */

function isLooseBoosterPack(item) {
  const text =
    getListingText(item);

  if (
    !text.includes(
      "booster pack"
    )
  ) {
    return false;
  }

  const allowedMultiPackTerms = [
    "2 pack",
    "2-pack",
    "3 pack",
    "3-pack",
    "three pack",
    "4 pack",
    "4-pack",
    "four pack",
    "6 pack",
    "6-pack",
    "six pack",
    "booster bundle",
    "booster box",
    "display box",
    "blister",
    "collection",
    "box"
  ];

  return !allowedMultiPackTerms.some(
    term =>
      text.includes(term)
  );
}


/* ========================================
   SEALED PRODUCT FILTER
======================================== */

function looksLikeSealedRetailProduct(
  item
) {
  const text =
    getListingText(item);

  const allowedProductTerms = [
    "elite trainer box",
    " etb ",
    "booster bundle",
    "booster box",
    "display box",
    "collection box",
    "collection",
    "poster collection",
    "tech sticker",
    "mini tin",
    "tin",
    "premium collection",
    "ultra premium collection",
    "super premium",
    "figure collection",
    "deluxe pin collection",
    "blister",
    "knock out collection",
    "knockout collection",
    "2 pack",
    "2-pack",
    "3 pack",
    "3-pack",
    "4 pack",
    "4-pack",
    "bundle",
    "deck"
  ];

  return allowedProductTerms.some(
    term =>
      text.includes(term.trim())
  );
}


/* ========================================
   SET CLASSIFICATION
======================================== */

function classifySet(value) {
  const text =
    normalize(value);

  const knownSets = [
    [
      "30th anniversary",
      "30th Anniversary"
    ],

    [
      "30th celebration",
      "30th Anniversary"
    ],

    [
      "prismatic evolutions",
      "Prismatic Evolutions"
    ],

    [
      "destined rivals",
      "Destined Rivals"
    ],

    [
      "ascended heroes",
      "Ascended Heroes"
    ],

    [
      "delta reign",
      "Delta Reign"
    ],

    [
      "chaos rising",
      "Chaos Rising"
    ]
  ];

  for (
    const [
      search,
      label
    ]
    of knownSets
  ) {
    if (
      text.includes(search)
    ) {
      return label;
    }
  }

  return "Other Pokemon TCG";
}


/* ========================================
   PRODUCT TYPE
======================================== */

function classifyProductType(value) {
  const text =
    normalize(value);

  if (
    text.includes(
      "ultra premium collection"
    )
  ) {
    return "Ultra Premium Collection";
  }

  if (
    text.includes(
      "super premium"
    )
  ) {
    return "Super Premium Collection";
  }

  if (
    text.includes(
      "premium figure collection"
    ) ||
    text.includes(
      "figure collection"
    )
  ) {
    return "Premium Figure Collection";
  }

  if (
    text.includes(
      "elite trainer box"
    ) ||
    /\betb\b/.test(text)
  ) {
    return "Elite Trainer Box";
  }

  if (
    text.includes(
      "booster bundle"
    )
  ) {
    return "Booster Bundle";
  }

  if (
    text.includes(
      "booster box"
    ) ||
    text.includes(
      "display box"
    )
  ) {
    return "Booster Box";
  }

  if (
    text.includes(
      "poster collection"
    )
  ) {
    return "Poster Collection";
  }

  if (
    text.includes(
      "tech sticker"
    )
  ) {
    return "Tech Sticker Collection";
  }

  if (
    text.includes(
      "mini tin"
    )
  ) {
    return "Mini Tin";
  }

  if (
    text.includes(
      "knock out"
    ) ||
    text.includes(
      "knockout"
    )
  ) {
    return "Knock Out Collection";
  }

  if (
    text.includes(
      "blister"
    )
  ) {
    return "Blister";
  }

  if (
    /\btin\b/.test(text)
  ) {
    return "Tin";
  }

  if (
    text.includes(
      "collection"
    )
  ) {
    return "Collection";
  }

  if (
    text.includes(
      "deck"
    )
  ) {
    return "Deck";
  }

  return "Sealed Pokemon TCG";
}


/* ========================================
   FETCH
======================================== */

async function fetchJson(
  url,
  options,
  timeoutMs
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

    if (
      !response.ok
    ) {
      throw new Error(
        `HasData returned HTTP ${response.status}`
      );
    }

    return await response.json();

  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        `HasData Pokemon discovery timed out after ${timeoutMs}ms`
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}


/* ========================================
   HASDATA SEARCH
======================================== */

async function searchHasData(query) {
  if (
    !HASDATA_API_KEY
  ) {
    throw new Error(
      "HASDATA_API_KEY is missing"
    );
  }

  if (providerCooldown.isBlocked("hasdata")) {
    throw new Error(
      `HasData temporarily disabled until ${providerCooldown.getState("hasdata").retryAfter}`
    );
  }

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

  let data;
  try {
    data = await fetchJson(
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

      HASDATA_TIMEOUT_MS
    );
  } catch (error) {
    if (/HTTP 403|HTTP 429|quota|credit|plan/i.test(error.message || "")) {
      providerCooldown.block("hasdata", error.message);
    }
    throw error;
  }

  return Array.isArray(
    data?.productResults
  )
    ? data.productResults
    : [];
}


/* ========================================
   ROTATING SEARCHES
======================================== */

function getSearchTermsForRun() {
  const selected = [
    ...ALWAYS_SEARCH_TERMS
  ];

  for (
    let i = 0;
    i <
      ROTATING_QUERIES_PER_RUN;
    i += 1
  ) {
    const index =
      (
        rotationIndex + i
      ) %
      ROTATING_SEARCH_TERMS.length;

    selected.push(
      ROTATING_SEARCH_TERMS[index]
    );
  }

  rotationIndex =
    (
      rotationIndex +
      ROTATING_QUERIES_PER_RUN
    ) %
    ROTATING_SEARCH_TERMS.length;

  return selected;
}


/* ========================================
   NORMALIZE CANDIDATE
======================================== */

function normalizeCandidate(item) {
  const seller =
    getSellerName(item);

  const sellerType =
    getSellerType(item);

  const directSeller =
    isWalmartSeller(
      seller
    ) &&
    sellerType !==
      "external";

  const approvedMarketplace =
    !directSeller &&
    Boolean(String(seller || '').trim()) &&
    !/^(?:unknown|marketplace seller)$/i.test(String(seller).trim());

  const rawStatus =
    getAvailability(item);

  const status =
    normalizeStatus(
      rawStatus
    );

  const itemId =
    getItemId(item);

  const price =
    getPrice(item);

  const msrp =
    getReferenceMsrp(item);

  const name =
    item?.title ||
    item?.name ||
    "Pokemon TCG product";

  const withinPriceRule =
    (
      directSeller ||
      approvedMarketplace
    ) &&
    price !== null &&
    msrp !== null &&
    price <=
      msrp *
      MAX_PRICE_MULTIPLIER;

  const alertEligible =
    withinPriceRule === true;

  const inStock =
    (
      directSeller ||
      approvedMarketplace
    ) &&
    status ===
      "instock";

  return {
    retailer:
      "walmart",

    retailerLabel:
      "Walmart",

    productId:
      itemId
        ? `walmart-pokemon-${itemId}`
        : null,

    walmartItemId:
      itemId,

    name,

    set:
      classifySet(name),

    productType:
      classifyProductType(name),

    status,

    rawStatus,

    inStock,

    directSeller,

    approvedMarketplace,

    price,

    msrp,

    maxAllowedPrice:
      msrp !== null
        ? Number(
            (
              msrp *
              MAX_PRICE_MULTIPLIER
            ).toFixed(2)
          )
        : null,

    withinPriceRule,

    seller:
      directSeller
        ? "Walmart"
        : (seller || "Marketplace Seller"),

    image:
      getImage(item),

    url:
      item?.canonicalUrl ||
      item?.productUrl ||
      item?.url ||
      (
        itemId
          ? `https://www.walmart.com/ip/${itemId}`
          : null
      ),

    checkedAt:
      new Date()
        .toISOString(),

    source:
      "hasdata-pokemon-discovery",

    discoveryOnly:
      true,

    watchOnly:
      !alertEligible,

    alertEligible
  };
}


/* ========================================
   ALERT KEY
======================================== */

function getDiscoveryKey(item) {
  return String(
    item?.walmartItemId ||
    item?.productId ||
    item?.url ||
    normalize(
      item?.name
    ) ||
    ""
  );
}


/* ========================================
   ALERT PROCESSOR
======================================== */

async function processDiscoveryAlerts(
  items
) {
  let alertsTriggered =
    0;

  for (
    const item
    of items
  ) {
    const key =
      getDiscoveryKey(item);

    if (!key) {
      continue;
    }

    const qualifying =
      item.alertEligible ===
        true &&

      (
        item.directSeller ===
          true ||

        item
          .approvedMarketplace ===
          true
      );

    /*
      We only establish alert state for products
      that satisfy the user's seller + price
      rules.

      Walmart Direct without a reference MSRP
      can still appear in discovery but will not
      alert until MSRP eligibility is known.
    */
    if (!qualifying) {
      continue;
    }

    /*
      Unknown status is not evidence of OUT.
    */
    if (
      item.status ===
      "unknown"
    ) {
      continue;
    }

    const currentInStock =
      item.inStock === true;

    const hasPrevious =
      stockState.has(key);

    const previous =
      hasPrevious
        ? stockState.get(key)
        : null;

    stockState.set(
      key,
      currentInStock
    );

    /*
      ALERT CONDITIONS

      1. First time ever observed and already
         qualifying + IN STOCK.

      A product receives one alert for its Walmart
      item ID. It may stay visible while available,
      but it is not announced again after a later
      scan or service restart.
    */
    const shouldAlert =
      currentInStock === true &&
      !hasPrevious;

    if (!shouldAlert) {
      continue;
    }

    if (
      await discovery.hasWalmartProductAlert(
        key
      )
    ) {
      continue;
    }

    console.log(
      `Walmart Pokemon qualifying stock detected: ${key}`,
      {
        seller:
          item.seller,

        price:
          item.price,

        msrp:
          item.msrp,

        maxAllowedPrice:
          item.maxAllowedPrice
      }
    );

    try {
      const pushResult =
        await push
          .sendRestockAlert(
            item
          );

      console.log(
        `Walmart Pokemon push processed for ${key}:`,
        pushResult
      );

      if (
        pushResult?.skipped !==
          true &&
        pushResult?.ok ===
          true
      ) {
        await discovery.recordWalmartProductAlert(
          key,
          item
        );

        alertsTriggered +=
          1;
      }

    } catch (error) {
      console.error(
        `Walmart discovery push failed for ${key}:`,
        error.message
      );
    }
  }

  return alertsTriggered;
}


/* ========================================
   DEDUPE
======================================== */

function dedupeItems(items) {
  const unique =
    new Map();

  for (
    const item
    of items
  ) {
    const key =
      item.walmartItemId ||
      normalize(
        item.url
      ) ||
      normalize(
        item.name
      );

    if (!key) {
      continue;
    }

    const mapKey =
      String(key);

    const existing =
      unique.get(mapKey);

    if (!existing) {
      unique.set(
        mapKey,
        item
      );

      continue;
    }

    /*
      Prefer Walmart Direct.
    */
    if (
      item.directSeller &&
      !existing.directSeller
    ) {
      unique.set(
        mapKey,
        item
      );

      continue;
    }

    /*
      Then GT.
    */
    if (
      item.approvedMarketplace &&
      !existing.directSeller &&
      !existing
        .approvedMarketplace
    ) {
      unique.set(
        mapKey,
        item
      );

      continue;
    }

    /*
      Same seller class:
      prefer in-stock.
    */
    if (
      item.directSeller ===
        existing.directSeller &&

      item
        .approvedMarketplace ===
        existing
          .approvedMarketplace &&

      item.inStock === true &&
      existing.inStock !== true
    ) {
      unique.set(
        mapKey,
        item
      );

      continue;
    }

    /*
      Same seller/status:
      prefer lower valid price.
    */
    if (
      item.directSeller ===
        existing.directSeller &&

      item
        .approvedMarketplace ===
        existing
          .approvedMarketplace &&

      item.price !== null &&

      (
        existing.price ===
          null ||

        Number(
          item.price
        ) <
        Number(
          existing.price
        )
      )
    ) {
      unique.set(
        mapKey,
        item
      );
    }
  }

  return Array.from(
    unique.values()
  );
}


/* ========================================
   SORT
======================================== */

function sortItems(items) {
  return items.sort(
    (
      a,
      b
    ) => {
      /*
        Qualifying available first.
      */
      const aQualifying =
        a.inStock === true &&
        a.alertEligible === true;

      const bQualifying =
        b.inStock === true &&
        b.alertEligible === true;

      if (
        aQualifying !==
        bQualifying
      ) {
        return aQualifying
          ? -1
          : 1;
      }

      /*
        Walmart Direct before GT.
      */
      if (
        a.directSeller !==
        b.directSeller
      ) {
        return a.directSeller
          ? -1
          : 1;
      }

      /*
        Available before unavailable.
      */
      if (
        a.inStock !==
        b.inStock
      ) {
        return a.inStock
          ? -1
          : 1;
      }

      return (
        Number(
          a.price ??
          Infinity
        ) -

        Number(
          b.price ??
          Infinity
        )
      );
    }
  );
}


/* ========================================
   DISCOVERY RUN
======================================== */

async function runDiscovery(
  options = {}
) {
  if (
    state.running
  ) {
    return {
      ok:
        false,

      skipped:
        true,

      reason:
        "Pokemon discovery already running"
    };
  }

  state.running =
    true;

  state.lastError =
    null;

  const allItems =
    [];

  const queryResults =
    [];

  const searchTerms =
    Array.isArray(options.searchTerms) && options.searchTerms.length
      ? options.searchTerms
      : getSearchTermsForRun();

  const approvedMarketplaceOnly =
    options.approvedMarketplaceOnly === true;

  try {
    for (
      const query
      of searchTerms
    ) {
      try {
        const results =
          await searchHasData(
            query
          );

        let accepted =
          0;

        for (
          const item
          of results
        ) {
          if (
            !isPokemonListing(
              item
            )
          ) {
            continue;
          }

          if (
            isForeignLanguageProduct(
              item
            )
          ) {
            continue;
          }

          if (
            isSingleCardOrCollectible(
              item
            )
          ) {
            continue;
          }

          if (
            isLooseBoosterPack(
              item
            )
          ) {
            continue;
          }

          if (
            !looksLikeSealedRetailProduct(
              item
            )
          ) {
            continue;
          }

          const candidate =
            normalizeCandidate(
              item
            );

          /*
            SELLER WHITELIST

            KEEP ONLY:
            - Walmart Direct
            - GT Collectibles
          */
          if (
            !candidate.directSeller &&
            !candidate
              .approvedMarketplace
          ) {
            continue;
          }

          if (
            approvedMarketplaceOnly &&
            !candidate.approvedMarketplace
          ) {
            continue;
          }

          allItems.push(
            candidate
          );

          accepted +=
            1;
        }

        queryResults.push({
          query,

          results:
            results.length,

          accepted
        });

      } catch (error) {
        /*
          One query failure does not kill the
          complete discovery cycle.
        */
        queryResults.push({
          query,

          results:
            0,

          accepted:
            0,

          error:
            error.message
        });
      }
    }

    const items =
      sortItems(
        dedupeItems(
          allItems
        )
      );

    const alertsTriggered =
      await processDiscoveryAlerts(
        items
      );

    const now =
      new Date()
        .toISOString();

    state = {
      running:
        false,

      lastRun:
        now,

      lastSuccess:
        now,

      lastError:
        null,

      queryCount:
        searchTerms.length,

      totalQueryPool:
        ALWAYS_SEARCH_TERMS.length +
        ROTATING_SEARCH_TERMS.length,

      queries:
        queryResults,

      count:
        items.length,

      directCount:
        items.filter(
          item =>
            item.directSeller ===
            true
        ).length,

      approvedMarketplaceCount:
        items.filter(
          item =>
            item
              .approvedMarketplace ===
            true
        ).length,

      availableDirectCount:
        items.filter(
          item =>
            item.directSeller ===
              true &&
            item.inStock ===
              true
        ).length,

      availableApprovedMarketplaceCount:
        items.filter(
          item =>
            item
              .approvedMarketplace ===
              true &&
            item.inStock ===
              true
        ).length,

      qualifyingDirectCount:
        items.filter(
          item =>
            item.directSeller ===
              true &&
            item.inStock ===
              true &&
            item.withinPriceRule ===
              true
        ).length,

      unknownMsrpDirectCount:
        items.filter(
          item =>
            item.directSeller ===
              true &&
            item.msrp ===
              null
        ).length,

      alertsTriggered,

      items
    };

    return {
      ok:
        true,

      ...state
    };

  } catch (error) {
    state = {
      ...state,

      running:
        false,

      lastRun:
        new Date()
          .toISOString(),

      lastError:
        error.message,

      queries:
        queryResults
    };

    throw error;
  }
}


/* ========================================
   STATE
======================================== */

function getState() {
  return JSON.parse(
    JSON.stringify(
      state
    )
  );
}


/* ========================================
   EXPORTS
======================================== */

module.exports = {
  runDiscovery,
  getState,
  isApprovedMarketplaceSeller
};
