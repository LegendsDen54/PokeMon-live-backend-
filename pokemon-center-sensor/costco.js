"use strict";

let lastSignature = "";

function pageText() {
  return String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
}

function availability() {
  const page = pageText().toLowerCase();
  if (/out of stock|sold out|not available|item is unavailable/.test(page)) return "unavailable";
  if (/add to cart|add to list|delivery|warehouse availability/.test(page)) return "available";
  return "unknown";
}

function price() {
  const body = pageText();
  const values = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map(n => { try { return JSON.parse(n.textContent || ""); } catch { return null; } })
    .flatMap(v => Array.isArray(v) ? v : [v]);
  for (const value of values) {
    const offers = Array.isArray(value?.offers) ? value.offers : [value?.offers];
    const offer = offers.find(o => Number.isFinite(Number(o?.price)));
    if (offer) return Number(offer.price);
  }
  const m = body.match(/\$\s*(\d{1,4}(?:\.\d{2})?)/);
  return m ? Number(m[1]) : null;
}

function image() {
  return document.querySelector('meta[property="og:image"]')?.content || null;
}

function canonicalUrl() {
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  return u.href;
}

function itemNumber() {
  const body = pageText();
  return body.match(/(?:item|item number|item #)\s*[:#]?\s*(\d{5,})/i)?.[1] || null;
}

function report() {
  const payload = {
    url: canonicalUrl(),
    title: document.querySelector('meta[property="og:title"]')?.content || document.title,
    image: image(),
    price: price(),
    availability: availability(),
    itemNumber: itemNumber(),
    observedAt: new Date().toISOString()
  };
  const signature = JSON.stringify(payload, (k,v) => k === "observedAt" ? undefined : v);
  if (signature === lastSignature) return;
  lastSignature = signature;
  chrome.runtime.sendMessage({kind:"costcoObservation", payload}).catch(() => {});
}

report();
setTimeout(report, 2500);
new MutationObserver(() => {
  clearTimeout(window.__costcoMonitorTimer);
  window.__costcoMonitorTimer = setTimeout(report, 250);
}).observe(document.documentElement,{childList:true,subtree:true});
