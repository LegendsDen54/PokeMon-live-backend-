"use strict";

/* Watches only newly visible posts on the public @PokemonRestocks timeline. */
const seenPostIds = new Set();
let initialized = false;
let timer = null;

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function relatesToPokemonCenter(text) {
  return /pokemon\s*center|pokemoncenter\.com|\bqueue\b/i.test(text);
}

function report(article) {
  const link = article.querySelector("a[href*='/PokemonRestocks/status/']");
  const id = link?.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
  const alertText = normalize(article.innerText).slice(0, 800);

  if (!id || !alertText || seenPostIds.has(id)) {
    return;
  }

  seenPostIds.add(id);

  if (!initialized) {
    return;
  }

  chrome.runtime.sendMessage({
    kind: "thirdPartyAlert",
    payload: {
      provider: "PokemonRestocks",
      postId: id,
      url: new URL(link.href, location.href).href,
      alertText,
      queueReported: /\bqueue\b/i.test(alertText),
      pokemonCenterRelated: relatesToPokemonCenter(alertText)
    }
  }).catch(() => {});
}

function inspect() {
  document.querySelectorAll("article[data-testid='tweet']").forEach(report);
  initialized = true;
}

function scheduleInspect() {
  clearTimeout(timer);
  timer = setTimeout(inspect, 1500);
}

inspect();
new MutationObserver(scheduleInspect).observe(document.documentElement, {
  childList: true,
  subtree: true
});
