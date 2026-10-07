"use strict";

const backendUrl = document.getElementById("backendUrl");
const sensorToken = document.getElementById("sensorToken");
const automaticRefresh = document.getElementById("automaticRefresh");
const status = document.getElementById("status");
const ccnBridge=document.getElementById('ccnBridge');
chrome.storage.local.get(['ccnBridgeEnabled','ccnBridgeLastSuccess','ccnBridgeError','ccnPending']).then(config=>{
  ccnBridge.checked=config.ccnBridgeEnabled!==false;
  document.getElementById('ccnBridgeState').textContent=config.ccnBridgeError || (config.ccnBridgeLastSuccess?'Last transfer: '+new Date(config.ccnBridgeLastSuccess).toLocaleString():'Waiting for a qualifying CCN message in an open tab.')+' Pending: '+(config.ccnPending || []).length;
});
ccnBridge.addEventListener('change',async()=>{
  await chrome.storage.local.set({ccnBridgeEnabled:ccnBridge.checked});
  document.getElementById('ccnBridgeState').textContent=ccnBridge.checked?'CCN transfer enabled.':'CCN transfer paused.';
});

chrome.storage.local.get([
  "backendUrl",
  "sensorToken",
  "pokemonCenterHourlyRefreshEnabled"
]).then(stored => {
  backendUrl.value =
    stored.backendUrl ||
    "https://pokemon-live-backend.onrender.com";
  sensorToken.value = stored.sensorToken || "";
  automaticRefresh.checked = stored.pokemonCenterHourlyRefreshEnabled !== false;
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
      pokemonCenterHourlyRefreshEnabled: automaticRefresh.checked,
      lastAutomaticRefreshAt: Date.now()
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

const targetRefresh=document.getElementById('targetRefresh');
chrome.storage.local.get(['targetRefreshEnabled','targetRefreshPaused']).then(config=>{
 targetRefresh.checked=false; targetRefresh.disabled=true;
 const paused=Object.keys(config.targetRefreshPaused || {}).length;document.getElementById('targetRefreshState').textContent=paused?paused+' Target tab(s) paused for queue/security protection.':'Automatic Target refresh is disabled.';
});
targetRefresh.addEventListener('change',async()=>{
 await chrome.storage.local.set({targetRefreshEnabled:targetRefresh.checked,...(targetRefresh.checked?{targetRefreshPaused:{},targetRefreshTimes:{}}:{})});
 document.getElementById('targetRefreshState').textContent=targetRefresh.checked?'Target refresh enabled.':'Target refresh stopped. Current pages stay open.';
});

chrome.storage.local.get(['pokemonCenterRefreshPaused']).then(config=>{
  document.getElementById('pcRefreshState').textContent=config.pokemonCenterRefreshPaused?'Refresh paused for queue, security protection or unreadable page. Leave the queue window open.':'Hourly refresh ready; queue detection pauses until you resume.';
});
document.getElementById('resumePc').addEventListener('click',async()=>{
  await chrome.storage.local.set({pokemonCenterRefreshPaused:false,lastAutomaticRefreshAt:Date.now()});
  document.getElementById('pcRefreshState').textContent='Hourly refresh resumed. Next refresh is at least one hour away; pages are checked again first.';
});