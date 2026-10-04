const HASDATA_API_KEY =
  process.env.HASDATA_API_KEY;

const HASDATA_TIMEOUT_MS =
  Math.max(
    3000,
    Number(
      process.env.HASDATA_TIMEOUT_MS ||
      7000
    )
  );

/*
  BROAD SEALED POKEMON DISCOVERY

  The filename is kept for compatibility with
  the existing server.js. It now searches ALL
  qualifying sealed Pokemon TCG products.
*/
const SEARCH_TERMS = [
  "Pokemon TCG",
  "Pokemon TCG Elite Trainer Box",
  "Pokemon TCG Booster Bundle",
  "Pokemon TCG Collection Box",
  "Pokemon TCG Mini Tin",
  "Pokemon TCG Tin",
  "Pokemon TCG Poster Collection",
  "Pokemon TCG Tech Sticker Collection",
  "Pokemon TCG Premium Collection",
  "Pokemon TCG Blister",
  "Pokemon TCG Knock Out Collection",

  "Pokemon Prismatic Evolutions",
  "Pokemon Destined Rivals",
  "Pokemon Ascended Heroes",
  "Pokemon Delta Reign",

  "Pokemon TCG 30th Anniversary",
  "Pokemon TCG 30th Celebration"
];

let state = {
  running: false,
  lastRun: null,
  lastSuccess: null,
  lastError: null,

  queries: [],

  count: 0,

  directCount: 0,

  approvedMarketplaceCount: 0,

  availableDirectCount: 0,

  availableApprovedMarketplaceCount: 0,

  items: []
};


/* ========================================
   NORMALIZE
======================================== */

function normalize(value) {
  return String(
    value ||
    ""
  )
    .toLowerCase()
    .replace(
      /pok[eé]mon/g,
      "pokemon"
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


/* ========================================
   PRICE
======================================== */

function parsePrice(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value ===
    "number"
  ) {
    return Number.isFinite(
      value
    )
      ? value
      : null;
  }

  const cleaned =
    String(value)
      .replace(
        /,/g,
        ""
      )
      .replace(
        /[^0-9.]/g,
        ""
      );

  if (!cleaned) {
    return null;
  }

  const number =
    Number(
      cleaned
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
}


/* ========================================
   SELLERS
======================================== */

function isWalmartSeller(
  value
) {

  const seller =
    normalize(
      value
    );

  return (
    seller ===
      "walmart" ||

    seller ===
      "walmart com" ||

    seller ===
      "walmartcom"
  );
}


function isApprovedMarketplaceSeller(
  value
) {

  const seller =
    normalize(
      value
    );

  /*
    Approved marketplace seller:
    GT Collectibles and Toys
  */
  return (
    seller ===
      "gt collectibles and toys" ||

    seller ===
      "gt collectibles toys" ||

    seller ===
      "gt collectibles"
  );
}


function getSellerName(
  item
) {

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


function getSellerType(
  item
) {

  return normalize(
    item
      ?.otherDetails
      ?.sellerType ||

    item?.sellerType
  );
}


/* ========================================
   BASIC ITEM HELPERS
======================================== */

function getItemId(
  item
) {

  return (
    item?.itemId ||
    item?.id ||
    item?.usItemId ||
    null
  );
}


function getPrice(
  item
) {

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


function getImage(
  item
) {

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


function getAvailability(
  item
) {

  return normalize(

    item?.availability ||

    item
      ?.availabilityStatus ||

    item
      ?.stockStatus ||

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


/* ========================================
   STATUS
======================================== */

function normalizeStatus(
  value
) {

  const text =
    normalize(
      value
    );

  if (
    /pre ?order|raffle|drawing|scheduled drop|coming soon/
      .test(
        text
      )
  ) {
    return "preorder";
  }

  if (
    /in stock|instock|available|in_stock/
      .test(
        text
      )
  ) {
    return "instock";
  }

  if (
    /out of stock|unavailable|sold out/
      .test(
        text
      )
  ) {
    return "out";
  }

  return "unknown";
}


/* ========================================
   LISTING TEXT
======================================== */

function getListingText(
  item
) {

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
      .filter(
        Boolean
      )
      .join(
        " "
      )
  );
}


/* ========================================
   POKEMON CHECK
======================================== */

function isPokemonListing(
  item
) {

  const text =
    getListingText(
      item
    );

  return (
    text.includes(
      "pokemon"
    ) &&
    (
      text.includes(
        "tcg"
      ) ||

      text.includes(
        "trading card"
      ) ||

      text.includes(
        "elite trainer"
      ) ||

      text.includes(
        "booster"
      ) ||

      text.includes(
        "collection"
      ) ||

      text.includes(
        "tin"
      ) ||

      text.includes(
        "blister"
      ) ||

      text.includes(
        "etb"
      )
    )
  );
}


/* ========================================
   FOREIGN LANGUAGE FILTER
======================================== */

function isForeignLanguageProduct(
  item
) {

  const text =
    getListingText(
      item
    );

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
      text.includes(
        language
      )
  );
}


/* ========================================
   SINGLE / GRADED CARD FILTER
======================================== */

function isSingleCardOrCollectible(
  item
) {

  const text =
    getListingText(
      item
    );

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
        pattern.test(
          text
        )
    )
  ) {
    return true;
  }

  if (
    /\b\d{1,4}\s*\/\s*\d{1,4}\b/
      .test(
        text
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
    "card only",
    "foil card",
    "promo card single"
  ];

  if (
    blockedPhrases.some(
      phrase =>
        text.includes(
          phrase
        )
    )
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
    "booster bundle",
    "booster box",
    "display box",
    "collection box",
    "poster collection",
    "tech sticker",
    "mini tin",
    "tin",
    "premium collection",
    "ultra premium collection",
    "super premium collection",
    "figure collection",
    "deluxe pin collection",
    "blister",
    "knock out collection",
    "knockout collection",
    "bundle",
    "box"
  ];

  const looksLikeCard =
    cardLanguage.some(
      term =>
        text.includes(
          term
        )
    );

  const looksSealed =
    sealedTerms.some(
      term =>
        text.includes(
          term
        )
    );

  return (
    looksLikeCard &&
    !looksSealed
  );
}


/* ========================================
   LOOSE BOOSTER FILTER
======================================== */

function isLooseBoosterPack(
  item
) {

  const text =
    getListingText(
      item
    );

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
      text.includes(
        term
      )
  );
}


/* ========================================
   SEALED PRODUCT FILTER
======================================== */

function looksLikeSealedRetailProduct(
  item
) {

  const text =
    getListingText(
      item
    );

  const allowedProductTerms = [
    "elite trainer box",
    "etb",
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
    "bundle"
  ];

  return allowedProductTerms.some(
    term =>
      text.includes(
        term
      )
  );
}


/* ========================================
   SET CLASSIFICATION
======================================== */

function classifySet(
  value
) {

  const text =
    normalize(
      value
    );

  if (
    text.includes(
      "30th anniversary"
    ) ||
    text.includes(
      "30th celebration"
    )
  ) {
    return "30th Anniversary";
  }

  if (
    text.includes(
      "prismatic evolutions"
    )
  ) {
    return "Prismatic Evolutions";
  }

  if (
    text.includes(
      "destined rivals"
    )
  ) {
    return "Destined Rivals";
  }

  if (
    text.includes(
      "ascended heroes"
    )
  ) {
    return "Ascended Heroes";
  }

  if (
    text.includes(
      "delta reign"
    )
  ) {
    return "Delta Reign";
  }

  return "Other Pokemon TCG";
}


/* ========================================
   PRODUCT TYPE
======================================== */

function classifyProductType(
  value
) {

  const text =
    normalize(
      value
    );

  if (
    text.includes(
      "elite trainer box"
    ) ||
    /\betb\b/.test(
      text
    )
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
    text.includes(
      "tin"
    )
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

  return "Sealed Pokemon TCG";
}


/* ========================================
   HASDATA FETCH
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

  }
  catch(error) {

    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        `HasData Pokemon discovery timed out after ${timeoutMs}ms`
      );
    }

    throw error;

  }
  finally {

    clearTimeout(
      timeout
    );

  }
}


async function searchHasData(
  query
) {

  if (
    !HASDATA_API_KEY
  ) {
    throw new Error(
      "HASDATA_API_KEY is missing"
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

  const data =
    await fetchJson(
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

  return Array.isArray(
    data?.productResults
  )
    ? data.productResults
    : [];
}


/* ========================================
   NORMALIZE RESULT
======================================== */

function normalizeCandidate(
  item
) {

  const seller =
    getSellerName(
      item
    );

  const sellerType =
    getSellerType(
      item
    );

  const directSeller =
    isWalmartSeller(
      seller
    ) &&
    sellerType !==
      "external";

  const approvedMarketplace =
    !directSeller &&
    isApprovedMarketplaceSeller(
      seller
    );

  const rawStatus =
    getAvailability(
      item
    );

  const status =
    normalizeStatus(
      rawStatus
    );

  const itemId =
    getItemId(
      item
    );

  const price =
    getPrice(
      item
    );

  const name =
    item?.title ||
    item?.name ||
    "Pokemon TCG product";

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
      classifySet(
        name
      ),

    productType:
      classifyProductType(
        name
      ),

    status,

    rawStatus,

    /*
      Walmart direct OR our approved
      GT marketplace seller can show
      offer availability.
    */
    inStock:
      (
        directSeller ||
        approvedMarketplace
      ) &&
      status ===
        "instock",

    directSeller,

    approvedMarketplace,

    price,

    /*
      Auto-discovered MSRP remains unknown
      until verified. This prevents unsafe
      over-price alerts.
    */
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
      getImage(
        item
      ),

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

    /*
      These automatically flow into the
      watchlist through walmart-watchlist.js.
    */
    watchOnly:
      true,

    /*
      MSRP is not known yet, so do not
      trigger a push from discovery alone.
    */
    alertEligible:
      false
  };
}


/* ========================================
   DISCOVERY RUN
======================================== */

async function runDiscovery() {

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

  try {

    for (
      const query
      of SEARCH_TERMS
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
            IMPORTANT SELLER RULE:

            Keep:
            - Walmart direct
            - GT Collectibles and Toys

            Ignore every other marketplace
            seller from the dynamic watchlist.
          */
          if (
            !candidate
              .directSeller &&
            !candidate
              .approvedMarketplace
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

      }
      catch(error) {

        /*
          One failed query does not kill
          the entire discovery scan.
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


    /* ========================================
       DEDUPE
    ======================================== */

    const unique =
      new Map();

    for (
      const item
      of allItems
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

      const existing =
        unique.get(
          String(
            key
          )
        );

      if (
        !existing ||

        (
          item.directSeller &&
          !existing
            .directSeller
        ) ||

        (
          item
            .approvedMarketplace &&
          !existing
            .directSeller &&
          !existing
            .approvedMarketplace
        ) ||

        (
          item.directSeller ===
            existing.directSeller &&

          item.approvedMarketplace ===
            existing.approvedMarketplace &&

          item.price !==
            null &&

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
        )
      ) {

        unique.set(
          String(
            key
          ),
          item
        );

      }

    }


    /* ========================================
       SORT
    ======================================== */

    const items =
      Array.from(
        unique.values()
      )
        .sort(
          (
            a,
            b
          ) => {

            /*
              Walmart direct first.
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
              GT Collectibles next.
            */
            if (
              a
                .approvedMarketplace !==
              b
                .approvedMarketplace
            ) {
              return a
                .approvedMarketplace
                ? -1
                : 1;
            }

            /*
              Available offers before
              unavailable ones.
            */
            if (
              a.inStock !==
              b.inStock
            ) {
              return a.inStock
                ? -1
                : 1;
            }

            /*
              Lower price first.
            */
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


    /* ========================================
       SAVE STATE
    ======================================== */

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

      items
    };

    return {
      ok:
        true,

      ...state
    };

  }
  catch(error) {

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
