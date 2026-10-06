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

function report() {
  chrome.runtime.sendMessage({
    kind: "bestBuyObservation",
    payload: {
      url: location.href,
      title: document.title,
      availability: availability()
    }
  }).catch(() => {});
}

report();
setTimeout(report, 3000);
