"use strict";

const backendUrl = document.getElementById("backendUrl");
const sensorToken = document.getElementById("sensorToken");
const automaticRefresh = document.getElementById("automaticRefresh");
const status = document.getElementById("status");

chrome.storage.local.get([
  "backendUrl",
  "sensorToken",
  "automaticRefreshEnabled"
]).then(stored => {
  backendUrl.value =
    stored.backendUrl ||
    "https://pokemon-live-backend.onrender.com";
  sensorToken.value = stored.sensorToken || "";
  automaticRefresh.checked = stored.automaticRefreshEnabled === true;
});

document.getElementById("save")
  .addEventListener("click", async () => {
    const url = backendUrl.value.trim().replace(/\/$/, "");
    const token = sensorToken.value.trim();

    if (!/^https:\/\//.test(url) || !token) {
      status.textContent = "Enter the monitor address and pairing key.";
      return;
    }

    await chrome.storage.local.set({
      backendUrl: url,
      sensorToken: token,
      automaticRefreshEnabled: automaticRefresh.checked,
      lastAutomaticRefreshAt: 0
    });

    chrome.runtime.sendMessage({kind: "heartbeat", payload: {}})
      .then(result => {
        status.textContent = result.ok
          ? "Connected. Keep the Pokémon Center pages you want to watch open."
          : `Connection failed: ${result.body?.error || result.error || "unknown error"}`;
      })
      .catch(error => {
        status.textContent = `Connection failed: ${error.message}`;
      });
  });
