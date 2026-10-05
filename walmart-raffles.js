const DRAW_URL =
  "https://www.walmart.com/shop/collectibles/draw";

const REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number(
    process.env.WALMART_RAFFLE_TIMEOUT_MS ||
    12000
  )
);

let state = {
  ok: false,
  lastChecked: null,
  lastSuccess: null,
  error: null,
  count: 0,
  items: []
};


/* ========================================
   HELPERS
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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}


/* ========================================
   OFFICIAL SEALED FILTER
======================================== */

function isOfficialPokemonProduct(
  value
) {
  const text =
    normalize(value);

  if (
    !text.includes("pokemon")
  ) {
    return false;
  }

  const rejected = [
    /\bmystery\b/,
    /\brepack\b/,
    /\brepacked\b/,
    /\bcustom\b/,
    /\bguaranteed ex\b/,
    /\bguaranteed gx\b/,
    /\bguaranteed hit\b/,
    /\bguaranteed rare\b/,
    /\bhot pack\b/,
    /\bgod pack\b/,
    /\bmega pack\b/,
    /\bsingle card\b/,
    /\bgraded\b/,
    /\bpsa\b/,
    /\bbgs\b/,
    /\bcgc\b/
  ];

  if (
    rejected.some(
      pattern =>
        pattern.test(text)
    )
  ) {
    return false;
  }

  const allowed = [
    /\belite trainer box\b/,
    /\betb\b/,
    /\bbooster bundle\b/,
    /\bbooster box\b/,
    /\bdisplay box\b/,
    /\bbooster pack\b/,
    /\bsleeved booster\b/,
    /\bmini tin\b/,
    /\btin\b/,
    /\bknock ?out\b/,
    /\bposter collection\b/,
    /\btech sticker\b/,
    /\bpremium collection\b/,
    /\bsuper premium\b/,
    /\bultra premium\b/,
    /\bcollection box\b/,
    /\bcollection\b/,
    /\b3 pack blister\b/,
    /\bblister\b/,
    /\bbuild and battle\b/
  ];

  return allowed.some(
    pattern =>
      pattern.test(text)
  );
}


/* ========================================
   PRODUCT FIELD READERS
======================================== */

function getName(item) {
  return (
    item?.name ||
    item?.title ||
    item?.productName ||
    item?.displayName ||
    item?.productTitle ||
    ""
  );
}

function getItemId(item) {
  return (
    item?.usItemId ||
    item?.itemId ||
    item?.productId ||
    item?.id ||
    null
  );
}

function getUrl(item) {
  let url =
    item?.canonicalUrl ||
    item?.productUrl ||
    item?.productPageUrl ||
    item?.url ||
    null;

  if (
    url &&
    String(url)
      .startsWith("/")
  ) {
    url =
      `https://www.walmart.com${url}`;
  }

  if (!url) {
    const itemId =
      getItemId(item);

    if (itemId) {
      url =
        `https://www.walmart.com/ip/${itemId}`;
    }
  }

  return url;
}

function getImage(item) {
  if (
    typeof item?.image ===
    "string"
  ) {
    return item.image;
  }

  return (
    item?.imageInfo
      ?.thumbnailUrl ||

    item?.imageInfo
      ?.imageUrl ||

    item?.imageUrl ||

    item?.thumbnailUrl ||

    item?.primaryImage ||

    item?.image?.url ||

    item?.image?.imageUrl ||

    null
  );
}

function getPrice(item) {
  return parsePrice(
    item?.priceInfo
      ?.currentPrice
      ?.price ??

    item?.priceInfo
      ?.currentPrice ??

    item?.price
      ?.currentPrice ??

    item?.currentPrice ??

    item?.salePrice ??

    item?.price
  );
}


/* ========================================
   DRAW STATUS
======================================== */

function getObjectText(item) {
  try {
    return normalize(
      JSON.stringify(item)
    );
  } catch {
    return normalize(
      getName(item)
    );
  }
}

function determineStatus(item) {
  const text =
    getObjectText(item);

  if (
    /drawing ended|draw ended|drawing closed|closed drawing/
      .test(text)
  ) {
    return "closed";
  }

  if (
    /enter drawing|enter draw|drawing open|active drawing|join drawing|draw live/
      .test(text)
  ) {
    return "live";
  }

  if (
    /upcoming drawing|drawing starts|draw starts|coming soon|upcoming/
      .test(text)
  ) {
    return "upcoming";
  }

  if (
    item?.showDrawCTA ===
    true
  ) {
    return "detected";
  }

  return "detected";
}

function findDate(
  value,
  depth = 0
) {
  if (
    value === null ||
    value === undefined ||
    depth > 6
  ) {
    return null;
  }

  if (
    typeof value ===
    "string"
  ) {
    if (
      !/20[0-9]{2}/
        .test(value)
    ) {
      return null;
    }

    const parsed =
      Date.parse(value);

    return Number.isFinite(parsed)
      ? new Date(parsed)
          .toISOString()
      : null;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      const found =
        findDate(
          item,
          depth + 1
        );

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (
    typeof value ===
    "object"
  ) {
    const preferred = [
      "drawingStartTime",
      "drawStartTime",
      "eventStartTime",
      "startDateTime",
      "startTime",
      "startDate"
    ];

    for (
      const key of preferred
    ) {
      if (
        value[key] !==
        undefined
      ) {
        const found =
          findDate(
            value[key],
            depth + 1
          );

        if (found) {
          return found;
        }
      }
    }

    for (
      const nested of
      Object.values(value)
    ) {
      const found =
        findDate(
          nested,
          depth + 1
        );

      if (found) {
        return found;
      }
    }
  }

  return null;
}


/* ========================================
   JSON EXTRACTION
======================================== */

function extractJsonScripts(html) {
  const scripts = [];

  const regex =
    /<script[^>]*>([\s\S]*?)<\/script>/gi;

  let match;

  while (
    (
      match =
        regex.exec(html)
    )
  ) {
    const text =
      decodeHtml(
        match[1]
      ).trim();

    if (
      !text ||
      (
        !text.startsWith("{") &&
        !text.startsWith("[")
      )
    ) {
      continue;
    }

    try {
      scripts.push(
        JSON.parse(text)
      );
    } catch {
      // Ignore non-JSON script tags.
    }
  }

  return scripts;
}


/* ========================================
   RECURSIVE PRODUCT DISCOVERY
======================================== */

function collectProductsFromJson(
  root
) {
  const candidates = [];

  const visited =
    new Set();

  function walk(
    value,
    depth = 0
  ) {
    if (
      value === null ||
      value === undefined ||
      depth > 16
    ) {
      return;
    }

    if (
      typeof value !==
      "object"
    ) {
      return;
    }

    if (
      visited.has(value)
    ) {
      return;
    }

    visited.add(value);

    if (
      !Array.isArray(value)
    ) {
      const name =
        getName(value);

      if (
        name &&
        normalize(name)
          .includes("pokemon")
      ) {
        candidates.push(
          value
        );
      }
    }

    const children =
      Array.isArray(value)
        ? value
        : Object.values(
            value
          );

    for (
      const child of children
    ) {
      walk(
        child,
        depth + 1
      );
    }
  }

  walk(root);

  return candidates;
}


/* ========================================
   NORMALIZE RAFFLE PRODUCT
======================================== */

function normalizeRaffle(item) {
  const name =
    getName(item);

  if (
    !isOfficialPokemonProduct(
      name
    )
  ) {
    return null;
  }

  const itemId =
    getItemId(item);

  const status =
    determineStatus(item);

  return {
    productId:
      itemId
        ? `walmart-raffle-${itemId}`
        : `walmart-raffle-${normalize(
            name
          ).replace(/\s+/g, "-")}`,

    walmartItemId:
      itemId,

    retailer:
      "walmart",

    retailerLabel:
      "Walmart",

    raffle:
      true,

    name,

    price:
      getPrice(item),

    image:
      getImage(item),

    url:
      getUrl(item) ||
      DRAW_URL,

    raffleStatus:
      status,

    status,

    startsAt:
      findDate(item),

    checkedAt:
      new Date()
        .toISOString(),

    source:
      "walmart-public-draw-page"
  };
}


/* ========================================
   HTML FALLBACK
======================================== */

function extractClosedFromHtml(
  html
) {
  const text =
    decodeHtml(
      String(html || "")
        .replace(
          /<script[\s\S]*?<\/script>/gi,
          " "
        )
        .replace(
          /<style[\s\S]*?<\/style>/gi,
          " "
        )
        .replace(
          /<[^>]+>/g,
          "\n"
        )
    )
      .replace(
        /\s+/g,
        " "
      );

  const matches = [];

  const regex =
    /((?:Pok[eé]mon|Pokemon)[^]{0,180}?)(?:Drawing ended|Drawing starts|Enter drawing|Upcoming drawing)/gi;

  let match;

  while (
    (
      match =
        regex.exec(text)
    )
  ) {
    const name =
      String(
        match[1] || ""
      )
        .trim()
        .slice(0, 220);

    if (
      isOfficialPokemonProduct(
        name
      )
    ) {
      matches.push({
        productId:
          `walmart-raffle-${normalize(
            name
          ).replace(/\s+/g, "-")}`,

        walmartItemId:
          null,

        retailer:
          "walmart",

        retailerLabel:
          "Walmart",

        raffle:
          true,

        name,

        price:
          null,

        image:
          null,

        url:
          DRAW_URL,

        raffleStatus:
          /ended/i.test(
            match[0]
          )
            ? "closed"
            : /enter drawing/i.test(
                match[0]
              )
              ? "live"
              : "upcoming",

        status:
          /ended/i.test(
            match[0]
          )
            ? "closed"
            : /enter drawing/i.test(
                match[0]
              )
              ? "live"
              : "upcoming",

        startsAt:
          null,

        checkedAt:
          new Date()
            .toISOString(),

        source:
          "walmart-public-draw-html"
      });
    }
  }

  return matches;
}


/* ========================================
   FETCH WALMART DRAW PAGE
======================================== */

async function fetchDrawPage() {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        DRAW_URL,
        {
          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",

            "Accept":
              "text/html,application/xhtml+xml",

            "Accept-Language":
              "en-US,en;q=0.9",

            "Cache-Control":
              "no-cache"
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `Walmart draw page returned ${response.status}`
      );
    }

    return await response.text();

  } finally {
    clearTimeout(
      timer
    );
  }
}


/* ========================================
   SCAN
======================================== */

async function scan() {
  state.lastChecked =
    new Date()
      .toISOString();

  try {
    const html =
      await fetchDrawPage();

    const jsonScripts =
      extractJsonScripts(
        html
      );

    const rawCandidates = [];

    for (
      const json of
      jsonScripts
    ) {
      rawCandidates.push(
        ...collectProductsFromJson(
          json
        )
      );
    }

    const normalized =
      rawCandidates
        .map(
          normalizeRaffle
        )
        .filter(Boolean);

    /*
      HTML fallback helps if Walmart
      renders draw labels outside the
      product object itself.
    */
    normalized.push(
      ...extractClosedFromHtml(
        html
      )
    );

    const unique =
      new Map();

    for (
      const item of normalized
    ) {
      const key =
        String(
          item.walmartItemId ||
          item.url ||
          item.name
        );

      const existing =
        unique.get(key);

      /*
        Prefer the richer item.
      */
      if (
        !existing ||
        (
          item.walmartItemId &&
          !existing.walmartItemId
        ) ||
        (
          item.image &&
          !existing.image
        )
      ) {
        unique.set(
          key,
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

            const order = {
              live: 0,
              upcoming: 1,
              detected: 2,
              closed: 3
            };

            return (
              (
                order[
                  a.raffleStatus
                ] ?? 9
              ) -
              (
                order[
                  b.raffleStatus
                ] ?? 9
              )
            );
          }
        );

    state = {
      ok: true,

      lastChecked:
        state.lastChecked,

      lastSuccess:
        new Date()
          .toISOString(),

      error:
        null,

      count:
        items.length,

      items
    };

    return {
      ...state
    };

  } catch (error) {
    state = {
      ...state,

      ok:
        false,

      lastChecked:
        state.lastChecked,

      error:
        error.message
    };

    return {
      ...state
    };
  }
}


/* ========================================
   STATE
======================================== */

function getState() {
  return {
    ...state,

    items:
      [...state.items]
  };
}


/* ========================================
   EXPORTS
======================================== */

module.exports = {
  scan,
  getState,
  DRAW_URL
};