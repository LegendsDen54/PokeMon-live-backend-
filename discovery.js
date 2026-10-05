require("dotenv").config();

const { Pool } = require("pg");

const HOST =
  process.env.WALMART_RAPIDAPI_HOST ||
  "realtime-walmart-data.p.rapidapi.com";

const API_KEY =
  process.env.WALMART_RAPIDAPI_KEY;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  }
});


/* ========================================
   NORMALIZE
======================================== */

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


/* ========================================
   WALMART SELLER
======================================== */

function isWalmartSeller(value) {
  const seller =
    normalize(value);

  return (
    seller === "walmart" ||
    seller === "walmart com"
  );
}


function getSellerName(item) {
  if (item.sellerName) {
    return item.sellerName;
  }

  if (item.sellerDisplayName) {
    return item.sellerDisplayName;
  }

  if (
    typeof item.seller === "string"
  ) {
    return item.seller;
  }

  if (
    item.seller &&
    typeof item.seller === "object"
  ) {
    return (
      item.seller.name ||
      null
    );
  }

  return null;
}


/* ========================================
   ITEM HELPERS
======================================== */

function getItemId(item) {
  return (
    item.usItemId ||
    item.itemId ||
    item.id ||
    null
  );
}


function getImage(item) {
  if (
    Array.isArray(item.images) &&
    item.images.length > 0
  ) {
    const first =
      item.images[0];

    if (
      first &&
      typeof first === "object"
    ) {
      return (
        first.url ||
        first.imageUrl ||
        null
      );
    }

    return first;
  }

  return (
    item.image ||
    item.imageUrl ||
    item.thumbnailUrl ||
    null
  );
}


function getPrice(item) {
  const candidates = [
    item.price,
    item.currentPrice,
    item.salePrice,
    item?.priceDetails
      ?.currentPrice
      ?.price
  ];

  for (
    const candidate
    of candidates
  ) {
    if (
      candidate !== null &&
      candidate !== undefined &&
      candidate !== ""
    ) {
      const value =
        Number(candidate);

      if (
        Number.isFinite(value) &&
        value >= 0
      ) {
        return value;
      }
    }
  }

  return null;
}


/* ========================================
   CLASSIFY SET
======================================== */

function classifySet(name) {
  const text =
    normalize(name);

  if (
    text.includes(
      "30th anniversary"
    ) ||
    text.includes(
      "30th"
    )
  ) {
    return "Pokemon 30th Anniversary";
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
   CLASSIFY PRODUCT TYPE
======================================== */

function classifyProductType(name) {
  const text =
    normalize(name);

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
    text.includes("tin")
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
      "booster"
    )
  ) {
    return "Booster Product";
  }

  return "Pokemon TCG";
}


/* ========================================
   POKEMON TCG FILTER
======================================== */

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
      text.includes(
        "trading card"
      ) ||
      text.includes(
        "booster"
      ) ||
      text.includes(
        "trainer box"
      ) ||
      text.includes(
        "collection"
      ) ||
      text.includes("tin") ||
      text.includes(
        "elite trainer"
      ) ||
      text.includes("etb")
    )
  );
}


/* ========================================
   DATABASE
======================================== */

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
      live_price NUMERIC,
      url TEXT,
      image TEXT,
      seller TEXT,
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

  console.log(
    "Discovery database initialized."
  );
}


/* ========================================
   WALMART API REQUEST
======================================== */

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
      () =>
        controller.abort(),
      15000
    );

  try {
    const response =
      await fetch(
        `https://${HOST}${path}`,
        {
          method: "GET",

          headers: {
            "x-rapidapi-key":
              API_KEY,

            "x-rapidapi-host":
              HOST
          },

          signal:
            controller.signal
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
      error.name ===
        "AbortError"
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


/* ========================================
   EXTRACT SEARCH RESULTS
======================================== */

function extractSearchResults(data) {
  if (
    Array.isArray(
      data?.data?.results
    )
  ) {
    return data.data.results;
  }

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

  return [];
}


/* ========================================
   SAVE / UPDATE DISCOVERED PRODUCT
======================================== */

async function saveDiscoveredProduct(
  item
) {
  const itemId =
    getItemId(item);

  if (!itemId) {
    return {
      saved: false,
      reason:
        "missing-item-id"
    };
  }

  const seller =
    getSellerName(item);

  if (
    !isWalmartSeller(seller)
  ) {
    return {
      saved: false,
      reason:
        "not-walmart-direct"
    };
  }

  if (
    !looksLikePokemonTCG(item)
  ) {
    return {
      saved: false,
      reason:
        "not-pokemon-tcg"
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

  const livePrice =
    getPrice(item);

  const setName =
    classifySet(name);

  const productType =
    classifyProductType(name);

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

        last_seen =
          NOW()

      RETURNING *
      `,
      [
        String(itemId),
        name,
        name,
        productType,
        setName,
        livePrice,
        url,
        image
      ]
    );

  return {
    saved: true,
    product:
      result.rows[0]
  };
}


/* ========================================
   WALMART DISCOVERY
======================================== */

async function discoverWalmartProducts() {

  const queries = [
    "Pokemon 30th Anniversary",
    "Pokemon Prismatic Evolutions",
    "Pokemon Destined Rivals",
    "Pokemon Ascended Heroes",
    "Pokemon Delta Reign",
    "Pokemon Elite Trainer Box",
    "Pokemon booster bundle",
    "Pokemon collection",
    "Pokemon tin"
  ];

  let inspected = 0;
  let saved = 0;
  let walmartDirect = 0;
  let rejected = 0;
  let searchesCompleted = 0;
  let searchesFailed = 0;

  const seenItemIds =
    new Set();

  for (
    const keyword
    of queries
  ) {
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
        extractSearchResults(
          data
        );

      console.log(
        `Discovery "${keyword}" returned ${results.length} results.`
      );

      searchesCompleted += 1;

      for (
        const item
        of results
      ) {
        const itemId =
          getItemId(item);

        if (
          itemId &&
          seenItemIds.has(
            String(itemId)
          )
        ) {
          continue;
        }

        if (itemId) {
          seenItemIds.add(
            String(itemId)
          );
        }

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


/* ========================================
   LOAD DISCOVERED PRODUCTS
======================================== */

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
          : Number(
              row.msrp
            ),

      discoveredPrice:
        row.live_price == null
          ? null
          : Number(
              row.live_price
            ),

      autoDiscovered: true,

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
