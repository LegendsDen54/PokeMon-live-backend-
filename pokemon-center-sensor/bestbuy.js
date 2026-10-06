"use strict";

function visibleText() {
  return String(document.body?.innerText || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function availability() {
  const page = visibleText();
  if (/pickup today|ready for pickup|pick up today/.test(page)) {
    return "pickup_available";
  }
  if (/sold out|unavailable for pickup|pickup not available/.test(page)) {
    return "pickup_unavailable";
  }
  if (/add to cart/.test(page)) {
    return "online_available";
  }
  return "unknown";
}

function productImage() {
  const meta = document.querySelector('meta[property="og:image"]')?.content;
  return meta || document.querySelector('main img')?.currentSrc || null;
}

function productPrice() {
  const match = String(document.body?.innerText || "").match(/\$\s*(\d{1,4}(?:\.\d{2})?)/);
  return match ? Number(match[1]) : null;
}

function seller() {
  const body = String(document.body?.innerText || "");
  const match = body.match(/sold\s*&\s*shipped\s*by\s*([^\n]+)/i);
  return match ? match[1].trim().slice(0, 160) : null;
}

function canonicalProductUrl() {
  const url = new URL(location.href);
  url.pathname = url.pathname.replace(/\/reviews\/?$/i, "");
  url.search = "";
  url.hash = "";
  return url.href;
}

function report() {
  chrome.runtime.sendMessage({
    kind: "bestBuyObservation",
    payload: {
      url: canonicalProductUrl(),
      title: document.title,
      image: productImage(),
      price: productPrice(),
      seller: seller(),
      availability: availability()
    }
  }).catch(() => {});
}

report();
setTimeout(report, 3000);
