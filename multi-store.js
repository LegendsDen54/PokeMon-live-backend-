const RETAILERS = {
  walmart: { label: "Walmart" },
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

const states = Object.fromEntries(
  Object.entries(RETAILERS).map(([retailer, config]) => [
    retailer,
    {
      retailer,
      label: config.label,
      configured:
        retailer === "walmart"
          ? Boolean(process.env.WALMART_RAPIDAPI_KEY)
          : Boolean(process.env[config.feedEnv]),
      running: false,
      lastRun: null,
      lastSuccess: null,
      error: null,
      items: []
    }
  ])
);

let walmartStateGetter = null;

const timers = new Map();

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function normalizeStatus(
  value,
  inStock
) {
  const text =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    /(pre[- ]?order|raffle|scheduled.*drop)/
      .test(text)
  ) {
    return "preorder";
  }

  if (
    /(on[- ]?hand)/
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
    /(in[- ]?stock|available|live|ready)/
      .test(text)
  ) {
    return "instock";
  }

  if (
    /(out|unavailable|sold out|not available)/
      .test(text)
  ) {
    return "out";
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

  const channel =
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

    name:
      String(
        raw.name ??
        raw.title ??
        "Pokémon product"
      ),

    channel,

    storeId:
      channel === "store" &&
      raw.storeId != null
        ? String(raw.storeId)
        : null,

    storeName:
      channel === "store"
        ? (
            raw.storeName ??
            raw.location ??
            null
          )
        : null,

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
        raw.salePrice
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
        .WALMART_RAPIDAPI_KEY
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

async function pollExternal(
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

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () =>
          controller.abort(),
        15000
      );

    let response;

    try {
      response =
        await fetch(
          feedUrl,
          {
            headers,

            signal:
              controller.signal
          }
        );

    } finally {
      clearTimeout(
        timeout
      );
    }

    if (
      !response.ok
    ) {
      throw new Error(
        `${config.label} feed returned HTTP ${response.status}`
      );
    }

    const payload =
      await response.json();

    state.items =
      extractFeedItems(
        payload
      ).map(
        item =>
          normalizeItem(
            retailer,
            item
          )
      );

    state.lastSuccess =
      new Date()
        .toISOString();

    state.error =
      null;

  } catch (error) {
    state.error =
      error?.name ===
        "AbortError"
        ? `${config.label} feed timed out`
        : (
            error?.message ||
            String(error)
          );

  } finally {
    state.running =
      false;
  }

  return state;
}

async function pollConfiguredProviders() {
  const providers =
    Object.keys(
      RETAILERS
    ).filter(
      retailer =>
        retailer !==
          "walmart" &&

        states[
          retailer
        ].configured
    );

  return Promise.allSettled(
    providers.map(
      pollExternal
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

    state.configured =
      Boolean(
        process.env[
          config.feedEnv
        ]
      );

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
                error.message;

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
          state.items.length
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
      "store"
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
