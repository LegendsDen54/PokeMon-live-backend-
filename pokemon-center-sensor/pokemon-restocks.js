"use strict";

/* Watches only newly visible posts on the public @PokemonRestocks timeline. */
const seenPostIds = new Set();
let initialized = false;
let timer = null;

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isTcgAlert(text) {
  return /\bpok[eé]mon\s*tcg\b|trading\s*card\s*game|\belite trainer box\b|\bbooster\s+(?:box|bundle|pack)\b|\bultra[- ]premium collection\b|\bbuild\s*(?:&|and)\s*battle\b|\bpromo\s+card\b|\bcollector(?:'s)?\s+chest\b|\bmini\s*tins?\b|\btrainer\s+kit\b|\btheme\s+deck\b/i.test(text);
}

function relatesToPokemonCenter(text) {
  return /pokemon\s*center|pokemoncenter\.com|\bqueue\b/i.test(text);
}

function report(article) {
  const link = article.querySelector("a[href*='/PokemonRestocks/status/']");
  const id = link?.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
  const alertText = normalize(article.innerText).slice(0, 800);

  if (!id || !alertText || !isTcgAlert(alertText) || seenPostIds.has(id)) {
    return;
  }

  seenPostIds.add(id);

  if (!initialized) {
    return;
  }

  try {
    const request = chrome.runtime.sendMessage({
      kind: "thirdPartyAlert",
      payload: {
        provider: "PokemonRestocks",
        postId: id,
        url: new URL(link.href, location.href).href,
        alertText,
        queueReported: /\bqueue\b/i.test(alertText),
        pokemonCenterRelated: relatesToPokemonCenter(alertText),
        tcgRelevant: true
      }
    });

    if (request && typeof request.catch === "function") {
      request.catch(() => {});
    }
  } catch {
    // The extension may be reloading; later posts are checked again.
  }
}

function inspect() {
  document.querySelectorAll("article[data-testid='tweet']").forEach(report);
  initialized = true;
}

function scheduleInspect() {
  clearTimeout(timer);
  timer = setTimeout(inspect, 100);
}

inspect();
new MutationObserver(scheduleInspect).observe(document.documentElement, {
  childList: true,
  subtree: true
});
