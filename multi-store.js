const RETAILERS = {
  walmart: {
    label: "Walmart"
  },

  target: {
    label: "Target",
    feedEnv: "TARGET_FEED_URL",
    keyEnv: "TARGET_API_KEY",
    pollEnv: "TARGET_POLL_SECONDS"
  },

  sams: {
    label: "Sam's Club",
    feedEnv: "SAMS_FEED_URL",
    keyEnv: "SAMS_API_KEY",
    pollEnv: "SAMS_POLL_SECONDS"
  },

  bestbuy: {
    label: "Best Buy",
    feedEnv: "BESTBUY_FEED_URL",
    keyEnv: "BESTBUY_API_KEY",
    pollEnv: "BESTBUY_POLL_SECONDS"
  },

  costco: {
    label: "Costco",
    feedEnv: "COSTCO_FEED_URL",
    keyEnv: "COSTCO_API_KEY",
    pollEnv: "COSTCO_POLL_SECONDS"
  }
};

const BESTBUY_API_BASE =
  "https://api.bestbuy.com/v1";

const BESTBUY_API_KEY =
  process.env.BESTBUY_API_KEY || "";

const BESTBUY_POSTAL_CODE =
  String(
    process.env.BESTBUY_POSTAL_CODE || ""
  ).trim();

const BESTBUY_RADIUS_MILES =
  Math.max(
    1,
    Math.min(
      75,
      Number(
        process.env.BESTBUY_RADIUS_MILES || 75
      )
    )
  );

const BESTBUY_MAX_STORE_SKUS =
  Math.max(
    1,
    Math.min(
      40,
      Number(
        process.env.BESTBUY_MAX_STORE_SKUS || 25
      )
    )
  );

const BESTBUY_REQUEST_TIMEOUT_MS =
  Math.max(
    5000,
    Number(
      process.env.BESTBUY_REQUEST_TIMEOUT_MS || 12000
    )
  );

const BESTBUY_STORE_REQUEST_DELAY_MS =
  Math.max(
    210,
    Number(
      process.env.BESTBUY_STORE_REQUEST_DELAY_MS || 225
    )
  );

const states = Object.fromEntries(
  Object.entries(RETAILERS).map(
    ([retailer, config]) => [
      retailer,
      {
        retailer,
        label: config.label,

        configured:
          retailer === "walmart"
            ? Boolean(
                process.env.WALMART_RAPIDAPI_KEY ||
                process.env.HASDATA_API_KEY
              )
            : retailer === "bestbuy"
              ? Boolean(
                  BESTBUY_API_KEY ||
                  process.env.BESTBUY_FEED_URL
                )
              : Boolean(
                  process.env[config.feedEnv]
                ),

        running: false,
        lastRun: null,
        lastSuccess: null,
        error: null,
        items: []
      }
    ]
  )
);

let walmartStateGetter = null;

const timers = new Map();

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pok[eé]mon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStatus(
  value,
  inStock
) {
  const text =
    normalizeText(value);

  if (
    /(pre order|preorder|raffle|scheduled drop|coming soon)/
      .test(text)
  ) {
    return "preorder";
  }

  if (
    /(out of stock|unavailable|sold out|not available)/
      .test(text)
  ) {
    return "out";
  }

  if (
    /(on hand)/
      .test(text)
  ) {
    return "onhand";
  }

  if (
    /(transit|in transit)/
      .test(text)
  ) {
    return "transit";
  }

  if (
    /(ordered|order placed|incoming order)/
      .test(text)
  ) {
    return "ordered";
  }

  if (
    /(in stock|instock|available|live|ready)/
      .test(text)
  ) {
    return "instock";
  }

  return inStock === true
    ? "instock"
    : "out";
}

function retailerSellerMatch(
  retailer,
  seller
) {
  if (!seller) {
    return false;
  }

  const left =
    String(seller)
      .toLowerCase()
      .replace(
        /[^a-z0-9]/g,
        ""
      );

  const right =
    RETAILERS[retailer]
      .label
      .toLowerCase()
      .replace(
        /[^a-z0-9]/g,
        ""
      );

  return (
    left === right ||

    (
      retailer === "sams" &&
      [
        "samsclub",
        "samclub",
        "sams"
      ].includes(left)
    ) ||

    (
      retailer === "bestbuy" &&
      [
        "bestbuy",
        "bestbuycom"
      ].includes(left)
    )
  );
}

function normalizeItem(
  retailer,
  raw = {}
) {
  const config =
    RETAILERS[retailer];

  const rawStatus =
    raw.rawStatus ??
    raw.status ??
    raw.inventoryStatus ??
    raw.availability ??
    raw.stockStatus ??
    "";

  const status =
    normalizeStatus(
      rawStatus,
      raw.inStock
    );

  let channel =
    String(
      raw.channel ||
      (
        raw.storeId ||
        raw.storeName
          ? "store"
          : "online"
      )
    )
      .toLowerCase() === "store"
      ? "store"
      : "online";

  /*
    TARGET IS ONLINE ONLY.
    Any Target feed item that claims to be store inventory
    is forced back to online and loses store metadata.
  */
  if (
    retailer === "target"
  ) {
    channel = "online";
  }

  const seller =
    raw.seller ??
    raw.sellerName ??
    null;

  const directSeller =
    raw.directSeller === true ||
    retailerSellerMatch(
      retailer,
      seller
    );

  const productId =
    raw.productId ??
    raw.id ??
    raw.sku ??
    raw.itemId ??
    raw.upc ??
    raw.walmartItemId ??
    null;

  return {
    retailer,

    retailerLabel:
      config.label,

    productId:
      productId == null
        ? null
        : String(productId),

    sku:
      raw.sku == null
        ? (
            productId == null
              ? null
              : String(productId)
          )
        : String(raw.sku),

    name:
      String(
        raw.name ??
        raw.title ??
        "Pokémon product"
      ),

    channel,

    storeId:
      retailer === "target"
        ? null
        : (
            channel === "store" &&
            raw.storeId != null
              ? String(raw.storeId)
              : null
          ),

    storeName:
      retailer === "target"
        ? null
        : (
            channel === "store"
              ? (
                  raw.storeName ??
                  raw.location ??
                  null
                )
              : null
          ),

    storeAddress:
      retailer === "target" ||
      channel !== "store"
        ? null
        : (
            raw.storeAddress ??
            raw.address ??
            null
          ),

    storeCity:
      retailer === "target" ||
      channel !== "store"
        ? null
        : (
            raw.storeCity ??
            raw.city ??
            null
          ),

    storeState:
      retailer === "target" ||
      channel !== "store"
        ? null
        : (
            raw.storeState ??
            raw.state ??
            raw.region ??
            null
          ),

    storePostalCode:
      retailer === "target" ||
      channel !== "store"
        ? null
        : (
            raw.storePostalCode ??
            raw.postalCode ??
            null
          ),

    distanceMiles:
      channel === "store"
        ? toNumber(
            raw.distanceMiles ??
            raw.distance
          )
        : null,

    lowStock:
      raw.lowStock === true,

    status,

    quantity:
      toNumber(
        raw.quantity ??
        raw.qty ??
        raw.onHandQuantity
      ),

    price:
      toNumber(
        raw.price ??
        raw.currentPrice ??
        raw.salePrice ??
        raw.regularPrice
      ),

    msrp:
      toNumber(
        raw.msrp
      ),

    seller,

    directSeller,

    inStock:
      status === "instock" ||
      status === "onhand",

    image:
      raw.image ??
      raw.imageUrl ??
      raw.thumbnailUrl ??
      null,

    url:
      raw.url ??
      raw.productUrl ??
      raw.canonicalUrl ??
      null,

    checkedAt:
      raw.checkedAt ??
      new Date()
        .toISOString(),

    rawStatus:
      rawStatus
        ? String(rawStatus)
        : "",

    source:
      raw.source ??
      `${retailer}-external-feed`,

    withinPriceRule:
      raw.withinPriceRule,

    error:
      raw.error ??
      null
  };
}

function syncWalmartState() {
  const state =
    states.walmart;

  if (
    !walmartStateGetter
  ) {
    return state;
  }

  const data =
    walmartStateGetter() ||
    {
      items: []
    };

  state.configured =
    Boolean(
      process.env
        .WALMART_RAPIDAPI_KEY ||
      process.env
        .HASDATA_API_KEY
    );

  state.running =
    Boolean(
      data.running
    );

  state.lastRun =
    data.lastRun ||
    state.lastRun;

  if (
    data.lastRun
  ) {
    state.lastSuccess =
      data.lastRun;
  }

  state.error =
    null;

  state.items =
    (
      Array.isArray(
        data.items
      )
        ? data.items
        : []
    )
      .filter(
        item =>
          item.retailer ===
            "walmart" &&

          item.directSeller ===
            true &&

          item.withinPriceRule !==
            false
      )
      .map(
        item =>
          normalizeItem(
            "walmart",
            {
              ...item,

              seller:
                item.seller ||
                "Walmart",

              directSeller:
                true
            }
          )
      );

  return state;
}

function extractFeedItems(
  payload
) {
  if (
    Array.isArray(
      payload
    )
  ) {
    return payload;
  }

  for (
    const key
    of [
      "items",
      "products",
      "results",
      "inventory",
      "data"
    ]
  ) {
    if (
      Array.isArray(
        payload?.[key]
      )
    ) {
      return payload[key];
    }
  }

  if (
    Array.isArray(
      payload?.data?.items
    )
  ) {
    return (
      payload.data.items
    );
  }

  return [];
}

function pollSecondsFor(
  retailer
) {
  const config =
    RETAILERS[retailer];

  const raw =
    Number(
      process.env[
        config.pollEnv
      ] ||
      60
    );

  return Number.isFinite(raw)
    ? Math.max(
        60,
        raw
      )
    : 60;
}

async function fetchJson(
  url,
  options = {},
  timeoutMs = 15000,
  label = "External API"
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
      const error =
        new Error(
          `${label} returned HTTP ${response.status}`
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
      throw new Error(
        `${label} timed out after ${timeoutMs}ms`
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
   BEST BUY HELPERS
======================================== */

function isPokemonTcgName(value) {
  const text =
    normalizeText(value);

  if (
    !text.includes(
      "pokemon"
    )
  ) {
    return false;
  }

  const excluded = [
    "video game",
    "nintendo switch",
    "plush",
    "shirt",
    "hoodie",
    "figure",
    "figurine",
    "toy",
    "funko",
    "headset",
    "controller",
    "case",
    "backpack",
    "poster wall art",
    "single card",
    "graded card",
    "psa ",
    "cgc ",
    "bgs "
  ];

  if (
    excluded.some(
      word =>
        text.includes(word)
    )
  ) {
    return false;
  }

  const sealedSignals = [
    "trading card",
    "tcg",
    "elite trainer",
    "booster",
    "bundle",
    "collection",
    "box",
    "tin",
    "blister",
    "deck"
  ];

  return sealedSignals.some(
    word =>
      text.includes(word)
  );
}

function bestBuyOrderableStatus(
  product
) {
  const orderable =
    normalizeText(
      product?.orderable
    );

  if (
    orderable.includes(
      "preordernow"
    ) ||
    orderable.includes(
      "preorder now"
    ) ||
    orderable.includes(
      "comingsoon"
    ) ||
    orderable.includes(
      "coming soon"
    )
  ) {
    return "preorder";
  }

  if (
    product?.onlineAvailability ===
      true ||
    orderable === "available"
  ) {
    return "instock";
  }

  return "out";
}

function normalizeBestBuyOnline(
  product
) {
  const status =
    bestBuyOrderableStatus(
      product
    );

  const price =
    toNumber(
      product?.salePrice ??
      product?.regularPrice
    );

  return normalizeItem(
    "bestbuy",
    {
      productId:
        product?.sku,

      sku:
        product?.sku,

      name:
        product?.name ||
        "Pokémon product",

      channel:
        "online",

      status,

      inStock:
        status ===
        "instock",

      price,

      seller:
        "Best Buy",

      directSeller:
        true,

      image:
        product?.image ||
        product?.largeFrontImage ||
        product?.mediumImage ||
        null,

      url:
        product?.url ||
        product?.addToCartUrl ||
        (
          product?.sku
            ? `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(product.name || product.sku)}`
            : null
        ),

      checkedAt:
        new Date()
          .toISOString(),

      source:
        "bestbuy-products-api"
    }
  );
}

function normalizeBestBuyStore(
  product,
  store
) {
  const storeId =
    store?.storeID ??
    store?.storeId ??
    null;

  const storeName =
    store?.name ||
    [
      store?.city,
      store?.state
    ]
      .filter(Boolean)
      .join(", ") ||
    (
      storeId
        ? `Best Buy Store ${storeId}`
        : "Best Buy Store"
    );

  return normalizeItem(
    "bestbuy",
    {
      productId:
        product?.sku,

      sku:
        product?.sku,

      name:
        product?.name ||
        "Pokémon product",

      channel:
        "store",

      storeId,

      storeName,

      storeAddress:
        store?.address ??
        null,

      storeCity:
        store?.city ??
        null,

      storeState:
        store?.state ??
        store?.region ??
        null,

      storePostalCode:
        store?.postalCode ??
        null,

      distanceMiles:
        store?.distance ??
        null,

      lowStock:
        store?.lowStock === true,

      status:
        "instock",

      inStock:
        true,

      /*
        The public Best Buy Store Availability API exposes
        availability and low-stock state, not a verified unit count.
        Keep this null unless a separately authorized feed supplies it.
      */
      quantity: null,

      price:
        product?.salePrice ??
        product?.regularPrice ??
        null,

      seller:
        "Best Buy",

      directSeller:
        true,

      image:
        product?.image ||
        product?.largeFrontImage ||
        product?.mediumImage ||
        null,

      url:
        product?.url ||
        (
          product?.sku
            ? `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(product.name || product.sku)}`
            : null
        ),

      checkedAt:
        new Date()
          .toISOString(),

      source:
        "bestbuy-store-availability-api",

      rawStatus:
        store?.lowStock === true
          ? "Low stock"
          : "In stock"
    }
  );
}

async function searchBestBuyPokemon() {
  if (
    !BESTBUY_API_KEY
  ) {
    return [];
  }

  const show =
    [
      "sku",
      "name",
      "salePrice",
      "regularPrice",
      "onlineAvailability",
      "inStoreAvailability",
      "inStorePickup",
      "orderable",
      "url",
      "addToCartUrl",
      "image",
      "largeFrontImage",
      "mediumImage"
    ].join(",");

  const url =
    `${BESTBUY_API_BASE}` +
    `/products(search=pokemon)` +
    `?format=json` +
    `&pageSize=100` +
    `&show=${encodeURIComponent(show)}` +
    `&apiKey=${encodeURIComponent(BESTBUY_API_KEY)}`;

  const payload =
    await fetchJson(
      url,
      {
        headers: {
          accept:
            "application/json"
        }
      },
      BESTBUY_REQUEST_TIMEOUT_MS,
      "Best Buy Products API"
    );

  const products =
    Array.isArray(
      payload?.products
    )
      ? payload.products
      : [];

  return products.filter(
    product =>
      isPokemonTcgName(
        product?.name
      )
  );
}

async function getBestBuyStoreAvailability(
  product
) {
  if (
    !BESTBUY_API_KEY ||
    !BESTBUY_POSTAL_CODE ||
    !product?.sku
  ) {
    return [];
  }

  const params =
    new URLSearchParams({
      postalCode:
        BESTBUY_POSTAL_CODE,

      apiKey:
        BESTBUY_API_KEY
    });

  const url =
    `${BESTBUY_API_BASE}` +
    `/products/${encodeURIComponent(product.sku)}` +
    `/stores.json?${params.toString()}`;

  const payload =
    await fetchJson(
      url,
      {
        headers: {
          accept:
            "application/json"
        }
      },
      BESTBUY_REQUEST_TIMEOUT_MS,
      "Best Buy Store Availability API"
    );

  const stores =
    Array.isArray(
      payload?.stores
    )
      ? payload.stores
      : [];

  /*
    Best Buy's store availability endpoint returns
    stores where that SKU is currently available.
  */
  return stores.map(
    store =>
      normalizeBestBuyStore(
        product,
        store
      )
  ).filter(
    item =>
      Number.isFinite(
        Number(item.distanceMiles)
      ) &&
      Number(item.distanceMiles) <=
        BESTBUY_RADIUS_MILES
  );
}

async function pollBestBuy() {
  const state =
    states.bestbuy;

  state.configured =
    Boolean(
      BESTBUY_API_KEY ||
      process.env
        .BESTBUY_FEED_URL
    );

  if (
    !BESTBUY_API_KEY
  ) {
    /*
      If no official API key is configured yet,
      preserve the old external-feed fallback.
    */
    if (
      process.env
        .BESTBUY_FEED_URL
    ) {
      return pollGenericExternal(
        "bestbuy"
      );
    }

    state.running =
      false;

    state.items =
      [];

    state.error =
      null;

    return state;
  }

  state.running =
    true;

  state.lastRun =
    new Date()
      .toISOString();

  try {
    const products =
      await searchBestBuyPokemon();

    const items = [];

    for (
      const product
      of products
    ) {
      /*
        ONLINE CARD
      */
      items.push(
        normalizeBestBuyOnline(
          product
        )
      );
    }

    /*
      STORE INVENTORY

      Only runs when BESTBUY_POSTAL_CODE exists.
      We also cap SKU checks to keep API usage sane.
    */
    if (
      BESTBUY_POSTAL_CODE
    ) {
      const storeCandidates =
        products
          .filter(
            product =>
              product
                ?.inStoreAvailability ===
                true ||
              product
                ?.inStorePickup ===
                true
          )
          .slice(
            0,
            BESTBUY_MAX_STORE_SKUS
          );

      for (
        let index = 0;
        index <
          storeCandidates.length;
        index += 1
      ) {
        const product =
          storeCandidates[index];

        try {
          const storeItems =
            await getBestBuyStoreAvailability(
              product
            );

          items.push(
            ...storeItems
          );

        } catch (error) {
          console.error(
            `Best Buy store lookup failed for SKU ${product?.sku}:`,
            error.message
          );
        }

        if (
          index <
          storeCandidates.length -
            1
        ) {
          await sleep(
            BESTBUY_STORE_REQUEST_DELAY_MS
          );
        }
      }
    }

    state.items =
      items;

    state.lastSuccess =
      new Date()
        .toISOString();

    state.error =
      null;

  } catch (error) {
    state.error =
      error?.message ||
      String(error);

  } finally {
    state.running =
      false;
  }

  return state;
}

/* ========================================
   GENERIC TARGET / SAMS / COSTCO FEEDS
======================================== */

async function pollGenericExternal(
  retailer
) {
  const config =
    RETAILERS[retailer];

  const state =
    states[retailer];

  const feedUrl =
    process.env[
      config.feedEnv
    ];

  state.configured =
    Boolean(
      feedUrl
    );

  if (
    !feedUrl
  ) {
    state.running =
      false;

    state.items =
      [];

    state.error =
      null;

    return state;
  }

  state.running =
    true;

  state.lastRun =
    new Date()
      .toISOString();

  try {
    const headers = {
      accept:
        "application/json"
    };

    const apiKey =
      process.env[
        config.keyEnv
      ];

    if (
      apiKey
    ) {
      headers.authorization =
        `Bearer ${apiKey}`;

      headers[
        "x-api-key"
      ] =
        apiKey;
    }

    const payload =
      await fetchJson(
        feedUrl,
        {
          headers
        },
        15000,
        `${config.label} feed`
      );

    let items =
      extractFeedItems(
        payload
      ).map(
        item =>
          normalizeItem(
            retailer,
            item
          )
      );

    /*
      TARGET = ONLINE ONLY.
      Store inventory is discarded completely.
    */
    if (
      retailer === "target"
    ) {
      items =
        items.filter(
          item =>
            item.channel ===
            "online"
        );
    }

    state.items =
      items;

    state.lastSuccess =
      new Date()
        .toISOString();

    state.error =
      null;

  } catch (error) {
    state.error =
      error?.message ||
      String(error);

  } finally {
    state.running =
      false;
  }

  return state;
}

async function pollExternal(
  retailer
) {
  if (
    retailer === "bestbuy"
  ) {
    return pollBestBuy();
  }

  return pollGenericExternal(
    retailer
  );
}

async function pollConfiguredProviders() {
  const providers =
    Object.keys(
      RETAILERS
    ).filter(
      retailer => {
        if (
          retailer ===
          "walmart"
        ) {
          return false;
        }

        if (
          retailer ===
          "bestbuy"
        ) {
          return Boolean(
            BESTBUY_API_KEY ||
            process.env
              .BESTBUY_FEED_URL
          );
        }

        const config =
          RETAILERS[
            retailer
          ];

        return Boolean(
          process.env[
            config.feedEnv
          ]
        );
      }
    );

  return Promise.allSettled(
    providers.map(
      retailer =>
        pollExternal(
          retailer
        )
    )
  );
}

function start(
  options = {}
) {
  if (
    typeof options
      .getWalmartState ===
      "function"
  ) {
    walmartStateGetter =
      options
        .getWalmartState;
  }

  syncWalmartState();

  for (
    const retailer
    of Object.keys(
      RETAILERS
    )
  ) {
    if (
      retailer ===
      "walmart"
    ) {
      continue;
    }

    const state =
      states[
        retailer
      ];

    const config =
      RETAILERS[
        retailer
      ];

    if (
      retailer ===
      "bestbuy"
    ) {
      state.configured =
        Boolean(
          BESTBUY_API_KEY ||
          process.env
            .BESTBUY_FEED_URL
        );
    } else {
      state.configured =
        Boolean(
          process.env[
            config.feedEnv
          ]
        );
    }

    if (
      !state.configured ||
      timers.has(
        retailer
      )
    ) {
      continue;
    }

    const seconds =
      pollSecondsFor(
        retailer
      );

    timers.set(
      retailer,

      setInterval(
        () => {
          pollExternal(
            retailer
          ).catch(
            error => {
              state.error =
                error?.message ||
                String(error);

              state.running =
                false;
            }
          );
        },

        seconds *
          1000
      )
    );
  }

  return (
    pollConfiguredProviders()
  );
}

function getProviderStates() {
  syncWalmartState();

  return Object
    .values(
      states
    )
    .map(
      state => ({
        retailer:
          state.retailer,

        label:
          state.label,

        configured:
          state.configured,

        running:
          state.running,

        lastRun:
          state.lastRun,

        lastSuccess:
          state.lastSuccess,

        error:
          state.error,

        itemCount:
          state.items.length,

        onlineCount:
          state.items.filter(
            item =>
              item.channel ===
              "online"
          ).length,

        storeCount:
          state.items.filter(
            item =>
              item.channel ===
              "store"
          ).length,

        localStoreSearch:
          state.retailer === "bestbuy"
            ? Boolean(BESTBUY_POSTAL_CODE)
            : null,

        searchRadiusMiles:
          state.retailer === "bestbuy" &&
          BESTBUY_POSTAL_CODE
            ? BESTBUY_RADIUS_MILES
            : null
      })
    );
}

function getProducts(
  retailer = null
) {
  syncWalmartState();

  const key =
    retailer
      ? String(
          retailer
        ).toLowerCase()
      : null;

  const selected =
    key
      ? [
          states[key]
        ].filter(
          Boolean
        )
      : Object.values(
          states
        );

  return selected.flatMap(
    state =>
      state.items
  );
}

function getStoreInventory(
  retailer = null
) {
  return getProducts(
    retailer
  ).filter(
    item =>
      item.channel ===
      "store" &&

      /*
        Extra safety:
        Target can NEVER appear
        in store inventory.
      */
      item.retailer !==
        "target"
  );
}

module.exports = {
  start,
  pollConfiguredProviders,
  pollExternal,
  normalizeItem,
  getProviderStates,
  getProducts,
  getStoreInventory
};
