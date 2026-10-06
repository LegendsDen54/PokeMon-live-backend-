"use strict";

const DEFAULT_BACKEND_URL =
  "https://pokemon-live-backend.onrender.com";

const REFRESH_ALARM = "pokemon-center-scheduled-refresh";
const ACTIVE_REFRESH_MS = 1 * 60 * 1000;
const QUIET_REFRESH_MS = 15 * 60 * 1000;

function isPokemonRestocksUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "x.com" &&
      /^\/PokemonRestocks\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function attachPokemonRestocksSensor(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: {tabId},
      files: ["pokemon-restocks.js"]
    });
  } catch {
    // The tab may still be loading or X may have navigated away.
  }
}

async function attachOpenPokemonRestocksSensors() {
  const tabs = await chrome.tabs.query({url: "https://x.com/PokemonRestocks*"});
  await Promise.all(tabs.map(tab => attachPokemonRestocksSensor(tab.id)));
}

function centralNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23"
  }).formatToParts(new Date());

  return Object.fromEntries(
    parts
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
}

function activeWatchWindow() {
  const now = centralNow();
  const hour = Number(now.hour);

  return ["Tue", "Wed", "Thu"].includes(now.weekday) &&
    hour >= 9 &&
    hour < 14;
}

async function refreshPokemonCenterTabs() {
  const settings = await chrome.storage.local.get([
    "automaticRefreshEnabled",
    "lastAutomaticRefreshAt"
  ]);

  if (settings.automaticRefreshEnabled === false) {
    return;
  }

  if (!activeWatchWindow()) {
    return;
  }

  const interval = ACTIVE_REFRESH_MS;

  if (Date.now() - Number(settings.lastAutomaticRefreshAt || 0) < interval) {
    return;
  }

  const tabs = await chrome.tabs.query({
    url: "https://www.pokemoncenter.com/*"
  });

  if (!tabs.length) {
    return;
  }

  await Promise.all(
    tabs
      .filter(tab => Number.isInteger(tab.id))
      .map(tab => chrome.tabs.reload(tab.id))
  );

  await chrome.storage.local.set({
    lastAutomaticRefreshAt: Date.now()
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, {
    periodInMinutes: 1
  });
  attachOpenPokemonRestocksSensors().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, {
    periodInMinutes: 1
  });
  attachOpenPokemonRestocksSensors().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isPokemonRestocksUrl(tab.url)) {
    attachPokemonRestocksSensor(tabId).catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === REFRESH_ALARM) {
    refreshPokemonCenterTabs().catch(() => {});
  }
});

async function getConfig() {
  const stored = await chrome.storage.local.get([
    "backendUrl",
    "sensorToken",
    "sensorId"
  ]);

  if (!stored.sensorId) {
    stored.sensorId = crypto.randomUUID();
    await chrome.storage.local.set({
      sensorId: stored.sensorId
    });
  }

  return {
    backendUrl: String(
      stored.backendUrl || DEFAULT_BACKEND_URL
    ).replace(/\/$/, ""),
    sensorToken: String(stored.sensorToken || "").trim(),
    sensorId: stored.sensorId
  };
}

function chicagoDay(value) {
  const date = new Date(value || Date.now());
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(Number.isNaN(date.getTime()) ? new Date() : date);
}

async function post(path, payload) {
  const config = await getConfig();

  if (!config.sensorToken) {
    return {
      ok: false,
      configured: false,
      error: "Sensor pairing key is missing"
    };
  }

  const response = await fetch(
    `${config.backendUrl}${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pokemon-center-sensor-token": config.sensorToken
      },
      body: JSON.stringify({
        ...payload,
        sensorId: config.sensorId,
        version: chrome.runtime.getManifest().version,
        userAgent: navigator.userAgent
      })
    }
  );

  const body = await response.json()
    .catch(() => ({}));

  return {
    ok: response.ok,
    configured: true,
    status: response.status,
    body
  };
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return;
    }

    const path =
      message.kind === "heartbeat"
        ? "/api/pokemon-center/sensor/heartbeat"
        : message.kind === "signal"
          ? "/api/pokemon-center/sensor/signal"
          : message.kind === "thirdPartyAlert"
            ? "/api/pokemon-center/sensor/third-party-alert"
            : message.kind === "bestBuyObservation"
              ? "/api/bestbuy/browser-observation"
            : message.kind === "samsObservation"
              ? "/api/sams/browser-observation"
            : message.kind === "costcoObservation"
              ? "/api/costco/browser-observation"
          : null;

    if (!path) {
      sendResponse({
        ok: false,
        error: "Unknown sensor message"
      });
      return;
    }

    const payload = message.payload || {};

    /*
      Keep a durable record of posts already forwarded. The X page is
      periodically refreshed to find new posts, so this prevents the same
      timeline cards from being delivered again after each refresh.
    */
    const send = async () => {
      if (message.kind === "thirdPartyAlert") {
        const postId = String(payload.postId || "").trim();
          /* Keep the timeline clean within a day while allowing today's
             posts to be recovered after the monitor restarts. */
          const key = postId
            ? `pokemonRestocks:${chicagoDay(payload.publishedAt)}:${postId}`
            : null;

        if (key) {
          const stored = await chrome.storage.local.get(key);
          if (stored[key] === true) {
            return {ok: true, duplicate: true};
          }

          const result = await post(path, payload);
          if (result.ok) {
            await chrome.storage.local.set({[key]: true});
          }
          return result;
        }
      }

      return post(path, payload);
    };

    send()
      .then(sendResponse)
      .catch(error => sendResponse({
        ok: false,
        error: error.message
      }));

    return true;
  }
);
