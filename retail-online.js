"use strict";
const cheerio = require("cheerio");
const push = require("./push");
const {Pool}=require("pg");
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000}):null;
let storageReady=false;
async function restore() {
  if(!pool)return;
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS retail_online_observations (retailer TEXT NOT NULL, url TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY(retailer,url))");
    const result=await pool.query("SELECT retailer,url,data FROM retail_online_observations");
    for(const row of result.rows)if(configs[row.retailer] && productUrl(row.retailer,row.url))getState(row.retailer).items.set(row.url,row.data);
    storageReady=true;
  }catch(error){console.error("Online monitor storage unavailable:",error.message);}
}
async function persist(item) {
  if(!storageReady)return;
  await pool.query("INSERT INTO retail_online_observations(retailer,url,data) VALUES($1,$2,$3) ON CONFLICT(retailer,url) DO UPDATE SET data=EXCLUDED.data",[item.retailer,item.url,JSON.stringify(item)]).catch(error=>console.error("Online observation storage failed:",error.message));
}
const configs = {
  sams: {label:"Sam's Club", host:"www.samsclub.com", search:"https://www.samsclub.com/s/Pokemon", locator:"https://www.samsclub.com/club-finder"},
  costco: {label:"Costco", host:"www.costco.com", search:"https://www.costco.com/s?keyword=pokemon", locator:"https://www.costco.com/w/-/locations"},
  target: {label:"Target", host:"www.target.com", search:"https://www.target.com/s?searchTerm=pokemon+trading+cards", locator:"https://www.target.com/store-locator/find-stores"}
};
const catalogs = require("./retail-catalog.json");
const states = new Map();
const requests = new Map();
function targetPriority(name) {
  return /ascended heroes|prismatic evolutions|destined rivals|30th|ultra[- ]premium collection|super[- ]premium collection|\bupc\b|\bspc\b/i.test(String(name || ""));
}
function targetWindow(now = new Date()) {
  const hour=Number(new Intl.DateTimeFormat("en-US", {timeZone:"America/Chicago", hour:"numeric",hourCycle:"h23"}).format(now));
  const reportedWindow=require('./target-drop-reports.json').some(r=>r.priorityStartsAt && r.priorityEndsAt && now.getTime()>=Date.parse(r.priorityStartsAt) && now.getTime()<Date.parse(r.priorityEndsAt));
  return hour===2 || reportedWindow;
}
function isTcg(name) {
  const value = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!/pokemon/.test(value)) return false;
  if (/plush|shirt|hoodie|sneaker|lego|video game|funko|playmat only|sleeves|deck box only|card storage/.test(value)) return false;
  if (/binder/.test(value) && !/binder collection/.test(value)) return false;
  if (/deck box|playmat|protector|album/.test(value) && !/booster|elite trainer|premium collection|collection box|packs|\btin|bundle|promo/.test(value)) return false;
  return /booster|elite trainer|\betb\b|\bupc\b|\bspc\b|premium collection|collection box|binder collection|poster collection|\btins?\b|blister|battle deck|theme deck|promo card|trading card game|\btcg\b/.test(value);
}
function validUrl(retailer, value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.hostname !== configs[retailer]?.host || u.port || u.username || u.password) return null;
    u.hash = "";
    u.search = "";
    return u.href;
  } catch { return null; }
}
function productUrl(retailer, value) {
  const url = validUrl(retailer, value);
  if (!url) return null;
  const path = new URL(url).pathname;
  return ({sams:/^\/(ip|p)\/.+/, costco:/^\/p\/.+|\.product\.[\d]+\.html$/, target:/^\/p\/(?:.+\/)?-\/A-\d+$/}[retailer]).test(path) ? url : null;
}
function getState(retailer) {
  if (!configs[retailer]) throw new Error("Unsupported retailer");
  if (!states.has(retailer)) states.set(retailer, {retailer, running:false, items:new Map(), events:[], priorityWindow:false, error:null, lastRun:null, lastSuccess:null, lastDiscovery:0, nextCheck:0});
  return states.get(retailer);
}
async function page(url) {
  const cached = requests.get(url);
  if (cached?.until > Date.now()) {
    if (cached.error) throw new Error(cached.error);
    return cached.html;
  }
  if (cached?.promise) return cached.promise;
  const pending = (async () => {
    try {
      let response; let current=url;
      for(let redirects=0; redirects<=3; redirects++) {
        response = await fetch(current, {headers:{"User-Agent":"LegendsDen-PokemonMonitor/1.0 (+https://pokemon-live-backend.onrender.com)", accept:"text/html"}, redirect:"manual", signal:AbortSignal.timeout(15000)});
        if (![301,302,303,307,308].includes(response.status)) break;
        const next=new URL(response.headers.get("location"),current);
        await response.body?.cancel();
        if(next.protocol!=="https:" || next.hostname!==new URL(url).hostname || next.port || next.username || next.password) throw new Error("Retailer redirected outside its public website");
        current=next.href;
      }
      if (!response.ok) {
        const error = new Error(`Public page returned HTTP ${response.status}`);
        error.status = response.status;
        error.retryAfter = response.headers.get("retry-after");
        throw error;
      }
      const reader = response.body.getReader();
      let bytes = 0; const parts = [];
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error("Public page exceeds size limit"); }
        parts.push(Buffer.from(chunk.value));
      }
      const html = Buffer.concat(parts).toString("utf8");
      if (/access denied|verify you are human|captcha|robot or human/i.test(html) && !/"@type"\s*:\s*"Product"/.test(html)) throw new Error("Public page access is restricted");
      requests.set(url, {html, fetchedAt:new Date().toISOString(), until:Date.now() + (new URL(url).hostname === configs.target.host && targetWindow() ? 5 : 10) * 60000});
      if(requests.size>300)requests.delete(requests.keys().next().value);
      return html;
    } catch (error) {
      const failures = (cached?.failures || 0) + 1;
      const delay = [401,403].includes(error.status) ? 6 * 3600000 : Math.min(3600000, 60000 * 2 ** Math.min(failures,6)) + Math.random()*30000;
      const retry = Number(error.retryAfter) * 1000 || Math.max(0, Date.parse(error.retryAfter || "") - Date.now()) || 0;
      requests.set(url, {error:error.message, failures, until:Date.now() + Math.max(delay,retry)});
      throw error;
    }
  })();
  requests.set(url, {...cached, promise:pending});
  return pending;
}
function parseProduct(retailer, url, html) {
  const $ = cheerio.load(html);
  const nodes = [];
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    if ([].concat(value["@type"] || []).includes("Product")) nodes.push(value);
    if (value["@graph"]) walk(value["@graph"]);
  }
  $('script[type="application/ld+json"]').each((_,element) => {try { walk(JSON.parse($(element).text())); } catch {} });
  const product = nodes.find(p => isTcg(p.name));
  if (!product) return null;
  const offers = [].concat(product.offers || []);
  const offer = offers.find(o => o && typeof o === "object" && !/InStoreOnly|LimitedAvailability/.test(String(o.availability))) || {};
  const seller = String(offer.seller?.name || "");
  if (seller && !seller.toLowerCase().includes(configs[retailer].label.toLowerCase())) return null;
  // Target marketplace offers require explicit seller attribution.
  const verifiedSeller = retailer !== "target" || /^target$/i.test(seller);
  if (retailer === "target" && !verifiedSeller) return null;
  const availability = String(offer.availability || "").split("/").pop();
  const status = !verifiedSeller ? "unknown" : ({InStock:"instock", OutOfStock:"out", SoldOut:"out", PreOrder:"preorder", PreSale:"preorder", Discontinued:"out"}[availability] || "unknown");
  const price = offer.price != null && offer.price !== "" && Number.isFinite(Number(offer.price)) ? Number(offer.price) : null;
  const image = [].concat(product.image || [])[0];
  const imageUrl = typeof image === "object" ? image?.url : image;
  const sku = String(product.sku || product.productID || new URL(url).pathname.match(/(?:A-|\/)(\d{6,})(?:$|\.)/)?.[1] || "");
  return {retailer, channel:"online", name:product.name, productId:sku || url, sku:sku || null, url, image:/^https:\/\//.test(imageUrl || "") ? imageUrl : null, price, status, rawStatus:verifiedSeller ? availability || "Not published" : "Seller not verified", quantity:offer.inventoryLevel?.value != null && Number.isFinite(Number(offer.inventoryLevel.value)) ? Number(offer.inventoryLevel.value) : null, releaseDate:product.releaseDate || offer.availabilityStarts || null, shippingPostalCode:null, shippingEligible:null, source:"public_product_structured_data", observedAt:new Date().toISOString(), seller:seller || null, sellerVerified:verifiedSeller};
}
function catalog(retailer) {
  const state = getState(retailer);
  const entries = new Map((catalogs[retailer] || []).map(item => [item.url || item.query, item]));
  for (const item of state.items.values()) {
    const known=entries.get(item.url) || {};
    entries.set(item.url, {...known,label:known.label || item.name,query:known.query || item.name,url:item.url,sku:item.sku,image:item.image || known.image,price:item.price,discovered:true,stage:item.availability === "available" ? "current" : known.stage || "current",evidence:item.availability === "available" ? "Public retailer availability observed" : known.evidence || "Retailer listing"});
  }
  return [...entries.values()];
}
async function check(retailer, url) {
  if (retailer === 'target') throw new Error('Target shopping checks are disabled; use attributed Discord reports.');
  const safe = productUrl(retailer,url);
  if (!safe) throw new Error("Enter an individual product link from this retailer");
  const state = getState(retailer);
  const item = parseProduct(retailer,safe,await page(safe));
  if (!item) throw new Error("No card-containing Pokémon product data was published on this page");
  item.observedAt=requests.get(safe)?.fetchedAt || item.observedAt;
  return acceptObservation(retailer,safe,item);
}
async function acceptObservation(retailer,safe,item){
  const state=getState(retailer);
  const before = state.items.get(safe);
  item.patternHistory=before?.patternHistory || [];
  state.items.set(safe,item);
  if (["target","costco","sams"].includes(retailer)) {
    item.priority = targetPriority(item.name);
    item.priority = retailer !== "target" || item.priority;
    const changes=[];
    if (before && before.source === item.source) {
      for (const [field,type] of [["price","PRICE_CHANGE"],["image","IMAGE_CHANGE"],["sku","SKU_CHANGE"],["status","AVAILABILITY_CHANGE"],["name","TITLE_CHANGE"],["releaseDate","RELEASE_DATE_CHANGE"],["quantity","PUBLISHED_QUANTITY_CHANGE"]]) {
        if (before[field] != null && item[field] != null && before[field] !== item[field]) changes.push({type,field,before:before[field],after:item[field]});
      }
    } else if (before && before.source === "public_catalog_link") changes.push({type:"LISTING_VERIFIED"});
    if (["instock","preorder"].includes(item.status) && (!before || before.status !== item.status) && !changes.some(c=>c.type==="AVAILABILITY_CHANGE")) changes.push({type:"AVAILABILITY_CHANGE",after:item.status});
    item.patternHistory=[...item.patternHistory,...changes.map(change=>({...change,observedAt:item.observedAt,detectedAt:new Date().toISOString(),source:item.source}))].filter(e=>Date.now()-Date.parse(e.observedAt)<28*86400000).slice(-200);
    for (const change of changes) state.events.unshift({...change,name:item.name,url:safe,observedAt:item.observedAt,priority:item.priority,detail:"Public listing change; does not confirm an upcoming drop."});
    state.events=state.events.filter(event=>Date.now()-Date.parse(event.observedAt)<24*3600000).slice(0,100);
    if (changes.length && item.priority && !["instock","preorder"].includes(item.status) && Date.now()-(before?.lastMovementAlertAt || 0)>30*60000) {
      item.lastMovementAlertAt=Date.now();
      await push.broadcast({title:`${configs[retailer].label} — Public listing movement`,body:`${item.name} · ${changes.map(c=>c.type.replace(/_/g," ").toLowerCase()).join(", ")} · Drop not confirmed`,url:safe,tag:`${retailer}-movement-${item.productId}`}).catch(()=>{});
    } else item.lastMovementAlertAt=before?.lastMovementAlertAt || null;
  }
  const available=["instock","preorder"].includes(item.status);
  const transition=available && (!before || before.status !== item.status);
  item.alertRetryPending=available && Boolean(before?.alertRetryPending);
  item.alertRetryCount=transition?0:before?.alertRetryCount || 0;
  if (transition || item.alertRetryPending && item.alertRetryCount<1) {
    if(!transition)item.alertRetryCount++;
    const delivery=await push.broadcast({title:`${configs[retailer].label} — Online TCG alert`,body:`${item.name} · ${item.status === "preorder" ? "Pre-order offer" : "Listed in stock"} · Confirm shipping to your ZIP`,url:safe,tag:`online-${retailer}-${item.productId}`});
    item.alertRetryPending=!delivery.sent && (delivery.subscriptions>0 || !delivery.ok);
    state.lastAlert={at:new Date().toISOString(),name:item.name,sent:delivery.sent,failed:delivery.failed,subscriptions:delivery.subscriptions,observedAt:item.observedAt,sendDurationMs:delivery.durationMs,meaning:"Accepted by push provider; phone display not confirmed"};
    if (!delivery.ok || !delivery.sent) console.error(`${configs[retailer].label} online alert delivery incomplete`,delivery);
  }
  await persist(item);
  return item;
}
async function poll(retailer) {
  if (retailer === 'target') return;
  const state = getState(retailer);
  const priorityWindow=retailer === "target" && targetWindow();
  if (state.running || (state.nextCheck > Date.now() && !(priorityWindow && !state.priorityWindow))) return;
  state.priorityWindow=priorityWindow;
  state.running = true; state.lastRun = new Date().toISOString();
  state.nextCheck = Date.now() + (priorityWindow ? 5 : 30)*60000;
  try {
    if (Date.now() - state.lastDiscovery > (priorityWindow || ["costco","sams"].includes(retailer) ? 30*60000 : 24*3600000)) {
      state.lastDiscovery = Date.now();
      try {
        const $ = cheerio.load(await page(configs[retailer].search));
        $("a[href]").each((_,el) => {
          let link; try {link = productUrl(retailer,new URL($(el).attr("href"),configs[retailer].search).href);} catch {}
          const name = $(el).text().trim() || $(el).find("img").attr("alt");
          if (link && isTcg(name) && state.items.size < 100 && !state.items.has(link)) state.items.set(link,{name,url:link,status:"unknown",channel:"online",retailer,quantity:null,source:"public_catalog_link",observedAt:new Date().toISOString()});
        });
        state.discoveryError=null;state.lastDiscoverySuccess=new Date().toISOString();
      } catch(error) {state.discoveryError=error.message;state.error = error.message;}
    }
    let urls = [...new Set([...catalog(retailer).map(i => i.url), ...(process.env[retailer.toUpperCase()+"_PUBLIC_WATCH_URLS"] || "").split(/[\n,]/)])].filter(url => productUrl(retailer,url));
    if (retailer === "target") {
      const names=new Map(catalog(retailer).map(item=>[item.url,item.query || item.label]));
      urls.sort((a,b)=>Number(targetPriority(state.items.get(b)?.name || names.get(b)))-Number(targetPriority(state.items.get(a)?.name || names.get(a))));
    }
    const offset=state.cursor || 0;
    const batch=[...urls.slice(offset),...urls.slice(0,offset)].slice(0,12);
    state.cursor=urls.length ? (offset+batch.length)%urls.length : 0;
    state.coverage={knownListings:urls.length,scheduledThisCycle:batch.length};
    let successes=0; const errors=[];
    for (const url of batch) {try {await check(retailer,url);if(state.checkFailures)delete state.checkFailures[url];successes++;} catch(error) {errors.push(error.message);state.checkFailures ||= {};state.checkFailures[url]={at:new Date().toISOString(),error:error.message};}}
    state.coverage.successfulThisCycle=successes;state.coverage.failedThisCycle=errors.length;state.lastCompletedAt=new Date().toISOString();
    if (successes) state.lastSuccess = new Date().toISOString();
    state.error = errors.length || state.discoveryError ? [...new Set([...errors,...(state.discoveryError?[state.discoveryError]:[])])].join("; ") : successes ? null : state.error;
  } finally {state.running=false;}
}
function snapshot(retailer) {
  const state=getState(retailer);
  return {...state, health:state.error?"limited":!state.lastSuccess?"waiting":Date.now()-Date.parse(state.lastSuccess)>60*60000?"stale":"responding", items:[...state.items.values()].map(item => ({...item, stale:item.source==="browser_product_page"?Date.now()-Date.parse(item.observedAt)>5*60000:Boolean(requests.get(item.url)?.error || state.checkFailures?.[item.url]) || Date.now()-Date.parse(item.observedAt)>60*60000})), upcoming:retailer === "target" ? require("./target-drop-reports.json").filter(report=>productUrl("target",report.url) && /^https:\/\//.test(report.sourceUrl || "") && report.name && report.sourceName && report.expectedWindow && Date.parse(report.expiresAt)>Date.now() && Date.parse(report.reportedAt)<=Date.now()) : [], catalog:catalog(retailer), searchUrl:configs[retailer].search, locatorUrl:configs[retailer].locator};
}
async function start() {
  await restore();
  const tick=() => Promise.allSettled(Object.keys(configs).map(poll));
  tick(); const timer=setInterval(tick,60000);timer.unref();
}
async function browserObservation(input){
 const safe=productUrl('target',input.url);if(!safe || !isTcg(input.title))throw new Error('Verified Target card product required');
 const status=({available:'instock',unavailable:'out',preorder:'preorder',unknown:'unknown'})[input.availability];if(!status)throw new Error('Invalid availability');
 const verified=/^target$/i.test(input.seller || '');if(status!=="unknown" && !verified)throw new Error('Target seller not verified');
 const price=input.price!=null && Number.isFinite(Number(input.price)) && Number(input.price)>=0?Number(input.price):null;
 const item=await acceptObservation('target',safe,{retailer:'target',channel:'online',name:String(input.title).slice(0,240),url:safe,productId:new URL(safe).pathname.match(/A-(\d+)/)?.[1],sku:String(input.itemNumber || '').slice(0,40),status,rawStatus:status,image:String(input.image || '').startsWith('https://')?String(input.image).slice(0,1000):null,price,quantity:null,seller:verified?'Target':null,sellerVerified:verified,source:'browser_product_page',observedAt:new Date().toISOString()});
 getState('target').lastBrowserObservationAt=item.observedAt;return item;
}
module.exports={start,snapshot,check,isTcg,parseProduct,productUrl,targetPriority,browserObservation};
