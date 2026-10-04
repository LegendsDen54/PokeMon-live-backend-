const HASDATA_API_KEY = process.env.HASDATA_API_KEY;

const HASDATA_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.HASDATA_TIMEOUT_MS || 7000)
);

const SEARCH_TERMS = [
  "Pokemon TCG 30th Anniversary",
  "Pokemon TCG 30th Celebration",
  "Pokemon 30th Anniversary booster bundle",
  "Pokemon 30th Anniversary elite trainer box",
  "Pokemon 30th Anniversary collection box",
  "Pokemon 30th Anniversary mini tin",
  "Pokemon 30th Anniversary tin",
  "Pokemon 30th Anniversary poster collection",
  "Pokemon 30th Anniversary tech sticker collection",
  "Pokemon 30th Anniversary premium collection"
];

let state = {
  running: false,
  lastRun: null,
  lastSuccess: null,
  lastError: null,
  queries: [],
  count: 0,
  directCount: 0,
  availableDirectCount: 0,
  items: []
};

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

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/[^0-9.]/g, "");

  if (!cleaned) {
    return null;
  }

  const number = Number(cleaned);

  return Number.isFinite(number)
    ? number
    : null;
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
  if (!item) {
    return null;
  }

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

function getItemId(item) {
  return (
    item?.itemId ||
    item?.id ||
    item?.usItemId ||
    null
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
  if (!item) {
    return null;
  }

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

function normalizeStatus(value) {
  const text = normalize(value);

  if (
    /pre ?order|raffle|drawing|scheduled drop/.test(text)
  ) {
    return "preorder";
  }

  if (
    /in stock|instock|available|in_stock/.test(text)
  ) {
    return "instock";
  }

  if (
    /out of stock|out|unavailable|sold out/.test(text)
  ) {
    return "out";
  }

  return "unknown";
}

function getListingText(item) {
  return normalize(
    [
      item?.title,
      item?.name,
      item?.description
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isThirtyAnniversary(item) {
  const text = normalize(
    [
      item?.title,
      item?.name,
      item?.description,
      item?.canonicalUrl,
      item?.productUrl,
      item?.url
    ]
      .filter(Boolean)
      .join(" ")
  );

  return (
    text.includes("pokemon") &&
    (
      text.includes("30th anniversary") ||
      text.includes("30th celebration") ||
      text.includes("pokemon 30th")
    )
  );
}

function isForeignLanguageProduct(item) {
  const text = getListingText(item);

  const blockedLanguages = [
    "chinese",
    "simplified chinese",
    "traditional chinese",
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
    language => text.includes(language)
  );
}

function isSingleCardOrCollectible(item) {
  const text = getListingText(item);

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
      pattern => pattern.test(text)
    )
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
    "collectible card",
    "collectible pokemon",
    "card only",
    "foil card",
    "promo card single"
  ];

  if (
    blockedPhrases.some(
      phrase => text.includes(phrase)
    )
  ) {
    return true;
  }

  if (
    /\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(text)
  ) {
    return true;
  }

  const cardLanguage = [
    "holo",
    "holographic",
    "reverse holo",
    "near mint",
    "illustration rare",
    "special illustration rare",
    "secret rare",
    "ultra rare",
    "trainer card",
    "ex card"
  ];

  const sealedTerms = [
    "elite trainer box",
    "etb",
    "booster bundle",
    "collection box",
    "poster collection",
    "tech sticker",
    "mini tin",
    "tin",
    "premium collection",
    "super premium collection",
    "figure collection",
    "deluxe pin collection",
    "blister",
    "3 pack",
    "three pack",
    "bundle",
    "box"
  ];

  const looksLikeCard =
    cardLanguage.some(
      term => text.includes(term)
    );

  const looksSealed =
    sealedTerms.some(
      term => text.includes(term)
    );

  return looksLikeCard && !looksSealed;
}

function isLooseBoosterPack(item) {
  const text = getListingText(item);

  const isBoosterPack =
    text.includes("booster pack");

  if (!isBoosterPack) {
    return false;
  }

  const allowedMultiPackTerms = [
    "3 pack",
    "three pack",
    "4 pack",
    "four pack",
    "6 pack",
    "six pack",
    "booster bundle",
    "blister",
    "collection",
    "box"
  ];

  return !allowedMultiPackTerms.some(
    term => text.includes(term)
  );
}

function looksLikeSealedRetailProduct(item) {
  const text = getListingText(item);

  const allowedProductTerms = [
    "elite trainer box",
    "etb",
    "booster bundle",
    "collection box",
    "collection",
    "poster collection",
    "tech sticker",
    "mini tin",
    "tin",
    "premium collection",
    "super premium",
    "figure collection",
    "deluxe pin collection",
    "blister",
    "3 pack",
    "three pack",
    "bundle",
    "box"
  ];

  return allowedProductTerms.some(
    term => text.includes(term)
  );
}

async function fetchJson(
  url,
  options,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          ...options,
          signal: controller.signal
        }
      );

    if (!response.ok) {
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
        `HasData 30th discovery timed out after ${timeoutMs}ms`
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

async function searchHasData(query) {
  if (!HASDATA_API_KEY) {
    throw new Error(
      "HASDATA_API_KEY is missing"
    );
  }

  const params =
    new URLSearchParams({
      q: query,
      domain: "walmart.com",
      language: "en",
      sort: "bestMatch",
      page: "1",
      deliveryType: "shipping"
    });

  const data =
    await fetchJson(
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
      HASDATA_TIMEOUT_MS
    );

  return Array.isArray(
    data?.productResults
  )
    ? data.productResults
    : [];
}

function normalizeCandidate(item) {
  const seller =
    getSellerName(item);

  const sellerType =
    getSellerType(item);

  const directSeller =
    isWalmartSeller(seller) &&
    sellerType !== "external";

  const rawStatus =
    getAvailability(item);

  const status =
    normalizeStatus(rawStatus);

  const itemId =
    getItemId(item);

  const price =
    getPrice(item);

  return {
    retailer: "walmart",
    retailerLabel: "Walmart",

    productId:
      itemId
        ? `walmart-30th-${itemId}`
        : null,

    walmartItemId:
      itemId,

    name:
      item?.title ||
      item?.name ||
      "Pokemon 30th Anniversary product",

    set:
      "30th Anniversary",

    productType:
      null,

    status,
    rawStatus,

    inStock:
      directSeller &&
      status === "instock",

    directSeller,
    price,

    msrp:
      null,

    seller:
      directSeller
        ? "Walmart"
        : (
            seller ||
            "Marketplace Seller"
          ),

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
      new Date().toISOString(),

    source:
      "hasdata-30th-discovery",

    discoveryOnly:
      true,

    watchOnly:
      false,

    alertEligible:
      false
  };
}

async function runDiscovery() {
  if (state.running) {
    return {
      ok: false,
      skipped: true,
      reason:
        "30th discovery already running"
    };
  }

  state.running = true;
  state.lastError = null;

  const allItems = [];
  const queryResults = [];

  try {
    for (
      const query of SEARCH_TERMS
    ) {
      const results =
        await searchHasData(query);

      let accepted = 0;

      for (
        const item of results
      ) {
        if (
          !isThirtyAnniversary(item)
        ) {
          continue;
        }

        if (
          isForeignLanguageProduct(item)
        ) {
          continue;
        }

        if (
          isSingleCardOrCollectible(item)
        ) {
          continue;
        }

        if (
          isLooseBoosterPack(item)
        ) {
          continue;
        }

        if (
          !looksLikeSealedRetailProduct(item)
        ) {
          continue;
        }

        allItems.push(
          normalizeCandidate(item)
        );

        accepted += 1;
      }

      queryResults.push({
        query,
        results:
          results.length,
        accepted
      });
    }

    const unique =
      new Map();

    for (
      const item of allItems
    ) {
      const key =
        item.walmartItemId ||
        normalize(item.url) ||
        normalize(item.name);

      if (!key) {
        continue;
      }

      const existing =
        unique.get(
          String(key)
        );

      if (
        !existing ||
        (
          item.directSeller &&
          !existing.directSeller
        ) ||
        (
          item.directSeller ===
            existing.directSeller &&
          item.price != null &&
          (
            existing.price == null ||
            Number(item.price) <
            Number(existing.price)
          )
        )
      ) {
        unique.set(
          String(key),
          item
        );
      }
    }

    const items =
      Array.from(
        unique.values()
      )
        .sort(
          (a, b) => {

            if (
              a.directSeller !==
              b.directSeller
            ) {
              return (
                a.directSeller
                  ? -1
                  : 1
              );
            }

            if (
              a.inStock !==
              b.inStock
            ) {
              return (
                a.inStock
                  ? -1
                  : 1
              );
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

    state = {
      running: false,

      lastRun:
        new Date().toISOString(),

      lastSuccess:
        new Date().toISOString(),

      lastError:
        null,

      queries:
        queryResults,

      count:
        items.length,

      directCount:
        items.filter(
          item =>
            item.directSeller
        ).length,

      availableDirectCount:
        items.filter(
          item =>
            item.directSeller &&
            item.inStock
        ).length,

      items
    };

    return {
      ok: true,
      ...state
    };

  } catch (error) {
    state = {
      ...state,

      running:
        false,

      lastRun:
        new Date().toISOString(),

      lastError:
        error.message,

      queries:
        queryResults
    };

    throw error;
  }
}

function getState() {
  return JSON.parse(
    JSON.stringify(state)
  );
}

module.exports = {
  runDiscovery,
  getState
};
