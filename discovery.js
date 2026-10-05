require("dotenv").config();

const { Pool } = require("pg");


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
   ITEM HELPERS
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
            candidate.price ||
            candidate.value
          )
        : Number(candidate);


    if(
      Number.isFinite(value) &&
      value >= 0
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
      "unavailable"
    ) ||
    text.includes(
      "sold out"
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


  return (
    item?.canonicalUrl ||
    item?.productUrl ||
    item?.url ||
    item?.canonicalURL ||
    (
      itemId
        ? `https://www.walmart.com/ip/${itemId}`
        : null
    )
  );

}


/* ========================================
   SET CLASSIFICATION
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


/* ========================================
   PRODUCT TYPE CLASSIFICATION
======================================== */

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
      "premium collection"
    )
  ){
    return "Premium Collection";
  }


  if(
    text.includes(
      "collection box"
    )
  ){
    return "Collection Box";
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

  const name =
    getItemName(item);

  const text =
    normalize(
      [
        name,
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
    Exclude obvious singles,
    graded cards and accessories.
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

    /\bstorage box\b/

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

    "poster",

    "bundle",

    "box"

  ];


  return sealedSignals.some(
    signal =>
      text.includes(signal)
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


  console.log(
    "Discovery database initialized."
  );

}


/* ========================================
   GENERIC FETCH
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
      classifySet(name),

    productType:
      classifyProductType(name),

    searchTerm:
      name,

    status,

    rawStatus,

    inStock:
      isAvailableStatus(
        status
      ),

    price,

    msrp:
      null,

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

    url:
      getUrl(item),

    checkedAt:
      new Date()
        .toISOString(),

    source:
      `discovery-${source}`,

    discoveryOnly:
      true,

    autoDiscovered:
      true,

    /*
      This route does NOT create
      a restock alert by itself.

      Existing monitor rules remain
      responsible for qualification.
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


  const seller =
    getSellerName(item);


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

        NULL,

        $6,

        $7,

        $8,

        $9,

        $10,

        $11,

        $12,

        $13,

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

        normalized.price,

        normalized.url,

        normalized.image,

        normalized.seller,

        normalized.rawStatus,

        normalized.status,

        normalized.inStock,

        normalized.approvedMarketplace

      ]

    );


  return {

    saved:true,

    product:
      result.rows[0]

  };

}


/* ========================================
   ALL-POKEMON DISCOVERY SEARCH TERMS
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
        "Pokemon collection box",
      pages:2
    },

    {
      keyword:
        "Pokemon premium collection",
      pages:2
    },

    {
      keyword:
        "Pokemon tin",
      pages:2
    },

    {
      keyword:
        "Pokemon blister",
      pages:2
    },

    {
      keyword:
        "Pokemon battle deck",
      pages:2
    },

    {
      keyword:
        "Pokemon booster pack",
      pages:2
    },

    /*
      Keep known / upcoming sets too,
      but these are no longer the only
      things being discovered.
    */

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
   AUTOMATIC WALMART DISCOVERY
======================================== */

async function discoverWalmartProducts(){

  const queries =
    buildDiscoveryQueries();


  let inspected =
    0;

  let saved =
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


          if(
            itemId
          ){
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
            result.saved
          ){

            saved +=
              1;


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


          }else{

            rejected +=
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
    `All-Pokemon Walmart discovery finished. Inspected=${inspected}, saved/updated=${saved}, rejected=${rejected}`
  );


  return {

    ok:true,

    mode:
      "all-pokemon-tcg",

    searchesCompleted,

    searchesFailed,

    inspected,

    walmartDirect,

    approvedMarketplace,

    saved,

    rejected

  };

}


/* ========================================
   LOAD DISCOVERED PRODUCTS
======================================== */

async function getDiscoveredProducts(){

  const result =
    await pool.query(`

      SELECT *

      FROM discovered_products

      WHERE enabled = TRUE

      AND retailer = 'walmart'

      ORDER BY last_seen DESC

    `);


  return result.rows.map(
    row => {

      const seller =
        row.seller ||
        "Unknown Seller";


      const approved =
        row.approved_marketplace ===
        true ||
        isGTCollectiblesSeller(
          seller
        );


      return {

        id:
          `walmart-auto-${row.retailer_item_id}`,

        productId:
          `walmart-auto-${row.retailer_item_id}`,

        name:
          row.name,

        set:
          row.set_name ||
          "Auto Discovered",

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
          row.msrp == null
            ? null
            : Number(
                row.msrp
              ),

        price:
          row.live_price == null
            ? null
            : Number(
                row.live_price
              ),

        discoveredPrice:
          row.live_price == null
            ? null
            : Number(
                row.live_price
              ),

        seller,

        directSeller:
          isWalmartSeller(
            seller
          ),

        approvedMarketplace:
          approved,

        status:
          row.normalized_status ||
          "discovered",

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
          row.url ||
          (
            row.retailer_item_id
              ? `https://www.walmart.com/ip/${row.retailer_item_id}`
              : null
          ),

        checkedAt:
          row.last_seen,

        /*
          This tells monitor.js to fail
          closed when MSRP is unknown.
          Existing alert qualification
          remains unchanged.
        */
        autoDiscovered:
          true,

        discoveryOnly:
          true,

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
