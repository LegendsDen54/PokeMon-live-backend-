"use strict";

const DEFAULT_BACKEND_URL =
  "https://pokemon-live-backend.onrender.com";

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
          : null;

    if (!path) {
      sendResponse({
        ok: false,
        error: "Unknown sensor message"
      });
      return;
    }

    post(path, message.payload || {})
      .then(sendResponse)
      .catch(error => sendResponse({
        ok: false,
        error: error.message
      }));

    return true;
  }
);
