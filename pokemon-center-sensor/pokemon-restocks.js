"use strict";

/* Watches only newly visible posts on the public @PokemonRestocks timeline. */
const seenPostIds = new Set();
const pendingPostIds = new Set();
let timer = null;
const TIMELINE_REFRESH_MS = 30 * 60 * 1000;

function chicagoDayKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value || Date.now()));
}

let activeChicagoDay = chicagoDayKey();

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isTcgAlert(text) {
  return /\bpok[eé]mon\s*tcg\b|trading\s*card\s*game|\belite trainer box\b|\bbooster\s+(?:box|bundle|pack)\b|\bultra[- ]premium collection\b|\bbuild\s*(?:&|and)\s*battle\b|\bpromo\s+card\b|\bcollector(?:'s)?\s+chest\b|\bmini\s*tins?\b|\btrainer\s+kit\b|\btheme\s+deck\b/i.test(text);
}

function relatesToPokemonCenter(text) {
  return /pokemon\s*center|pokemoncenter\.com|\bqueue\b/i.test(text);
}

function isTodayInChicago(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return chicagoDayKey(date) === chicagoDayKey();
}

function report(article) {
  const link = article.querySelector("a[href*='/PokemonRestocks/status/']");
  const id = link?.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
  const publishedAt = article.querySelector("time")?.getAttribute("datetime") || null;
  const alertText = normalize(article.innerText).slice(0, 800);

  if (
    !id ||
    !publishedAt ||
    !isTodayInChicago(publishedAt) ||
    !alertText ||
    !isTcgAlert(alertText) ||
    seenPostIds.has(id)
  ) {
    return;
  }

  pendingPostIds.add(id);

  try {
    const request = chrome.runtime.sendMessage({
      kind: "thirdPartyAlert",
      payload: {
        provider: "PokemonRestocks",
        postId: id,
        url: new URL(link.href, location.href).href,
        alertText,
        publishedAt,
        queueReported: /\bqueue\b/i.test(alertText),
        pokemonCenterRelated: relatesToPokemonCenter(alertText),
        tcgRelevant: true
      }
    });

    if (request && typeof request.then === "function") {
      request
        .then(result => {
          if (result?.ok) {
            seenPostIds.add(id);
          }
        })
        .catch(() => {})
        .finally(() => pendingPostIds.delete(id));
    } else {
      /* Older Chrome versions do not return a Promise here. The next
         timeline refresh safely retries if delivery was not confirmed. */
      pendingPostIds.delete(id);
    }
  } catch {
    pendingPostIds.delete(id);
    // The extension may be reloading; later timeline changes retry.
  }
}

function inspect() {
  document.querySelectorAll("article[data-testid='tweet'], article").forEach(article => {
    const link = article.querySelector("a[href*='/PokemonRestocks/status/']");
    const id = link?.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
    if (!id || !pendingPostIds.has(id)) report(article);
  });
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

/*
  X does not reliably stream every new post into an idle timeline. Refresh the
  owner-opened public timeline so the sensor can collect today's posts.
*/
setInterval(() => location.reload(), TIMELINE_REFRESH_MS);

/* Start a clean daily feed even when the 30-minute timer spans midnight. */
setInterval(() => {
  const today = chicagoDayKey();
  if (today !== activeChicagoDay) {
    activeChicagoDay = today;
    location.reload();
  }
}, 60 * 1000);
