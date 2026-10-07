"use strict";

const DEFAULT_BACKEND_URL =
  "https://pokemon-live-backend.onrender.com";

const REFRESH_ALARM = "pokemon-center-scheduled-refresh";
const ACTIVE_REFRESH_MS = 60 * 60 * 1000;
const QUIET_REFRESH_MS = 15 * 60 * 1000;
const CCN_CHANNELS = new Set(['1424776504767680722','1514248684575920160','1460973469150875720','1424776415286657136']);
let ccnSending = false;
let ccnQueueChanges = Promise.resolve();
function ccnLocked(action){const result=ccnQueueChanges.then(action);ccnQueueChanges=result.catch(()=>{});return result;}
function ccnSenderAllowed(sender,payload){
  try{
    const tabUrl=new URL(sender.url || sender.tab?.url || '');
    const source=new URL(payload.sourceUrl);
    const parts=tabUrl.pathname.split('/');
    return tabUrl.origin==='https://discord.com' && parts[2]==='1410547930250612828' && CCN_CHANNELS.has(parts[3]) && source.origin===tabUrl.origin && source.pathname.startsWith('/channels/1410547930250612828/'+parts[3]+'/') && /^\d+$/.test(source.pathname.split('/')[4] || '');
  }catch{return false;}
}
async function queueCcnReport(payload){
  if((await chrome.storage.local.get('ccnBridgeEnabled')).ccnBridgeEnabled===false)return {ok:false,paused:true};
  const revision=JSON.stringify(payload);
  await ccnLocked(async()=>{
    const saved=await chrome.storage.local.get(['ccnPending','ccnSent']);
    const sent=saved.ccnSent || {};
    if(sent[payload.sourceUrl]===revision)return;
    const pending=(saved.ccnPending || []).filter(row=>row.payload.sourceUrl!==payload.sourceUrl);
    pending.push({payload,revision,attempts:0,nextTry:0});
    await chrome.storage.local.set({ccnPending:pending.slice(-100)});
  });
  flushCcnReports().catch(()=>{});
  return {ok:true,queued:true};
}
async function flushCcnReports(){
  if(ccnSending)return;
  if((await chrome.storage.local.get('ccnBridgeEnabled')).ccnBridgeEnabled===false)return;
  ccnSending=true;
  try{
    while(true){
      const stored=await chrome.storage.local.get('ccnPending');
      const row=(stored.ccnPending || []).find(r=>r.nextTry<=Date.now());
      if(!row)break;
      const result=await post('/api/ccn/news-report',row.payload).catch(()=>({ok:false,status:503,error:'Connection temporarily unavailable'}));
      await ccnLocked(async()=>{
        const current=await chrome.storage.local.get(['ccnPending','ccnSent']);
        const pending=current.ccnPending || [];
        const matching=pending.find(r=>r.revision===row.revision);
        if(!matching)return;
        let remaining=pending;
        if(result.ok || result.status===400 || Date.now()-Date.parse(row.payload.editedAt || row.payload.publishedAt)>48*3600000){
          remaining=pending.filter(r=>r.revision!==row.revision);
          if(result.ok){
            const sent=current.ccnSent || {};sent[row.payload.sourceUrl]=row.revision;
            await chrome.storage.local.set({ccnSent:Object.fromEntries(Object.entries(sent).slice(-500)),ccnBridgeLastSuccess:new Date().toISOString(),ccnBridgeError:null});
          }else await chrome.storage.local.set({ccnBridgeError:'A source report was rejected or expired; see the scheduled collector.'});
        }else{
          matching.attempts++;
          const auth=!result.configured || [401,403].includes(result.status);
          const delay=auth?10*60000:Math.min(3600000,30000*2**Math.min(matching.attempts,7)) + Math.random()*10000;
          matching.nextTry=Date.now()+Math.max(delay,result.retryAfterMs || 0);
          await chrome.storage.local.set({ccnBridgeError:auth?'Saved sensor connection needs attention.':'Temporary transfer failure; report retained for retry.'});
        }
        await chrome.storage.local.set({ccnPending:remaining});
      });
      if(!result.ok)break;
    }
  }finally{ccnSending=false;}
}

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
  const settings = await chrome.storage.local.get(['pokemonCenterHourlyRefreshEnabled','pokemonCenterRefreshPaused','lastAutomaticRefreshAt']);
  if (settings.pokemonCenterHourlyRefreshEnabled === false || settings.pokemonCenterRefreshPaused) return;
  const tabs = await chrome.tabs.query({url: 'https://www.pokemoncenter.com/*'});
  if (!tabs.length) return;
  const safeTabs = [];
  // Inspect every open page before reloading any. A queue pauses the whole sensor.
  for (const tab of tabs) {
    if (!Number.isInteger(tab.id)) continue;
    const pathname = new URL(tab.url).pathname;
    if (/\/(?:cart|checkout|account)(?:\/|$)/i.test(pathname)) continue;
    try {
      const results = await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
        const body = document.body?.innerText;
        if (!body || document.readyState !== 'complete') return true;
        return /queue|waiting[ -]?room|you are in line|your turn|estimated wait|verify you are human|access denied|something.s gone wrong|press and hold|temporarily blocked/i.test(body) || /queue|waiting[ -]?room/i.test(location.pathname + location.search) || Boolean(document.querySelector('.imperva-error-modal, #imperva-error-modal, iframe[src*="captcha"], iframe[src*="queue-it"]'));
      }});
      if (!results.length || results.some(result=>result.result !== false)) {
        await chrome.storage.local.set({pokemonCenterRefreshPaused:true});
        return;
      }
      safeTabs.push(tab.id);
    } catch {
      await chrome.storage.local.set({pokemonCenterRefreshPaused:true});
      return;
    }
  }
  if (Date.now() - Number(settings.lastAutomaticRefreshAt || 0) < ACTIVE_REFRESH_MS) return;
  // Only one open product page per hour; never open extra tabs or alternate links.
  if (safeTabs.length) {
    await chrome.tabs.reload(safeTabs[0]);
    await chrome.storage.local.set({lastAutomaticRefreshAt:Date.now()});
  }
}
async function refreshTargetTabs(){
 const config=await chrome.storage.local.get(['targetRefreshEnabled','targetRefreshTimes','targetRefreshPaused']);
 if(config.targetRefreshEnabled===false)return;
 const times=config.targetRefreshTimes || {};const paused=config.targetRefreshPaused || {};
 const tabs=await chrome.tabs.query({url:'https://www.target.com/p/*'});
 for(const tab of tabs){
  if(!Number.isInteger(tab.id) || paused[tab.id] || Date.now()-Number(times[tab.id] || 0)<5*60000)continue;
  try{
   const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
    const text=document.body?.innerText || '';
    if(/virtual queue|you are in line|waiting room|estimated wait|verify you are human|captcha|press and hold|access denied|unusual traffic|too many requests/i.test(text))return 'protection';
    if(/\/(?:cart|checkout|account)(?:\/|$)/i.test(location.pathname) || document.querySelector('input:focus,textarea:focus,select:focus'))return 'busy';
    return 'ready';
   }});
   if(!results.length)continue;
   if(results.some(r=>r.result==='protection')){paused[tab.id]=new Date().toISOString();continue;}
   if(results.some(r=>r.result!=='ready'))continue;
   await chrome.tabs.reload(tab.id);times[tab.id]=Date.now();
  }catch{}
 }
 const open=new Set(tabs.map(t=>String(t.id)));for(const id of Object.keys(times))if(!open.has(id))delete times[id];for(const id of Object.keys(paused))if(!open.has(id))delete paused[id];
 await chrome.storage.local.set({targetRefreshTimes:times,targetRefreshPaused:paused});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({pokemonCenterHourlyRefreshEnabled:true,lastAutomaticRefreshAt:Date.now()});
  chrome.alarms.create(REFRESH_ALARM, {
    periodInMinutes: 1
  });
  attachOpenPokemonRestocksSensors().catch(() => {});
  chrome.tabs.query({url:'https://discord.com/channels/1410547930250612828/*'}).then(tabs=>Promise.all(tabs.filter(tab=>CCN_CHANNELS.has(new URL(tab.url).pathname.split('/')[3])).map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id},files:['ccn-discord.js']}).catch(()=>{})))).catch(()=>{});
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
    flushCcnReports().catch(() => {});
    refreshPokemonCenterTabs().catch(() => {}); // Hourly; Target reloads remain disabled.

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
    body,
    retryAfterMs: (()=>{const value=response.headers.get('retry-after');if(!value)return 0;const seconds=Number(value);return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(value)-Date.now()) || 0;})()
  };
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if(message.kind==='ccnNewsReport'){
      if(!ccnSenderAllowed(sender,message.payload || {})){sendResponse({ok:false,error:'Source channel not authorized'});return;}
      queueCcnReport(message.payload).then(sendResponse).catch(()=>sendResponse({ok:false,error:'Could not retain report'}));
      return true;
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
            : message.kind === "targetObservation"
              ? "/api/target/browser-observation"
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
