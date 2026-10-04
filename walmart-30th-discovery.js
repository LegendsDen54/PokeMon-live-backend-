const push = require("./push");

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

  This filename remains unchanged because
  server.js already imports it.

  SELLER RULES

  ALLOW:
  - Walmart Direct
  - GT Collectibles and Toys

  IGNORE:
  - Every other Walmart marketplace seller

  ALERT RULES

  Walmart Direct:
  - Discovery remains watch-only until
    separate verified MSRP rules approve it.

  GT Collectibles:
  - Approved seller
  - MSRP is NOT required
  - Price ceiling does NOT apply
  - In-stock transition can trigger push

  PRODUCT RULES

  INCLUDE:
  - Sealed English Pokemon TCG products

  EXCLUDE:
  - Singles
  - Graded cards
  - Raw cards
  - Loose individual booster packs
  - Foreign-language products
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


/* ========================================
   STATE
======================================== */

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

  alertsTriggered: 0,

  items: []
};


/*
  In-memory restock baseline.

  This prevents the monitor from sending a
  GT alert simply because Render restarted.

  First observation = establish baseline.

  false -> true = actual restock transition.
*/
const discoveryStockBaseline =
  new Map();


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

function isWalmartSeller(value) {

  const seller =
    normalize(
      value
    );

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
    normalize(
      value
    );

  /*
    USER-APPROVED SELLER

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
   ITEM ID
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
   PRICE FROM HASDATA RESULT
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


/* ========================================
   STATUS
======================================== */

function normalizeStatus(value) {

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

function isPokemonListing(item) {

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

function isForeignLanguageProduct(item) {

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

function isLooseBoosterPack(item) {

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

function classifySet(value) {

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

function classifyProductType(value) {

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
   FETCH JSON WITH TIMEOUT
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

    clearTimeout(
      timeout
    );
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
   NORMALIZE DISCOVERED PRODUCT
======================================== */

function normalizeCandidate(item) {

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

  /*
    GT exception:

    GT is explicitly approved regardless
    of MSRP or price.

    Walmart Direct discovery remains
    watch-only until verified MSRP logic
    separately approves it.
  */
  const alertEligible =
    approvedMarketplace === true;

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
      MSRP remains unknown for automatic
      discovery. GT does not require MSRP.
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
      Walmart Direct discovery is still
      watched safely.

      GT can alert independently of MSRP.
    */
    watchOnly:
      !approvedMarketplace,

    alertEligible
  };
}


/* ========================================
   DISCOVERY KEY
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
   GT RESTOCK TRANSITIONS
======================================== */

async function processDiscoveryAlerts(
  items
) {

  let alertsTriggered =
    0;

  const seen =
    new Set();

  for (
    const item
    of items
  ) {

    const key =
      getDiscoveryKey(
        item
      );

    if (!key) {
      continue;
    }

    seen.add(
      key
    );

    /*
      Discovery push is deliberately limited
      to the approved GT marketplace seller.

      Walmart-direct discovery will receive
      its own verified MSRP eligibility path.
    */
    const qualifies =
      item
        .approvedMarketplace ===
        true &&

      item
        .alertEligible ===
        true &&

      item.inStock ===
        true;

    /*
      First time seen:
      establish baseline only.

      This avoids notification spam after a
      Render restart or deployment.
    */
    if (
      !discoveryStockBaseline
        .has(
          key
        )
    ) {

      discoveryStockBaseline.set(
        key,
        qualifies
      );

      continue;
    }

    const previous =
      discoveryStockBaseline.get(
        key
      );

    discoveryStockBaseline.set(
      key,
      qualifies
    );

    /*
      Actual restock:
      unavailable -> available
    */
    if (
      previous === false &&
      qualifies === true
    ) {

      console.log(
        `GT RESTOCK transition detected for ${key}`
      );

      try {

        const pushResult =
          await push.sendRestockAlert(
            item
          );

        console.log(
          `GT restock push processed for ${key}:`,
          pushResult
        );

        if (
          pushResult?.skipped !==
            true &&

          pushResult?.ok ===
            true
        ) {
          alertsTriggered +=
            1;
        }

      } catch (error) {

        console.error(
          `GT discovery push failed for ${key}:`,
          error.message
        );
      }
    }
  }


  /*
    If an item disappears from the current
    discovery results, mark the baseline
    unavailable.

    If it later returns in stock, the monitor
    can recognize the new transition.
  */
  for (
    const key
    of discoveryStockBaseline.keys()
  ) {

    if (
      !seen.has(
        key
      )
    ) {
      discoveryStockBaseline.set(
        key,
        false
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
      String(
        key
      );

    const existing =
      unique.get(
        mapKey
      );

    if (!existing) {

      unique.set(
        mapKey,
        item
      );

      continue;
    }


    /*
      Prefer Walmart Direct over marketplace.
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
      Prefer approved GT over any non-direct,
      non-approved offer.
    */
    if (
      item.approvedMarketplace &&

      !existing.directSeller &&

      !existing.approvedMarketplace
    ) {

      unique.set(
        mapKey,
        item
      );

      continue;
    }


    /*
      Same seller class:
      prefer available listing.
    */
    if (
      item.directSeller ===
        existing.directSeller &&

      item.approvedMarketplace ===
        existing.approvedMarketplace &&

      item.inStock ===
        true &&

      existing.inStock !==
        true
    ) {

      unique.set(
        mapKey,
        item
      );

      continue;
    }


    /*
      Same seller class/status:
      prefer lower valid price.
    */
    if (
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
        Walmart Direct first.
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
        Approved GT next.
      */
      if (
        a.approvedMarketplace !==
        b.approvedMarketplace
      ) {
        return a.approvedMarketplace
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

          /*
            Pokemon only.
          */
          if (
            !isPokemonListing(
              item
            )
          ) {
            continue;
          }


          /*
            English / U.S. product filter.
          */
          if (
            isForeignLanguageProduct(
              item
            )
          ) {
            continue;
          }


          /*
            No singles, raw cards,
            graded cards, etc.
          */
          if (
            isSingleCardOrCollectible(
              item
            )
          ) {
            continue;
          }


          /*
            No individual loose boosters.
          */
          if (
            isLooseBoosterPack(
              item
            )
          ) {
            continue;
          }


          /*
            Must resemble a sealed retail
            Pokemon TCG product.
          */
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

            KEEP:
            - Walmart Direct
            - GT Collectibles and Toys

            DROP:
            - every other marketplace seller
          */
          if (
            !candidate.directSeller &&

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
          One HasData query failing does not
          kill the whole discovery run.
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
       DEDUPE + SORT
    ======================================== */

    const items =
      sortItems(
        dedupeItems(
          allItems
        )
      );


    /* ========================================
       GT ALERT PROCESSING
    ======================================== */

    const alertsTriggered =
      await processDiscoveryAlerts(
        items
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
            item.approvedMarketplace ===
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
            item.approvedMarketplace ===
              true &&

            item.inStock ===
              true
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
