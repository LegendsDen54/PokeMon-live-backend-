"use strict";

const DEBOUNCE_MS = 2500;
const HEARTBEAT_MS = 2 * 60 * 1000;
const MAX_NEW_PRODUCTS = 12;
const GENERIC_CHANGE_COOLDOWN_MS = 10 * 60 * 1000;
const BASELINE_SETTLE_MS = 8000;

let timer = null;
let previous = null;
let lastGenericChangeAt = 0;
const baselineReadyAt = Date.now() + BASELINE_SETTLE_MS;

function text(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(selector) {
  return text(document.querySelector(selector)?.textContent);
}

function meta(selector) {
  return text(document.querySelector(selector)?.content);
}

function availabilityFrom(pageText) {
  const value = pageText.toLowerCase();

  if (/virtual queue|you are in line|queue is active/.test(value)) {
    return "queue";
  }

  if (/out of stock|sold out|unavailable/.test(value)) {
    return "out_of_stock";
  }

  if (/pre-order|preorder/.test(value)) {
    return "preorder";
  }

  if (/add to cart|add to bag|in stock/.test(value)) {
    return "in_stock";
  }

  return "unknown";
}

function priceFrom(pageText) {
  const match = pageText.match(/(?:US\s*)?\$\s*(\d{1,4}(?:\.\d{2})?)/);
  return match ? Number(match[1]) : null;
}

function skuFrom(pageText) {
  const match = pageText.match(/(?:sku|product id|item #?)\s*[:#]?\s*([a-z0-9-]{4,})/i);
  return match ? match[1] : null;
}

function isTcgText(value) {
  return /\bpok[eé]mon\s*tcg\b|trading\s*card\s*game|\belite trainer box\b|\bbooster\s+(?:box|bundle|pack)\b|\bultra[- ]premium collection\b|\bbuild\s*(?:&|and)\s*battle\b|\bpromo\s+card\b|\bcollector(?:'s)?\s+chest\b|\bmini\s*tins?\b|\btrainer\s+kit\b|\btheme\s+deck\b/i.test(
    String(value || "")
  );
}

function productLinks() {
  return [...document.querySelectorAll("a[href*='/product/']")]
    .map(anchor => {
      const label = text(anchor.textContent);

      return {
        url: new URL(anchor.href, location.href).href,
        name: text(label.replace(/(?:US\s*)?\$\s*\d{1,4}(?:\.\d{2})?/g, " ")) || null,
        image: anchor.querySelector("img")?.currentSrc || null,
        price: priceFrom(label)
      };
    })
    .filter(item => item.url.startsWith("https://www.pokemoncenter.com/"))
    .filter(item => isTcgText(`${item.name || ""} ${item.url}`))
    .filter((item, index, items) =>
      items.findIndex(candidate => candidate.url === item.url) === index
    )
    .slice(0, MAX_NEW_PRODUCTS);
}

function marker(value) {
  let hash = 2166136261;

  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

function snapshot() {
  const pageText = text(document.body?.innerText).slice(0, 120000);
  const mainText = text(document.querySelector("main")?.innerText || pageText)
    .slice(0, 16000);
  const links = productLinks();
  const tcgRelevant = isTcgText([
    document.title,
    firstText("h1"),
    mainText,
    links.map(item => `${item.name || ""} ${item.url}`).join("\n")
  ].join("\n"));
  const image =
    meta("meta[property='og:image']") ||
    document.querySelector("main img")?.currentSrc ||
    null;

  return {
    url: location.href,
    name:
      firstText("h1") ||
      meta("meta[property='og:title']") ||
      document.title,
    image,
    sku: skuFrom(pageText),
    price: priceFrom(pageText),
    availability: availabilityFrom(pageText),
    tcgRelevant,
    productLinks: links,
    pageMarker: marker([
      document.title,
      meta("meta[name='description']"),
      mainText,
      links.map(item => `${item.url}|${item.name || ""}`).join("\n")
    ].join("\n"))
  };
}

function send(kind, payload) {
  try {
    const request = chrome.runtime.sendMessage({
      kind,
      payload
    });

    /*
      Chrome versions differ on whether this call
      returns a Promise. Handle both without turning
      a harmless delivery failure into a page error.
    */
    if (request && typeof request.catch === "function") {
      request.catch(() => {});
    }
  } catch {
    // The extension may be reloading; the next heartbeat retries.
  }
}

function signal(type, data, detail) {
  send("signal", {
    type,
    ...data,
    detail
  });
}

function sameLinks(left, right) {
  return JSON.stringify(left.map(item => item.url)) ===
    JSON.stringify(right.map(item => item.url));
}

function compare(current) {
  /*
    Pokémon Center can populate product links after the content script
    starts. Keep refreshing the local baseline during that short load
    period so existing page items are not misreported as new uploads.
  */
  if (!previous || Date.now() < baselineReadyAt) {
    previous = current;
    return;
  }

  if (current.url !== previous.url) {
    previous = current;
    return;
  }

  let specificChange = false;

  if (!sameLinks(previous.productLinks, current.productLinks)) {
    specificChange = true;
    const before = new Set(previous.productLinks.map(item => item.url));

    current.productLinks
      .filter(item => !before.has(item.url))
      .forEach(item => signal(
        "PRODUCT_DISCOVERED",
        {...item, tcgRelevant: true},
        "A public Pokémon Center product link appeared on a page already being observed."
      ));
  }

  if (current.tcgRelevant && current.image && current.image !== previous.image) {
    specificChange = true;
    signal("IMAGE_CHANGE", current, "A visible product image changed.");
  }

  if (current.tcgRelevant && current.sku && current.sku !== previous.sku) {
    specificChange = true;
    signal("SKU_CHANGE", current, "A visible product SKU changed.");
  }

  if (current.tcgRelevant && current.price !== previous.price) {
    specificChange = true;
    signal("PRICE_CHANGE", current, "A visible product price changed.");
  }

  if (current.tcgRelevant && current.availability !== previous.availability) {
    specificChange = true;
    signal(
      current.availability === "queue" ? "QUEUE_ACTIVE" : "AVAILABILITY_CHANGE",
      {
        ...current,
        queueActive: current.availability === "queue",
        live: current.availability === "in_stock"
      },
      "Visible Pokémon Center availability changed."
    );
  }

  if (
    !specificChange &&
    current.tcgRelevant &&
    current.pageMarker !== previous.pageMarker &&
    Date.now() - lastGenericChangeAt >= GENERIC_CHANGE_COOLDOWN_MS
  ) {
    lastGenericChangeAt = Date.now();
    signal(
      "PAGE_CHANGE",
      {
        url: current.url,
        pageMarker: current.pageMarker,
        observedOnly: true
      },
      "Public page content changed without a page reload."
    );
  }

  previous = current;
}

function observe() {
  compare(snapshot());
}

function scheduleObserve() {
  clearTimeout(timer);
  timer = setTimeout(observe, DEBOUNCE_MS);
}

send("heartbeat", {});
observe();

/* Capture one final stable baseline after client-side page loading. */
setTimeout(observe, BASELINE_SETTLE_MS + 250);

new MutationObserver(scheduleObserve)
  .observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["src", "href", "content"]
  });

setInterval(() => send("heartbeat", {}), HEARTBEAT_MS);
