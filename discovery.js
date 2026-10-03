require("dotenv").config();

const { Pool } = require("pg");

const HOST =
  process.env.WALMART_RAPIDAPI_HOST ||
  "realtime-walmart-data.p.rapidapi.com";

const API_KEY =
  process.env.WALMART_RAPIDAPI_KEY;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


/*
  NORMALIZE TEXT
*/
function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


/*
  WALMART SELLER CHECK
*/
function isWalmartSeller(value) {
  const seller = normalize(value);

  return (
    seller === "walmart" ||
    seller === "walmart com"
  );
}


/*
  SELLER NAME
*/
function getSellerName(item) {
  if (item.sellerName) {
    return item.sellerName;
  }

  if (item.sellerDisplayName) {
    return item.sellerDisplayName;
  }

  if (typeof item.seller === "string") {
    return item.seller;
  }

  if (
    item.seller &&
    typeof item.seller === "object"
  ) {
    return item.seller.name || null;
  }

  return null;
}


/*
  ITEM ID
*/
function getItemId(item) {
  return (
    item.usItemId ||
    item.itemId ||
    item.id ||
    null
  );
}


/*
  IMAGE
*/
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


/*
  CREATE DATABASE TABLE
*/
async function initializeDiscoveryDatabase() {
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
      url TEXT,
      image TEXT,
      seller TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE(retailer, retailer_item_id)
    )
  `);

  console.log(
    "Discovery database initialized."
  );
}


/*
  WALMART API REQUEST
*/
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
      () => controller.abort(),
      15000
    );

  try {
    const response =
      await fetch(
        `https://${HOST}${path}`,
        {
          method: "GET",
          headers: {
            "x-rapidapi-key": API_KEY,
            "x-rapidapi-host": HOST
          },
          signal: controller.signal
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
      error.name === "AbortError"
    ) {
      throw new Error(
        "Walmart API request timed out"
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}


/*
  EXTRACT WALMART SEARCH RESULTS

  Diagnostic confirmed response shape:

  {
    status: ...,
    data: {
      results: [...]
    }
  }
*/
function extractSearchResults(data) {
  if (
    Array.isArray(
      data?.data?.results
    )
  ) {
    return data.data.results;
  }

  /*
    Keep fallbacks in case the API
    response changes later.
  */
  if (
    Array.isArray(data?.results)
  ) {
    return data.results;
  }

  if (
    Array.isArray(data?.items)
  ) {
    return data.items;
  }

  if (
    Array.isArray(data?.products)
  ) {
    return data.products;
  }

  return [];
}


/*
  POKEMON TCG FILTER
*/
function looksLikePokemonTCG(item) {
  const text =
    normalize(
      [
        item.name,
        item.title,
        item.shortDescription,
        item.description,
        item.brand
      ].join(" ")
    );

  return (
    text.includes("pokemon") &&
    (
      text.includes("tcg") ||
      text.includes("trading card") ||
      text.includes("booster") ||
      text.includes("trainer box") ||
      text.includes("collection") ||
      text.includes("tin") ||
      text.includes("elite trainer") ||
      text.includes("etb")
    )
  );
}


/*
  SAVE / UPDATE PRODUCT
*/
async function saveDiscoveredProduct(item) {
  const itemId =
    getItemId(item);

  if (!itemId) {
    return {
      saved: false,
      reason: "missing-item-id"
    };
  }

  const seller =
    getSellerName(item);

  if (!isWalmartSeller(seller)) {
    return {
      saved: false,
      reason: "not-walmart-direct"
    };
  }

  if (!looksLikePokemonTCG(item)) {
    return {
      saved: false,
      reason: "not-pokemon-tcg"
    };
  }

  const name =
    item.name ||
    item.title ||
    `Pokemon Walmart Item ${itemId}`;

  const url =
    item.canonicalUrl ||
    item.productUrl ||
    item.url ||
    `https://www.walmart.com/ip/${itemId}`;

  const image =
    getImage(item);

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
        url,
        image,
        seller,
        enabled,
        first_seen,
        last_seen
      )
      VALUES (
        'walmart',
        $1,
        $2,
        $3,
        NULL,
        NULL,
        NULL,
        $4,
        $5,
        'Walmart',
        TRUE,
        NOW(),
        NOW()
      )

      ON CONFLICT (
        retailer,
        retailer_item_id
      )

      DO UPDATE SET
        name = EXCLUDED.name,
        url = EXCLUDED.url,
        image = EXCLUDED.image,
        seller = EXCLUDED.seller,
        last_seen = NOW()

      RETURNING *
      `,
      [
        String(itemId),
        name,
        name,
        url,
        image
      ]
    );

  return {
    saved: true,
    product: result.rows[0]
  };
}


/*
  SEARCH WALMART
*/
async function discoverWalmartProducts() {
  const queries = [
    "Pokemon TCG",
    "Pokemon booster",
    "Pokemon Elite Trainer Box",
    "Pokemon collection",
    "Pokemon tin"
  ];

  let inspected = 0;
  let saved = 0;
  let walmartDirect = 0;
  let rejected = 0;
  let searchesCompleted = 0;
  let searchesFailed = 0;

  for (const keyword of queries) {
    const params =
      new URLSearchParams({
        page: "1",
        sort: "newest",
        keyword
      });

    try {
      const data =
        await apiRequest(
          `/search?${params.toString()}`
        );

      const results =
        extractSearchResults(data);

      console.log(
        `Discovery "${keyword}" returned ${results.length} results.`
      );

      searchesCompleted += 1;

      for (const item of results) {
        inspected += 1;

        const result =
          await saveDiscoveredProduct(
            item
          );

        if (result.saved) {
          saved += 1;
          walmartDirect += 1;
        } else {
          rejected += 1;
        }
      }

    } catch (error) {
      searchesFailed += 1;

      console.error(
        `Discovery search failed for "${keyword}":`,
        error.message
      );
    }
  }

  console.log(
    `Walmart discovery finished. Inspected=${inspected}, saved/updated=${saved}, rejected=${rejected}`
  );

  return {
    ok: true,
    searchesCompleted,
    searchesFailed,
    inspected,
    walmartDirect,
    saved,
    rejected
  };
}


/*
  LOAD DISCOVERED PRODUCTS
  INTO LIVE MONITOR FORMAT
*/
async function getDiscoveredProducts() {
  const result =
    await pool.query(`
      SELECT *
      FROM discovered_products
      WHERE enabled = TRUE
      AND retailer = 'walmart'
      ORDER BY first_seen ASC
    `);

  return result.rows.map(
    row => ({
      id:
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

      retailers: [
        "walmart"
      ],

      msrp:
        row.msrp == null
          ? null
          : Number(row.msrp),

      enabled:
        row.enabled
    })
  );
}


module.exports = {
  initializeDiscoveryDatabase,
  discoverWalmartProducts,
  getDiscoveredProducts
};
