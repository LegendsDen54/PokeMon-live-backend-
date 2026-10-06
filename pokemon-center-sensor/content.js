"use strict";

const DEBOUNCE_MS = 2500;
const HEARTBEAT_MS = 2 * 60 * 1000;
const MAX_NEW_PRODUCTS = 12;
const GENERIC_CHANGE_COOLDOWN_MS = 10 * 60 * 1000;

let timer = null;
let previous = null;
let lastGenericChangeAt = 0;

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

function productLinks() {
  return [...document.querySelectorAll("a[href*='/product/']")]
    .map(anchor => ({
      url: new URL(anchor.href, location.href).href,
      name: text(anchor.textContent) || null,
      image: anchor.querySelector("img")?.currentSrc || null
    }))
    .filter(item => item.url.startsWith("https://www.pokemoncenter.com/"))
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
  chrome.runtime.sendMessage({kind, payload})
    .catch(() => {});
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
  if (!previous) {
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
        item,
        "A public Pokémon Center product link appeared on a page already being observed."
      ));
  }

  if (current.image && current.image !== previous.image) {
    specificChange = true;
    signal("IMAGE_CHANGE", current, "A visible product image changed.");
  }

  if (current.sku && current.sku !== previous.sku) {
    specificChange = true;
    signal("SKU_CHANGE", current, "A visible product SKU changed.");
  }

  if (current.price !== previous.price) {
    specificChange = true;
    signal("PRICE_CHANGE", current, "A visible product price changed.");
  }

  if (current.availability !== previous.availability) {
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

new MutationObserver(scheduleObserve)
  .observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["src", "href", "content"]
  });

setInterval(() => send("heartbeat", {}), HEARTBEAT_MS);
