require("dotenv").config();

const { Pool } = require("pg");
const verifiedCatalog = require("./products.json");


/* ========================================
   CONFIG
======================================== */

const RAPIDAPI_HOST =
  process.env.WALMART_RAPIDAPI_HOST ||
  "realtime-walmart-data.p.rapidapi.com";

const RAPIDAPI_KEY =
  process.env.WALMART_RAPIDAPI_KEY ||
  "";

const HASDATA_API_KEY =
  process.env.HASDATA_API_KEY ||
  "";

const HASDATA_TIMEOUT_MS =
  Math.max(
    5000,
    Number(
      process.env.HASDATA_TIMEOUT_MS ||
      15000
    )
  );

const RAPIDAPI_TIMEOUT_MS =
  Math.max(
    5000,
    Number(
      process.env.RAPIDAPI_TIMEOUT_MS ||
      15000
    )
  );


/*
  Existing rule:
  up to 50% above verified MSRP.

  $1 cushion prevents a tiny rounding /
  price-feed difference from causing
  an otherwise acceptable product to
  disappear.

  Tax is NOT displayed or added to
  the product card.
*/
const PRICE_MULTIPLIER =
  1.50;

const PRICE_CUSHION_DOLLARS =
  1.00;


const pool =
  new Pool({

    connectionString:
      process.env.DATABASE_URL,

    ssl:{
      rejectUnauthorized:false
    }

  });


/* ========================================
   NORMALIZE
======================================== */

function normalize(value){

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
   SELLER RULES
======================================== */

function isWalmartSeller(value){

  const seller =
    normalize(value);

  return (
    seller === "walmart" ||
    seller === "walmart com"
  );

}


function isGTCollectiblesSeller(value){

  const seller =
    normalize(value);

  return (
    seller.includes(
      "gt collectibles"
    )
  );

}


function isApprovedSeller(value){

  return (
    isWalmartSeller(value) ||
    isGTCollectiblesSeller(value)
  );

}


function getSellerName(item){

  if(
    item?.sellerName
  ){
    return item.sellerName;
  }


  if(
    item?.sellerDisplayName
  ){
    return item.sellerDisplayName;
  }


  if(
    typeof item?.seller ===
    "string"
  ){
    return item.seller;
  }


  if(
    item?.seller &&
    typeof item.seller ===
    "object"
  ){

    return (
      item.seller.name ||
      item.seller.displayName ||
      null
    );

  }


  if(
    item?.sellerInfo?.name
  ){
    return item.sellerInfo.name;
  }


  return null;

}


/* ========================================
   BASIC ITEM HELPERS
======================================== */

function getItemId(item){

  return (
    item?.usItemId ||
    item?.itemId ||
    item?.productId ||
    item?.id ||
    null
  );

}


function getItemName(item){

  return (
    item?.name ||
    item?.title ||
    item?.productName ||
    ""
  );

}


function getImage(item){

  if(
    Array.isArray(
      item?.images
    ) &&
    item.images.length
  ){

    const first =
      item.images[0];


    if(
      first &&
      typeof first ===
      "object"
    ){

      return (
        first.url ||
        first.imageUrl ||
        first.thumbnailUrl ||
        null
      );

    }


    return first;

  }


  return (
    item?.image ||
    item?.imageUrl ||
    item?.thumbnail ||
    item?.thumbnailUrl ||
    item?.productImage ||
    null
  );

}


function getPrice(item){

  const candidates = [

    item?.price,

    item?.currentPrice,

    item?.salePrice,

    item?.priceInfo
      ?.currentPrice
      ?.price,

    item?.priceDetails
      ?.currentPrice
      ?.price,

    item?.priceInfo
      ?.currentPrice,

    item?.priceDetails
      ?.currentPrice

  ];


  for(
    const candidate
    of candidates
  ){

    if(
      candidate === null ||
      candidate === undefined ||
      candidate === ""
    ){
      continue;
    }


    const value =
      typeof candidate ===
      "object"
        ? Number(
            candidate.price ??
            candidate.value
          )
        : Number(candidate);


    if(
      Number.isFinite(value) &&
      value > 0
    ){
      return value;
    }

  }


  return null;

}


function getAvailability(item){

  return String(

    item?.availabilityStatus ||

    item?.availability ||

    item?.stockStatus ||

    item?.fulfillmentStatus ||

    item?.status ||

    item?.inventoryStatus ||

    ""

  ).trim();

}


function normalizeAvailability(value){

  const text =
    normalize(value);


  if(
    text.includes(
      "preorder"
    ) ||
    text.includes(
      "pre order"
    )
  ){
    return "preorder";
  }


  if(
    text.includes(
      "in stock"
    ) ||
    text === "instock" ||
    text.includes(
      "available"
    ) ||
    text.includes(
      "orderable"
    )
  ){
    return "instock";
  }


  if(
    text.includes(
      "low stock"
    )
  ){
    return "lowstock";
  }


  if(
    text.includes(
      "out of stock"
    ) ||
    text.includes(
      "sold out"
    ) ||
    text.includes(
      "unavailable"
    )
  ){
    return "outofstock";
  }


  return (
    text ||
    "unknown"
  );

}


function isAvailableStatus(status){

  return (
    status === "instock" ||
    status === "preorder" ||
    status === "lowstock"
  );

}


function getUrl(item){

  const itemId =
    getItemId(item);


  const url =
    item?.canonicalUrl ||
    item?.productUrl ||
    item?.url ||
    item?.canonicalURL ||
    null;


  if(url){
    return url;
  }


  if(itemId){

    return (
      `https://www.walmart.com/ip/${encodeURIComponent(
        String(itemId)
      )}`
    );

  }


  return null;

}


/* ========================================
   PRODUCT CLASSIFICATION
======================================== */

function classifySet(name){

  const text =
    normalize(name);


  if(
    text.includes(
      "chaos rising"
    )
  ){
    return "Chaos Rising";
  }


  if(
    text.includes(
      "30th anniversary"
    ) ||
    text.includes(
      "30th celebration"
    ) ||
    text.includes(
      "30th"
    )
  ){
    return "Pokemon 30th Anniversary";
  }


  if(
    text.includes(
      "prismatic evolutions"
    )
  ){
    return "Prismatic Evolutions";
  }


  if(
    text.includes(
      "destined rivals"
    )
  ){
    return "Destined Rivals";
  }


  if(
    text.includes(
      "ascended heroes"
    )
  ){
    return "Ascended Heroes";
  }


  if(
    text.includes(
      "delta reign"
    )
  ){
    return "Delta Reign";
  }


  return "Other Pokemon TCG";

}


function classifyProductType(name){

  const text =
    normalize(name);


  if(
    text.includes(
      "elite trainer box"
    ) ||
    /\betb\b/.test(text)
  ){
    return "Elite Trainer Box";
  }


  if(
    text.includes(
      "booster bundle"
    )
  ){
    return "Booster Bundle";
  }


  if(
    text.includes(
      "booster box"
    ) ||
    text.includes(
      "display box"
    )
  ){
    return "Booster Box";
  }


  if(
    text.includes(
      "super premium"
    )
  ){
    return "Super-Premium Collection";
  }


  if(
    text.includes(
      "premium figure"
    )
  ){
    return "Premium Figure Collection";
  }


  if(
    text.includes(
      "premium collection"
    )
  ){
    return "Premium Collection";
  }


  if(
    text.includes(
      "poster collection"
    )
  ){
    return "Poster Collection";
  }


  if(
    text.includes(
      "tech sticker"
    )
  ){
    return "Tech Sticker Collection";
  }


  if(
    text.includes(
      "mini tin"
    )
  ){
    return "Mini Tin";
  }


  if(
    text.includes(
      "blister"
    )
  ){
    return "Blister";
  }


  if(
    text.includes(
      "battle deck"
    )
  ){
    return "Battle Deck";
  }


  if(
    text.includes(
      "tin"
    )
  ){
    return "Tin";
  }


  if(
    text.includes(
      "collection"
    )
  ){
    return "Collection";
  }


  if(
    text.includes(
      "booster pack"
    ) ||
    text.includes(
      "sleeved booster"
    )
  ){
    return "Booster Pack";
  }


  if(
    text.includes(
      "booster"
    )
  ){
    return "Booster Product";
  }


  return "Pokemon TCG";

}


/* ========================================
   SEALED POKEMON FILTER
======================================== */

function looksLikePokemonTCG(item){

  const text =
    normalize(
      [

        getItemName(item),

        item?.shortDescription,

        item?.description,

        item?.brand,

        item?.category

      ].join(" ")
    );


  if(
    !text.includes(
      "pokemon"
    )
  ){
    return false;
  }


  /*
    Things we do NOT want.
  */
  const blocked = [

    /\bpsa\s*[0-9]+\b/,

    /\bcgc\s*[0-9]+\b/,

    /\bbgs\s*[0-9]+\b/,

    /\bsgc\s*[0-9]+\b/,

    /\bgraded\b/,

    /\bsingle card\b/,

    /\bindividual card\b/,

    /\bproxy\b/,

    /\bcustom card\b/,

    /\bcard sleeve\b/,

    /\bdeck sleeve\b/,

    /\bplaymat\b/,

    /\btoploader\b/,

    /\btop loader\b/,

    /\bcard stand\b/,

    /\bstorage box\b/,

    /\bbinder pages\b/,

    /\bempty box\b/

  ];


  if(
    blocked.some(
      pattern =>
        pattern.test(text)
    )
  ){
    return false;
  }


  const sealedSignals = [

    "tcg",

    "trading card game",

    "trading cards",

    "booster",

    "elite trainer",

    "trainer box",

    "etb",

    "collection",

    "tin",

    "blister",

    "battle deck",

    "ex box",

    "premium box",

    "premium collection",

    "super premium",

    "poster",

    "bundle",

    "display box"

  ];


  return sealedSignals.some(
    signal =>
      text.includes(signal)
  );

}


/* ========================================
   VERIFIED MSRP
======================================== */

/*
  IMPORTANT:

  MSRP is NEVER taken from Walmart's live
  search result and is NEVER guessed.

  It must match a product already present
  in products.json with a verified MSRP.

  This prevents an arbitrary Walmart
  search/list price from being mistaken
  for MSRP.
*/

function getCatalogProductType(product){

  return normalize(
    product?.productType ||
    classifyProductType(
      [
        product?.name,
        product?.searchTerm
      ]
        .filter(Boolean)
        .join(" ")
    )
  );

}


function getCatalogSet(product){

  return normalize(
    product?.set ||
    classifySet(
      [
        product?.name,
        product?.searchTerm
      ]
        .filter(Boolean)
        .join(" ")
    )
  );

}


function meaningfulWords(value){

  const ignored =
    new Set([

      "pokemon",
      "tcg",
      "the",
      "and",
      "trading",
      "card",
      "game",
      "box",
      "collection"

    ]);


  return normalize(value)
    .split(" ")
    .filter(
      word =>
        word.length > 2 &&
        !ignored.has(word)
    );

}


function nameSimilarity(
  left,
  right
){

  const leftWords =
    meaningfulWords(left);

  const rightText =
    normalize(right);


  if(
    !leftWords.length ||
    !rightText
  ){
    return 0;
  }


  const matching =
    leftWords.filter(
      word =>
        rightText.includes(word)
    ).length;


  return (
    matching /
    leftWords.length
  );

}


function findVerifiedCatalogMatch(
  itemId,
  name,
  setName,
  productType
){

  const id =
    itemId
      ? String(itemId)
      : null;


  /*
    Strongest possible match:
    known Walmart item ID.
  */
  if(id){

    const idMatch =
      verifiedCatalog.find(
        product =>

          product.enabled !==
            false &&

          product.walmartItemId &&

          String(
            product.walmartItemId
          ) === id &&

          Number.isFinite(
            Number(
              product.msrp
            )
          )

      );


    if(idMatch){
      return idMatch;
    }

  }


  const normalizedName =
    normalize(name);

  const normalizedSet =
    normalize(setName);

  const normalizedType =
    normalize(productType);


  /*
    Exact verified product name /
    search term match.
  */
  const exact =
    verifiedCatalog.find(
      product => {

        if(
          product.enabled ===
          false
        ){
          return false;
        }


        const msrp =
          Number(
            product.msrp
          );


        if(
          !Number.isFinite(msrp) ||
          msrp <= 0
        ){
          return false;
        }


        return (

          normalize(
            product.name
          ) ===
            normalizedName

          ||

          normalize(
            product.searchTerm
          ) ===
            normalizedName

        );

      }
    );


  if(exact){
    return exact;
  }


  /*
    Careful fuzzy match.

    It MUST match both the known set
    and product type before MSRP can
    be inherited.
  */
  const candidates =
    verifiedCatalog.filter(
      product => {

        if(
          product.enabled ===
          false
        ){
          return false;
        }


        const msrp =
          Number(
            product.msrp
          );


        if(
          !Number.isFinite(msrp) ||
          msrp <= 0
        ){
          return false;
        }


        const catalogSet =
          getCatalogSet(
            product
          );


        const catalogType =
          getCatalogProductType(
            product
          );


        if(
          normalizedSet &&
          normalizedSet !==
            "other pokemon tcg" &&
          catalogSet !==
            normalizedSet
        ){
          return false;
        }


        if(
          normalizedType &&
          catalogType !==
            normalizedType
        ){
          return false;
        }


        const score =
          Math.max(

            nameSimilarity(
              product.name,
              name
            ),

            nameSimilarity(
              product.searchTerm,
              name
            )

          );


        return (
          score >=
          0.80
        );

      }
    );


  if(
    candidates.length ===
    1
  ){
    return candidates[0];
  }


  return null;

}


function getVerifiedMsrp(
  itemId,
  name,
  setName,
  productType
){

  const product =
    findVerifiedCatalogMatch(
      itemId,
      name,
      setName,
      productType
    );


  if(!product){
    return null;
  }


  const msrp =
    Number(
      product.msrp
    );


  if(
    !Number.isFinite(msrp) ||
    msrp <= 0
  ){
    return null;
  }


  return msrp;

}


/* ========================================
   PRICE RULE
======================================== */

function withinApprovedPrice(
  price,
  msrp
){

  const live =
    Number(price);

  const verified =
    Number(msrp);


  if(
    !Number.isFinite(live) ||
    live <= 0 ||
    !Number.isFinite(verified) ||
    verified <= 0
  ){
    return false;
  }


  const maximum =
    (
      verified *
      PRICE_MULTIPLIER
    ) +
    PRICE_CUSHION_DOLLARS;


  return (
    live <=
    maximum
  );

}


/* ========================================
   DATABASE
======================================== */

async function initializeDiscoveryDatabase(){

  await pool.query(`

    CREATE TABLE IF NOT EXISTS discovered_products (

      id SERIAL PRIMARY KEY,

      retailer TEXT NOT NULL,

      retailer_item_id TEXT NOT NULL,

      name TEXT NOT NULL,

      search_term TEXT,

      product_type TEXT,

      set_name TEXT,

      msrp NUMERIC,

      live_price NUMERIC,

      url TEXT,

      image TEXT,

      seller TEXT,

      raw_status TEXT,

      normalized_status TEXT,

      in_stock BOOLEAN NOT NULL DEFAULT FALSE,

      approved_marketplace BOOLEAN NOT NULL DEFAULT FALSE,

      display_eligible BOOLEAN NOT NULL DEFAULT FALSE,

      enabled BOOLEAN NOT NULL DEFAULT TRUE,

      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE(
        retailer,
        retailer_item_id
      )

    )

  `);


  await pool.query(`

    ALTER TABLE discovered_products
    ADD COLUMN IF NOT EXISTS
    live_price NUMERIC

  `);


  await pool.query(`

    ALTER TABLE discovered_products
    ADD COLUMN IF NOT EXISTS
    raw_status TEXT

  `);


  await pool.query(`

    ALTER TABLE discovered_products
    ADD COLUMN IF NOT EXISTS
    normalized_status TEXT

  `);


  await pool.query(`

    ALTER TABLE discovered_products
    ADD COLUMN IF NOT EXISTS
    in_stock BOOLEAN
    NOT NULL
    DEFAULT FALSE

  `);


  await pool.query(`

    ALTER TABLE discovered_products
    ADD COLUMN IF NOT EXISTS
    approved_marketplace BOOLEAN
    NOT NULL
    DEFAULT FALSE

  `);


  await pool.query(`

    ALTER TABLE discovered_products
    ADD COLUMN IF NOT EXISTS
    display_eligible BOOLEAN
    NOT NULL
    DEFAULT FALSE

  `);


  console.log(
    "Discovery database initialized."
  );

}


/* ========================================
   FETCH HELPER
======================================== */

async function fetchJson(
  url,
  options,
  timeoutMs,
  label
){

  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );


  try{

    const response =
      await fetch(
        url,
        {
          ...options,

          signal:
            controller.signal
        }
      );


    if(
      !response.ok
    ){

      const error =
        new Error(
          `${label} returned ${response.status}`
        );


      error.status =
        response.status;


      throw error;

    }


    return await response.json();


  }catch(error){

    if(
      error?.name ===
      "AbortError"
    ){

      throw new Error(
        `${label} request timed out`
      );

    }


    throw error;


  }finally{

    clearTimeout(
      timeout
    );

  }

}


/* ========================================
   HASDATA SEARCH
======================================== */

async function hasDataSearch(
  keyword,
  page=1
){

  if(
    !HASDATA_API_KEY
  ){

    throw new Error(
      "HASDATA_API_KEY is missing"
    );

  }


  const params =
    new URLSearchParams({

      q:
        keyword,

      domain:
        "walmart.com",

      language:
        "en",

      sort:
        "bestMatch",

      page:
        String(page),

      deliveryType:
        "shipping"

    });


  const data =
    await fetchJson(

      `https://api.hasdata.com/scrape/walmart/search?${params.toString()}`,

      {

        method:"GET",

        headers:{

          "x-api-key":
            HASDATA_API_KEY,

          "Content-Type":
            "application/json"

        }

      },

      HASDATA_TIMEOUT_MS,

      "HasData Walmart"

    );


  if(
    Array.isArray(
      data?.productResults
    )
  ){
    return data.productResults;
  }


  if(
    Array.isArray(
      data?.results
    )
  ){
    return data.results;
  }


  if(
    Array.isArray(
      data?.items
    )
  ){
    return data.items;
  }


  if(
    Array.isArray(
      data?.products
    )
  ){
    return data.products;
  }


  return [];

}


/* ========================================
   RAPIDAPI FALLBACK
======================================== */

async function rapidApiSearch(
  keyword,
  page=1
){

  if(
    !RAPIDAPI_KEY
  ){

    throw new Error(
      "WALMART_RAPIDAPI_KEY is missing"
    );

  }


  const params =
    new URLSearchParams({

      page:
        String(page),

      sort:
        "best_match",

      keyword

    });


  const data =
    await fetchJson(

      `https://${RAPIDAPI_HOST}/search?${params.toString()}`,

      {

        method:"GET",

        headers:{

          "x-rapidapi-key":
            RAPIDAPI_KEY,

          "x-rapidapi-host":
            RAPIDAPI_HOST

        }

      },

      RAPIDAPI_TIMEOUT_MS,

      "Walmart RapidAPI"

    );


  if(
    Array.isArray(
      data?.data?.results
    )
  ){
    return data.data.results;
  }


  if(
    Array.isArray(
      data?.results
    )
  ){
    return data.results;
  }


  if(
    Array.isArray(
      data?.items
    )
  ){
    return data.items;
  }


  if(
    Array.isArray(
      data?.products
    )
  ){
    return data.products;
  }


  if(
    Array.isArray(
      data?.data
    )
  ){
    return data.data;
  }


  return [];

}


/* ========================================
   PROVIDER SEARCH
======================================== */

async function searchProvider(
  keyword,
  page=1
){

  let hasDataError =
    null;


  /*
    HasData stays primary because your
    existing Walmart batch scans are
    successfully using HasData.
  */
  if(
    HASDATA_API_KEY
  ){

    try{

      const results =
        await hasDataSearch(
          keyword,
          page
        );


      return {

        source:
          "hasdata",

        results

      };


    }catch(error){

      hasDataError =
        error;


      console.error(
        `HasData discovery failed for "${keyword}" page ${page}:`,
        error.message
      );

    }

  }


  /*
    RapidAPI remains fallback only.
  */
  if(
    RAPIDAPI_KEY
  ){

    try{

      const results =
        await rapidApiSearch(
          keyword,
          page
        );


      return {

        source:
          "rapidapi",

        results

      };


    }catch(error){

      console.error(
        `RapidAPI discovery failed for "${keyword}" page ${page}:`,
        error.message
      );


      if(
        hasDataError
      ){
        throw hasDataError;
      }


      throw error;

    }

  }


  if(
    hasDataError
  ){
    throw hasDataError;
  }


  throw new Error(
    "No Walmart discovery provider is configured"
  );

}


/* ========================================
   NORMALIZE DISCOVERY RESULT
======================================== */

function normalizeDiscoveryItem(
  item,
  source
){

  const itemId =
    getItemId(item);

  const name =
    getItemName(item);

  const seller =
    getSellerName(item);

  const rawStatus =
    getAvailability(item);

  const status =
    normalizeAvailability(
      rawStatus
    );

  const price =
    getPrice(item);

  const url =
    getUrl(item);

  const setName =
    classifySet(name);

  const productType =
    classifyProductType(name);

  const msrp =
    getVerifiedMsrp(
      itemId,
      name,
      setName,
      productType
    );

  const approvedSeller =
    isApprovedSeller(
      seller
    );

  const available =
    isAvailableStatus(
      status
    );

  const priceApproved =
    withinApprovedPrice(
      price,
      msrp
    );

  const displayEligible =
    (
      looksLikePokemonTCG(
        item
      ) &&
      approvedSeller &&
      available &&
      price !== null &&
      Boolean(url) &&
      msrp !== null &&
      priceApproved
    );


  return {

    retailer:
      "walmart",

    retailerLabel:
      "Walmart",

    productId:
      itemId
        ? `walmart-auto-${itemId}`
        : null,

    walmartItemId:
      itemId
        ? String(itemId)
        : null,

    name,

    set:
      setName,

    productType,

    searchTerm:
      name,

    status,

    rawStatus,

    inStock:
      available,

    price,

    msrp,

    withinPriceRule:
      priceApproved,

    seller:
      seller ||
      "Unknown Seller",

    directSeller:
      isWalmartSeller(
        seller
      ),

    approvedMarketplace:
      isGTCollectiblesSeller(
        seller
      ),

    image:
      getImage(item),

    url,

    checkedAt:
      new Date()
        .toISOString(),

    source:
      `discovery-${source}`,

    discoveryOnly:
      true,

    autoDiscovered:
      true,

    displayEligible,

    /*
      Discovery itself never fires
      the alert.

      Your existing monitoring / alert
      paths remain responsible for
      notifications.
    */
    alertEligible:
      false

  };

}


/* ========================================
   SAVE DISCOVERED PRODUCT
======================================== */

async function saveDiscoveredProduct(
  item,
  source="unknown"
){

  const itemId =
    getItemId(item);


  if(
    !itemId
  ){

    return {

      saved:false,

      reason:
        "missing-item-id"

    };

  }


  if(
    !looksLikePokemonTCG(
      item
    )
  ){

    return {

      saved:false,

      reason:
        "not-sealed-pokemon-tcg"

    };

  }


  const seller =
    getSellerName(item);


  /*
    Completely reject sellers other than
    Walmart / GT Collectibles.
  */
  if(
    !isApprovedSeller(
      seller
    )
  ){

    return {

      saved:false,

      reason:
        "seller-not-approved"

    };

  }


  const normalized =
    normalizeDiscoveryItem(
      item,
      source
    );


  const result =
    await pool.query(

      `

      INSERT INTO discovered_products (

        retailer,

        retailer_item_id,

        name,

        search_term,

        product_type,

        set_name,

        msrp,

        live_price,

        url,

        image,

        seller,

        raw_status,

        normalized_status,

        in_stock,

        approved_marketplace,

        display_eligible,

        enabled,

        first_seen,

        last_seen

      )

      VALUES (

        'walmart',

        $1,

        $2,

        $3,

        $4,

        $5,

        $6,

        $7,

        $8,

        $9,

        $10,

        $11,

        $12,

        $13,

        $14,

        $15,

        TRUE,

        NOW(),

        NOW()

      )

      ON CONFLICT (
        retailer,
        retailer_item_id
      )

      DO UPDATE SET

        name =
          EXCLUDED.name,

        search_term =
          EXCLUDED.search_term,

        product_type =
          EXCLUDED.product_type,

        set_name =
          EXCLUDED.set_name,

        msrp =
          EXCLUDED.msrp,

        live_price =
          EXCLUDED.live_price,

        url =
          EXCLUDED.url,

        image =
          EXCLUDED.image,

        seller =
          EXCLUDED.seller,

        raw_status =
          EXCLUDED.raw_status,

        normalized_status =
          EXCLUDED.normalized_status,

        in_stock =
          EXCLUDED.in_stock,

        approved_marketplace =
          EXCLUDED.approved_marketplace,

        display_eligible =
          EXCLUDED.display_eligible,

        last_seen =
          NOW()

      RETURNING *

      `,

      [

        String(
          itemId
        ),

        normalized.name,

        normalized.name,

        normalized.productType,

        normalized.set,

        normalized.msrp,

        normalized.price,

        normalized.url,

        normalized.image,

        normalized.seller,

        normalized.rawStatus,

        normalized.status,

        normalized.inStock,

        normalized.approvedMarketplace,

        normalized.displayEligible

      ]

    );


  return {

    saved:true,

    displayEligible:
      normalized.displayEligible,

    product:
      result.rows[0]

  };

}


/* ========================================
   BROAD POKEMON SEARCH QUERIES
======================================== */

function buildDiscoveryQueries(){

  return [

    {
      keyword:
        "Pokemon TCG",
      pages:3
    },

    {
      keyword:
        "Pokemon trading cards",
      pages:2
    },

    {
      keyword:
        "Pokemon booster box",
      pages:2
    },

    {
      keyword:
        "Pokemon booster bundle",
      pages:2
    },

    {
      keyword:
        "Pokemon elite trainer box",
      pages:2
    },

    {
      keyword:
        "Pokemon super premium collection",
      pages:2
    },

    {
      keyword:
        "Pokemon premium collection",
      pages:2
    },

    {
      keyword:
        "Pokemon collection",
      pages:2
    },

    {
      keyword:
        "Pokemon tin",
      pages:2
    },

    {
      keyword:
        "Pokemon mini tin",
      pages:2
    },

    {
      keyword:
        "Pokemon blister",
      pages:2
    },

    {
      keyword:
        "Pokemon booster pack",
      pages:2
    },

    {
      keyword:
        "Pokemon Chaos Rising",
      pages:2
    },

    {
      keyword:
        "Pokemon 30th Anniversary",
      pages:2
    },

    {
      keyword:
        "Pokemon Prismatic Evolutions",
      pages:2
    },

    {
      keyword:
        "Pokemon Destined Rivals",
      pages:2
    },

    {
      keyword:
        "Pokemon Ascended Heroes",
      pages:2
    },

    {
      keyword:
        "Pokemon Delta Reign",
      pages:2
    }

  ];

}


/* ========================================
   WALMART DISCOVERY
======================================== */

async function discoverWalmartProducts(){

  const queries =
    buildDiscoveryQueries();


  let inspected =
    0;

  let saved =
    0;

  let displayEligible =
    0;

  let hiddenUnverified =
    0;

  let walmartDirect =
    0;

  let approvedMarketplace =
    0;

  let rejected =
    0;

  let searchesCompleted =
    0;

  let searchesFailed =
    0;


  const seenItemIds =
    new Set();


  for(
    const config
    of queries
  ){

    for(
      let page=1;
      page<=config.pages;
      page+=1
    ){

      try{

        const search =
          await searchProvider(
            config.keyword,
            page
          );


        const results =
          Array.isArray(
            search.results
          )
            ? search.results
            : [];


        console.log(
          `Discovery "${config.keyword}" page ${page} via ${search.source} returned ${results.length} results.`
        );


        searchesCompleted +=
          1;


        for(
          const item
          of results
        ){

          const itemId =
            getItemId(item);


          if(
            itemId &&
            seenItemIds.has(
              String(itemId)
            )
          ){
            continue;
          }


          if(itemId){

            seenItemIds.add(
              String(itemId)
            );

          }


          inspected +=
            1;


          const result =
            await saveDiscoveredProduct(
              item,
              search.source
            );


          if(
            !result.saved
          ){

            rejected +=
              1;

            continue;

          }


          saved +=
            1;


          if(
            result.displayEligible
          ){

            displayEligible +=
              1;

          }else{

            hiddenUnverified +=
              1;

          }


          const seller =
            getSellerName(item);


          if(
            isWalmartSeller(
              seller
            )
          ){

            walmartDirect +=
              1;

          }


          if(
            isGTCollectiblesSeller(
              seller
            )
          ){

            approvedMarketplace +=
              1;

          }

        }


      }catch(error){

        searchesFailed +=
          1;


        console.error(
          `Discovery search failed for "${config.keyword}" page ${page}:`,
          error.message
        );

      }

    }

  }


  console.log(
    `Filtered Walmart discovery finished. Inspected=${inspected}, saved=${saved}, visible=${displayEligible}, hidden-unverified=${hiddenUnverified}, rejected=${rejected}`
  );


  return {

    ok:true,

    mode:
      "all-pokemon-filtered",

    searchesCompleted,

    searchesFailed,

    inspected,

    saved,

    displayEligible,

    hiddenUnverified,

    walmartDirect,

    approvedMarketplace,

    rejected

  };

}


/* ========================================
   PRODUCTS EXPOSED TO APP / MONITOR
======================================== */

async function getDiscoveredProducts(){

  /*
    THIS QUERY IS THE IMPORTANT PART.

    We can discover lots of potential
    Pokémon listings internally, but the
    app only receives listings that have
    passed all of your standards.
  */

  const result =
    await pool.query(`

      SELECT *

      FROM discovered_products

      WHERE
        enabled = TRUE

      AND
        retailer = 'walmart'

      AND
        display_eligible = TRUE

      AND
        in_stock = TRUE

      AND
        live_price IS NOT NULL

      AND
        live_price > 0

      AND
        msrp IS NOT NULL

      AND
        msrp > 0

      AND
        url IS NOT NULL

      AND
        seller IS NOT NULL

      ORDER BY
        last_seen DESC

    `);


  return result.rows
    .filter(
      row =>
        isApprovedSeller(
          row.seller
        )
    )
    .filter(
      row =>
        withinApprovedPrice(
          row.live_price,
          row.msrp
        )
    )
    .map(
      row => {

        const seller =
          row.seller;


        return {

          id:
            `walmart-auto-${row.retailer_item_id}`,

          productId:
            `walmart-auto-${row.retailer_item_id}`,

          name:
            row.name,

          set:
            row.set_name ||
            "Pokemon TCG",

          productType:
            row.product_type ||
            "Pokemon TCG",

          searchTerm:
            row.search_term ||
            row.name,

          walmartItemId:
            row.retailer_item_id,

          retailers:[
            "walmart"
          ],

          retailer:
            "walmart",

          retailerLabel:
            "Walmart",

          channel:
            "online",

          msrp:
            Number(
              row.msrp
            ),

          price:
            Number(
              row.live_price
            ),

          discoveredPrice:
            Number(
              row.live_price
            ),

          seller,

          directSeller:
            isWalmartSeller(
              seller
            ),

          approvedMarketplace:
            isGTCollectiblesSeller(
              seller
            ),

          withinPriceRule:
            true,

          status:
            row.normalized_status ||
            "instock",

          rawStatus:
            row.raw_status ||
            "",

          inStock:
            row.in_stock ===
            true,

          image:
            row.image ||
            null,

          url:
            row.url,

          checkedAt:
            row.last_seen,

          autoDiscovered:
            true,

          discoveryOnly:
            true,

          displayEligible:
            true,

          /*
            Keep alert control with your
            existing scanner / approved
            marketplace alert paths.
          */
          alertEligible:
            false,

          enabled:
            row.enabled

        };

      }
    );

}


/* ========================================
   EXPORTS
======================================== */

module.exports = {

  initializeDiscoveryDatabase,

  discoverWalmartProducts,

  getDiscoveredProducts

};
