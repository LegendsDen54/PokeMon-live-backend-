"use strict";

let lastSignature = "";

function text() {
  return String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
}

function availability() {
  const page = text().toLowerCase();
  if (/out of stock|sold out|not available/.test(page)) return "unavailable";
  if (/club pickup|pickup|add to cart|shipping/.test(page)) return "available";
  return "unknown";
}

function price() {
  const body = text();
  const json = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map(n => { try { return JSON.parse(n.textContent || ""); } catch { return null; } })
    .flatMap(v => Array.isArray(v) ? v : [v])
    .find(v => v && (v.offers || v["@type"] === "Product"));
  const offers = json?.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (Number.isFinite(Number(offer?.price))) return Number(offer.price);
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
  const body = text();
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
  chrome.runtime.sendMessage({kind:"samsObservation", payload}).catch(() => {});
}

report();
setTimeout(report, 2500);
new MutationObserver(() => {
  clearTimeout(window.__samsMonitorTimer);
  window.__samsMonitorTimer = setTimeout(report, 250);
}).observe(document.documentElement,{childList:true,subtree:true});
