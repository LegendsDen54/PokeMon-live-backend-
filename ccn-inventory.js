"use strict";
const {Pool}=require("pg");
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000}):null;
let ready;
async function storage(){
  if(!pool) throw new Error("Persistent CCN report storage is not configured");
  ready ||= pool.query("CREATE TABLE IF NOT EXISTS ccn_inventory_reports (retailer TEXT NOT NULL, product_id TEXT NOT NULL, zip TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY(retailer,product_id,zip))").catch(error=>{ready=null;throw error;});
  await ready;
}
function clean(input){
  if(!["costco","sams","bestbuy","dollargeneral","barnes"].includes(input.retailer) || !/^\d{5}$/.test(input.zip || "") || !/^[a-zA-Z0-9-]{1,40}$/.test(input.productId || "")) throw new Error("Invalid retailer, product identifier or ZIP");
  if(!input.name || !/^https:\/\/discord\.com\/channels\//.test(input.sourceUrl || "")) throw new Error("Product name and CCN message or channel link are required");
  const checked=Date.parse(input.checkedAt);
  if(!Number.isFinite(checked) || checked>Date.now()+60000 || Date.now()-checked>6*3600000) throw new Error("Report must have a recent actual check time");
  if(!["results","no_stock_reported","checker_error"].includes(input.result)) throw new Error("Invalid checker result");
  const quantity=value=>value==null?null:Number.isInteger(value)&&value>=0?value:null;
  const locations=(input.locations || []).slice(0,100).map(row=>({name:String(row.name || "").slice(0,150),address:String(row.address || "").slice(0,250),onOrder:quantity(row.onOrder),inTransit:quantity(row.inTransit),onHand:quantity(row.onHand),distanceMiles:Number.isFinite(row.distanceMiles)&&row.distanceMiles>=0?row.distanceMiles:null,status:String(row.status || "Not published").slice(0,100)}));
  let image=null;
  try{const u=new URL(input.image);if(u.protocol==="https:" && /(?:^|\.)(?:costco\.com|samsclub\.com|scene7\.com|bbystatic\.com|bestbuy\.com|barnesandnoble\.com|bn\.com|wal\.co)$/.test(u.hostname))image=u.href;}catch{}
  return {retailer:input.retailer,productId:input.productId,zip:input.zip,name:String(input.name).slice(0,240),image,source:input.sourceUrl.startsWith("https://discord.com/channels/1367457689386356766/") ? "Rippin Packz stock checker" : "CCN / Zephyr stock checker",sourceUrl:input.sourceUrl,checkedAt:new Date(checked).toISOString(),result:input.result,detail:String(input.detail || "").slice(0,400),locations:input.result==="results"?locations:[]};
}
function quantityChanges(report,previous){
  const key=row=>(row.name+'|'+row.address).toLowerCase();
  const prior=new Map((previous?.locations || []).map(row=>[key(row),row]));
  return {...report,previousCheckedAt:previous?.checkedAt || null,locations:(report.locations || []).map(row=>{
    const before=prior.get(key(row));const changes={};
    for(const field of ['onHand','onOrder','inTransit'])if(Number.isInteger(row[field]) && Number.isInteger(before?.[field]))changes[field]={previous:before[field],current:row[field],delta:row[field]-before[field]};
    return {...row,quantityChanges:changes};
  })};
}
async function save(input){
  let report=clean(input);await checkerStorage();
  const manual=(await pool.query("SELECT requested_at FROM inventory_check_requests WHERE retailer=$1 AND product_id=$2 AND zip=$3",[report.retailer,report.productId,report.zip])).rows[0];
  report.privateManual=Boolean(manual && Date.parse(report.checkedAt)>=Date.parse(manual.requested_at));
  await pool.query('CREATE TABLE IF NOT EXISTS inventory_check_history (retailer TEXT NOT NULL, product_id TEXT NOT NULL, zip TEXT NOT NULL, checked_at TIMESTAMPTZ NOT NULL, data JSONB NOT NULL, PRIMARY KEY(retailer,product_id,zip,checked_at))');
  const client=await pool.connect();
  let alertLocations=[];
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[report.retailer+":"+report.productId+":"+report.zip]);
    const prior=await client.query("SELECT data FROM ccn_inventory_reports WHERE retailer=$1 AND product_id=$2 AND zip=$3",[report.retailer,report.productId,report.zip]);
    const previous=prior.rows[0]?.data;
    if(previous && Date.parse(previous.checkedAt)>=Date.parse(report.checkedAt)){
      await client.query("COMMIT");await require('./inventory-completion-push').completed(previous).catch(()=>{});return {report:previous,alertLocations:[]};
    }
    report=quantityChanges(report,previous);
    const stockStates={...(previous?.stockStates || {})};
    for(const row of report.locations){
      const locationKey=(row.name+"|"+row.address).toLowerCase();
      if(row.onHand===null)continue;
      if(row.onHand>0 && !(stockStates[locationKey]>0) && Date.now()-Date.parse(report.checkedAt)<90*60000 && (report.retailer!=="bestbuy" || row.distanceMiles!==null && row.distanceMiles<=20))alertLocations.push(row);
      stockStates[locationKey]=row.onHand;
    }
    report.stockStates=stockStates;
    if(previous)await client.query('INSERT INTO inventory_check_history(retailer,product_id,zip,checked_at,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[previous.retailer,previous.productId,previous.zip,previous.checkedAt,previous]);
    await client.query('INSERT INTO inventory_check_history(retailer,product_id,zip,checked_at,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[report.retailer,report.productId,report.zip,report.checkedAt,report]);
    await client.query("INSERT INTO ccn_inventory_reports(retailer,product_id,zip,data) VALUES($1,$2,$3,$4) ON CONFLICT(retailer,product_id,zip) DO UPDATE SET data=EXCLUDED.data",[report.retailer,report.productId,report.zip,report]);
    if(['results','no_stock_reported'].includes(report.result))await client.query('UPDATE inventory_search_viewers SET completed_at=$4 WHERE retailer=$1 AND product_id=$2 AND zip=$3 AND completed_at IS NULL AND requested_at<=$4',[report.retailer,report.productId,report.zip,report.checkedAt]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  await require('./inventory-completion-push').completed(report).catch(()=>console.warn('Private completion notification could not be queued'));
  return {report,alertLocations};
}
async function list(retailer,zip,viewer){
  await checkerStorage();
  const rows=await pool.query("SELECT data FROM ccn_inventory_reports WHERE retailer=$1 AND zip=$2",[retailer,zip]);
  const permitted=viewer?(await pool.query('SELECT product_id FROM inventory_search_viewers WHERE viewer_id=$1 AND retailer=$2 AND zip=$3',[viewer,retailer,zip])).rows.map(r=>r.product_id):[];
  return rows.rows.filter(row=>permitted.includes(row.data.productId)).map(row=>({...row.data,stale:Date.now()-Date.parse(row.data.checkedAt)>90*60000}));
}
module.exports={save,list};
async function newsStorage(){
  await storage();
  await pool.query("CREATE TABLE IF NOT EXISTS ccn_news_reports (source_url TEXT PRIMARY KEY, data JSONB NOT NULL)");
}
function cleanOnlineProducts(input){
  return (Array.isArray(input.products)?input.products:[]).slice(0,40).map(item=>{
    let url;try{url=new URL(item.url);}catch{return null;}
    const host=url.hostname.toLowerCase();const retailer=input.retailer;
    const game=/one[ -]?piece/i.test(item.name || '') || input.game==='onepiece' || retailer==='onepiece'?'onepiece':'pokemon';
    const allowed={target:['www.target.com','target.com'],walmart:['www.walmart.com','walmart.com'],pokemoncenter:['www.pokemoncenter.com','pokemoncenter.com'],sams:['www.samsclub.com','samsclub.com'],costco:['www.costco.com','costco.com']};
    const onePieceShop=game==='onepiece' && retailer==='onepiece' && /^(?:www\.)?(?:flipsidegaming\.com|smokeandmirrorshobby\.com|shop\.bandainamco-am\.com|en\.onepiece-cardgame\.com)$/.test(host);
    if(url.protocol!=='https:' || !(allowed[retailer]?.includes(host) || onePieceShop) || !item.name)return null;
    const name=String(item.name).slice(0,240);const seller=String(item.seller || '').slice(0,100);
    if(retailer==='target' && ((item.status!=='upcoming' && !/^target$/i.test(seller)) || (seller && !/^target$/i.test(seller)) || (game==='pokemon' && !/ascended heroes|prismatic|destined rivals|30th|(?:ultra|special|super)[- ]premium collection|\b(?:upc|spc)\b/i.test(name))))return null;
    const sellerVerified=retailer==='target'?/^target$/i.test(seller):retailer==='walmart'?Boolean(seller.trim()) && !/^(?:unknown|marketplace seller)$/i.test(seller.trim()):retailer==='sams'?/^sam'?s(?: club)?$/i.test(seller):retailer==='costco'?/^costco$/i.test(seller):retailer==='onepiece'?Boolean(seller):true;
    // Unknown sellers may appear as upcoming source reports, never as eligible stock.
    if(retailer==='walmart' && !sellerVerified && (seller || item.status!=='upcoming'))return null;
    if(!/pok[eé]mon|trading card|one[ -]?piece/i.test(name))return null;
    if(retailer==='pokemoncenter' && !/tcg|trading card|booster|trainer box|premium collection|(?:ex|v|gx) box|tin|battle deck/i.test(name))return null;
    const price=typeof item.price==='number' && Number.isFinite(item.price)&&item.price>0?item.price:null;
    const msrp=typeof item.msrp==='number' && Number.isFinite(item.msrp)&&item.msrp>0?item.msrp:null;
    const withinPriceRule=retailer==='walmart' || game==='onepiece'?sellerVerified && price!==null && msrp!==null && price<=msrp*1.5:sellerVerified;
    let image=null;try{const im=new URL(item.image);if(im.protocol==='https:' && (/(?:^|\.)(?:target\.com|scene7\.com|walmartimages\.com|pokemoncenter\.com|costco\.com|samsclub\.com)$/.test(im.hostname) || game==='onepiece' && /^(?:cdn\.shopify\.com|en\.onepiece-cardgame\.com)$/.test(im.hostname)))image=im.href;}catch{}
    const id=retailer==='onepiece'?url.pathname.match(/\/products?\/([^/]+)/)?.[1]:retailer==='target'?url.pathname.match(/\/A-(\d+)/)?.[1]:['walmart','sams'].includes(retailer)?url.pathname.match(/\/ip\/(?:[^/]+\/)?(\d+)\/?$/)?.[1]:retailer==='costco'?(url.pathname.match(/\/(\d{8,})\/?$/)?.[1] || url.pathname.match(/\.product\.(\d+)\.html/)?.[1] || (/^\d+$/.test(url.searchParams.get('partNumbers') || '')?url.searchParams.get('partNumbers'):null)):url.pathname.match(/\/product\/([^/]+)/)?.[1];
    if(!id)return null;
    if(retailer==='walmart')url=new URL('https://www.walmart.com/ip/'+id);
    if(retailer==='target')url=new URL('https://www.target.com/p/-/A-'+id);
    if(retailer!=='costco' || url.pathname!=='/CompareProductsDisplay')url.search='';url.hash='';
    return {name,game,retailer,url:url.href,image,seller,price,msrp,sellerVerified,withinPriceRule,status:['reported_available','upcoming','reported_unavailable','queue'].includes(item.status)?item.status:'upcoming',productId:id,expectedWindow:String(item.expectedWindow || '').slice(0,250),dropClassification:item.retailerConfirmed===true && item.confirmationUrl && String(item.confirmationUrl).startsWith(url.origin+'/')?'known':'potential'};
  }).filter(Boolean);
}
async function saveNews(input){
  const game=input.game==='onepiece' || input.retailer==='onepiece' || /one[ -]?piece/i.test(String(input.summary || '')+' '+JSON.stringify(input.products || []))?'onepiece':'pokemon';
  if(!/pok[eé]mon|one[ -]?piece|\btcg\b|prismatic|destined rivals|ascended heroes|30th.*(?:etb|collection|bundle)/i.test(String(input.summary || "")+" "+JSON.stringify(input.products || []))) throw new Error("Only Pokémon or One Piece TCG reports are accepted");
  const timestamp=Date.parse(input.publishedAt);
  const edited=input.editedAt==null?null:Date.parse(input.editedAt);
  const effective=edited ?? timestamp;
  const sources={'1410547930250612828':'CCN','1367457689386356766':'Rippin Packz','1190757531988000930':'The Poke Gang','1182136115981996033':'Pokemon Restocks & News'};
  if(game==='onepiece')Object.assign(sources,{'1322998319005433958':'Poke Restock','1202410810459037756':'Dark Rarity','646566276030005259':'Gamescape','1223272823959720008':'UVT Official','1381654330632830997':'The Syndicate','1369077918244012072':'Pokemon Restocks and Alerts','1185117808183484466':'MOM - TCGs and Collectibles'});
  const match=String(input.sourceUrl || '').match(/^https:\/\/discord\.com\/channels\/(\d+)\/\d+\/\d+$/);
  if(!match || !sources[match[1]] || !input.summary || !Number.isFinite(timestamp) || !Number.isFinite(effective) || timestamp>Date.now()+60000 || effective<timestamp || effective>Date.now()+60000 || Date.now()-effective>48*3600000) throw new Error("Provide an actual trusted Discord message link, summary and publication time; old messages need their recent actual edit time");
  const report={game,sourceUrl:input.sourceUrl,summary:String(input.summary).trim().slice(0,1000),retailer:["costco","sams","bestbuy","target","pokemoncenter","walmart","barnes","dollargeneral","onepiece"].includes(input.retailer)?input.retailer:null,publishedAt:new Date(timestamp).toISOString(),editedAt:edited===null?null:new Date(edited).toISOString(),updatedAt:new Date(effective).toISOString(),source:sources[match[1]],importedAt:new Date().toISOString()};
  report.products=cleanOnlineProducts(input);
  const detected=Date.parse(input.detectedAt);
  report.detectedAt=Number.isFinite(detected) && detected>=effective && detected<=Date.now()+60000?new Date(detected).toISOString():null;
  await newsStorage();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['ccn-news:'+report.sourceUrl]);
    const previous=(await client.query('SELECT data FROM ccn_news_reports WHERE source_url=$1',[report.sourceUrl])).rows[0]?.data;
    if(previous && Date.parse(previous.updatedAt || previous.publishedAt)>effective){await client.query('COMMIT');return {...previous,isNew:false,isUpdated:false};}
    const revision=require('crypto').createHash('sha256').update(JSON.stringify([report.retailer,report.summary,report.products])).digest('hex');
    const seen=previous?.seenRevisions || [];
    const changed=!previous || previous.summary!==report.summary || previous.retailer!==report.retailer || JSON.stringify(previous.products || [])!==JSON.stringify(report.products);
    const unseen=!seen.includes(revision);
    if(previous && !changed){await client.query('COMMIT');return {...previous,isNew:false,isUpdated:false};}
    report.seenRevisions=[...new Set([...seen,revision])].slice(-100);
    if(previous?.pipeline)report.pipeline=previous.pipeline;
    await client.query('INSERT INTO ccn_news_reports(source_url,data) VALUES($1,$2) ON CONFLICT(source_url) DO UPDATE SET data=EXCLUDED.data',[report.sourceUrl,report]);
    await client.query('COMMIT');
    return {...report,isNew:!previous,isUpdated:Boolean(previous && changed && unseen)};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function news(game=null){
  await newsStorage();
  const result=await pool.query("SELECT data FROM ccn_news_reports WHERE (COALESCE(data->>'updatedAt',data->>'publishedAt'))::timestamptz >= date_trunc('day',now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago' AND ($1::text IS NULL OR COALESCE(data->>'game',CASE WHEN data->>'summary' ~* 'one[ -]?piece' THEN 'onepiece' ELSE 'pokemon' END)=$1) ORDER BY (COALESCE(data->>'updatedAt',data->>'publishedAt'))::timestamptz DESC LIMIT 80",[game]);
  return result.rows.map(row=>row.data);
}
module.exports.saveNews=saveNews;module.exports.news=news;
let newsClaimsReady;
async function initializeNewsClaims(){
  if(!newsClaimsReady)newsClaimsReady=(async()=>{
    await pool.query('CREATE TABLE IF NOT EXISTS ccn_news_notification_claims (claim_key TEXT PRIMARY KEY, claimed_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const previous=await pool.query("SELECT data FROM ccn_news_reports WHERE (data->'pipeline'->'notification'->>'sent')::int>0 AND (data->'pipeline'->>'completedAt')::timestamptz>now()-interval '48 hours'");
    for(const {data} of previous.rows){
      const id=require('./source-alert-identity').identity({...data,editedAt:data.pipeline.sourceAt});
      for(const key of [id.revision,id.event])await pool.query('INSERT INTO ccn_news_notification_claims(claim_key,claimed_at) VALUES($1,$2) ON CONFLICT(claim_key) DO NOTHING',[key,data.pipeline.completedAt]);
    }
  })().catch(error=>{newsClaimsReady=null;throw error;});
  await newsClaimsReady;
}
module.exports.claimNewsNotification=async(report)=>{
  const identity=require('./source-alert-identity').identity(report);
  await initializeNewsClaims();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    for(const key of [identity.revision,identity.event].sort())await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
    const existing=await client.query('SELECT claim_key,claimed_at FROM ccn_news_notification_claims WHERE claim_key=ANY($1::text[])',[[identity.revision,identity.event]]);
    const prior=report.pipeline;
    const alreadyDelivered=prior?.notification?.sent>0 && Date.parse(prior.sourceAt)>=Date.parse(identity.at);
    const window=identity.event.includes(':drawing-results:')?24*3600000:90*60000;
    const duplicate=alreadyDelivered || existing.rows.some(row=>row.claim_key===identity.revision || Date.now()-Date.parse(row.claimed_at)<window);
    if(duplicate){await client.query('COMMIT');return {allowed:false,id:identity.id,reason:'same_source_revision_or_event'};}
    for(const key of [identity.revision,identity.event])await client.query('INSERT INTO ccn_news_notification_claims(claim_key) VALUES($1) ON CONFLICT(claim_key) DO UPDATE SET claimed_at=now()',[key]);
    await client.query('COMMIT');return {allowed:true,id:identity.id};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
};
module.exports.releaseNewsNotification=async(report)=>{
  const id=require('./source-alert-identity').identity(report);
  await pool.query('DELETE FROM ccn_news_notification_claims WHERE claim_key=ANY($1::text[])',[[id.revision,id.event]]);
};
module.exports.recordNewsReceipt=async(report,delivery,savedAt)=>{
  if(!report.isNew && !report.isUpdated)return null;
  const completedAt=new Date().toISOString(),sourceAt=report.updatedAt || report.publishedAt;
  const status=delivery?.skipped?'suppressed':delivery==null?'not_triggered':delivery.subscriptions===0?'no_connected_push_device':delivery.sent>0?'sent_to_push_service':delivery.ok===false?'failed':'suppressed';
  const pipeline={sourceAt,detectedAt:report.detectedAt || null,savedAt,completedAt,sourceToSavedMs:Date.parse(savedAt)-Date.parse(sourceAt),detectionToSavedMs:report.detectedAt?Math.max(0,Date.parse(savedAt)-Date.parse(report.detectedAt)):null,processingMs:Date.parse(completedAt)-Date.parse(savedAt),notification:{status,reason:delivery?.reason || null,eventId:delivery?.eventId || null,acceptedAt:delivery?.sent>0?delivery.completedAt || completedAt:null,sent:delivery?.sent || 0,failed:delivery?.failed || 0,subscriptions:delivery?.subscriptions ?? null,phoneDisplayConfirmed:false}};
  await pool.query("UPDATE ccn_news_reports SET data=jsonb_set(data,'{pipeline}',$2::jsonb) WHERE source_url=$1 AND data->>'updatedAt'=$3",[report.sourceUrl,JSON.stringify(pipeline),report.updatedAt]);return pipeline;
};
module.exports.newsReceipts=async()=>{await newsStorage();return (await pool.query("SELECT data->>'sourceUrl' AS \"sourceUrl\",data->>'source' AS source,data->>'retailer' AS retailer,data->'pipeline' AS pipeline FROM ccn_news_reports WHERE data ? 'pipeline' ORDER BY data->'pipeline'->>'completedAt' DESC LIMIT 20")).rows;};

async function onlineProducts(retailer){
  await newsStorage();
  const rows=await pool.query("SELECT data FROM ccn_news_reports WHERE (data->>'retailer'=$1 OR $1='onepiece' AND data->>'game'='onepiece') AND (COALESCE(data->>'updatedAt',data->>'publishedAt'))::timestamptz > now()-interval '7 days' ORDER BY (COALESCE(data->>'updatedAt',data->>'publishedAt'))::timestamptz DESC LIMIT 200",[retailer]);
  const posts=rows.rows.map(row=>row.data);const latest=new Map();
  for(const post of posts)for(const product of post.products || []){
    if(retailer==='onepiece'?(post.game!=='onepiece' && product.game!=='onepiece'):(post.game==='onepiece' || product.game==='onepiece'))continue;
    const productKey=retailer==='walmart'?String(product.productId || product.url):product.url;
    if(latest.has(productKey))continue;
    latest.set(productKey,{...product,...(product.productId==='20964873413' && post.retailer==='walmart'?{image:'https://pokemon-live-backend.onrender.com/delta-reign-illustration.png',imageLabel:'Custom illustration · official product art unavailable'}:{}),source:post.source,sourceUrl:post.sourceUrl,reportedAt:post.updatedAt || post.publishedAt,stale:Date.now()-Date.parse(post.updatedAt || post.publishedAt)>30*60000});
  }
  const chicagoDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  const today=chicagoDay(Date.now());
  return [...latest.values()].filter(p=>{
    const dailyPotential=(p.status==='upcoming' || retailer==='onepiece') && p.dropClassification!=='known' && !p.expectedWindow;
    return (!dailyPotential || chicagoDay(p.reportedAt)===today) && (retailer==='target' || p.status!=='reported_unavailable') && (p.withinPriceRule || p.price===null || p.msrp===null);
  });
}
module.exports.onlineProducts=onlineProducts;

async function onlineAlerts(report){
  await newsStorage();
  await pool.query('CREATE TABLE IF NOT EXISTS ccn_online_alert_states (product_key TEXT PRIMARY KEY, data JSONB NOT NULL)');
  const client=await pool.connect();const alerts=[];
  try{
    await client.query('BEGIN');
    for(const item of [...(report.products || [])].sort((a,b)=>a.url.localeCompare(b.url))){
      const key=report.retailer+':'+item.url;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
      const previous=(await client.query('SELECT data FROM ccn_online_alert_states WHERE product_key=$1',[key])).rows[0]?.data;
      const at=Date.parse(report.updatedAt || report.publishedAt);
      if(previous && Date.parse(previous.reportedAt)>at)continue;
      const early=item.status==='upcoming';
      const eligibility=item.withinPriceRule===true;
      const chicagoDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
      const freshDay=early && previous && chicagoDay(previous.reportedAt)!==chicagoDay(at);
      const changed=!previous || previous.status!==item.status || previous.eligible!==eligibility || previous.expectedWindow!==item.expectedWindow || freshDay;
      const priceExcluded=(report.retailer==='walmart' || report.game==='onepiece') && item.price!==null && item.msrp!==null && item.price>item.msrp*1.5;
      const sourceAnnouncement=['upcoming','reported_available','queue'].includes(item.status);
      if(changed && !priceExcluded && sourceAnnouncement && Date.now()-at<(early || !eligibility?90:30)*60000)alerts.push({...item,alertKind:early?'early':eligibility?'stock':'source'});
      await client.query('INSERT INTO ccn_online_alert_states(product_key,data) VALUES($1,$2) ON CONFLICT(product_key) DO UPDATE SET data=EXCLUDED.data',[key,{status:item.status,eligible:eligibility,expectedWindow:item.expectedWindow,reportedAt:new Date(at).toISOString()}]);
    }
    await client.query('COMMIT');return alerts;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
module.exports.onlineAlerts=onlineAlerts;

async function dgQueueStorage(){await storage();await pool.query("CREATE TABLE IF NOT EXISTS dg_check_requests (product_id TEXT NOT NULL, zip TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(product_id,zip))");}
module.exports.requestDg=async(productId,zip)=>{await dgQueueStorage();await pool.query("INSERT INTO dg_check_requests(product_id,zip) VALUES($1,$2) ON CONFLICT(product_id,zip) DO UPDATE SET requested_at=now() WHERE dg_check_requests.requested_at < now()-interval '1 hour' OR EXISTS (SELECT 1 FROM ccn_inventory_reports r WHERE r.retailer='dollargeneral' AND r.product_id=EXCLUDED.product_id AND r.zip=EXCLUDED.zip AND (r.data->>'checkedAt')::timestamptz>=dg_check_requests.requested_at)",[productId,zip]);};
module.exports.pendingDg=async()=>{await dgQueueStorage();const r=await pool.query("SELECT q.product_id AS \"productId\",q.zip,q.requested_at AS \"requestedAt\" FROM dg_check_requests q LEFT JOIN ccn_inventory_reports r ON r.retailer='dollargeneral' AND r.product_id=q.product_id AND r.zip=q.zip WHERE (r.data IS NULL OR (r.data->>'checkedAt')::timestamptz<q.requested_at) ORDER BY q.requested_at LIMIT 10");return r.rows;};
module.exports.dgRequestStatus=async(productId,zip)=>{
  await dgQueueStorage();
  const {rows}=await pool.query('SELECT q.requested_at AS "requestedAt", r.data FROM dg_check_requests q LEFT JOIN ccn_inventory_reports r ON r.retailer=\'dollargeneral\' AND r.product_id=q.product_id AND r.zip=q.zip WHERE q.product_id=$1 AND q.zip=$2',[productId,zip]);
  if(!rows.length)return {status:'idle'};
  const row=rows[0],completed=row.data && Date.parse(row.data.checkedAt)>=Date.parse(row.requestedAt);
  return {requestedAt:row.requestedAt,status:completed?(row.data.result==='checker_error'?'checker_error':'completed'):Date.now()-Date.parse(row.requestedAt)>3600000?'expired':'queued',checkedAt:completed?row.data.checkedAt:null};
};

async function checkerStorage(){
  await storage();
  await pool.query("CREATE TABLE IF NOT EXISTS inventory_search_viewers (viewer_id TEXT NOT NULL, retailer TEXT NOT NULL, product_id TEXT NOT NULL, zip TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(viewer_id,retailer,product_id,zip))");
  await pool.query("ALTER TABLE inventory_search_viewers ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ");
  await pool.query("CREATE TABLE IF NOT EXISTS inventory_check_requests (retailer TEXT NOT NULL, product_id TEXT NOT NULL, zip TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), priority INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(retailer,product_id,zip))");
  await pool.query("ALTER TABLE inventory_check_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ");
  await pool.query("CREATE TABLE IF NOT EXISTS inventory_checker_cooldowns (retailer TEXT PRIMARY KEY, available_at TIMESTAMPTZ NOT NULL, source_url TEXT NOT NULL)");
}
function checkerInput(retailer,productId,zip){
  if(!['bestbuy','costco','sams','dollargeneral','barnes'].includes(retailer)||!/^\d{5}$/.test(zip)||!/^[A-Za-z0-9-]{1,40}$/.test(productId))throw Error('Choose a retailer, valid product identifier and five-digit ZIP');
}
async function personalSearchWindow(retailer,viewer,db=pool){
  if(!viewer || !['sams','costco'].includes(retailer))return null;
  const row=(await db.query("SELECT max(requested_at)+interval '1 hour' AS available_at FROM inventory_search_viewers WHERE viewer_id=$1 AND retailer=$2",[viewer,retailer])).rows[0];
  return row?.available_at && Date.parse(row.available_at)>Date.now()?row.available_at:null;
}
module.exports.requestInventory=async(retailer,productId,zip,viewer)=>{
  checkerInput(retailer,productId,zip);await checkerStorage();
  if(!viewer)throw Error('Private search session unavailable');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['manual-viewer:'+viewer+':'+retailer]);
    const currentPersonalWindow=await personalSearchWindow(retailer,viewer,client);
    if(currentPersonalWindow){await client.query('COMMIT');return {status:'personal_cooldown',personalAvailableAt:currentPersonalWindow,availableAt:currentPersonalWindow};}
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['manual-check:'+retailer+':'+productId+':'+zip]);
    const cooldown=(await client.query('SELECT available_at FROM inventory_checker_cooldowns WHERE retailer=$1 AND available_at>now()',[retailer])).rows[0];
    if(cooldown){await client.query('COMMIT');return {status:'cooldown',checkerAvailableAt:cooldown.available_at,availableAt:cooldown.available_at};}
    const accepted=(await client.query('INSERT INTO inventory_search_viewers(viewer_id,retailer,product_id,zip) VALUES($1,$2,$3,$4) ON CONFLICT(viewer_id,retailer,product_id,zip) DO UPDATE SET requested_at=now(),completed_at=NULL RETURNING requested_at',[viewer,retailer,productId,zip])).rows[0];
    const personalAvailableAt=['costco','sams'].includes(retailer)?new Date(Date.parse(accepted.requested_at)+3600000).toISOString():null;
    const existing=(await client.query("SELECT q.requested_at FROM inventory_check_requests q LEFT JOIN ccn_inventory_reports r ON r.retailer=q.retailer AND r.product_id=q.product_id AND r.zip=q.zip WHERE q.retailer=$1 AND q.product_id=$2 AND q.zip=$3 AND q.cancelled_at IS NULL AND (r.data IS NULL OR (r.data->>'checkedAt')::timestamptz<q.requested_at)",[retailer,productId,zip])).rows[0];
    if(existing){await client.query('COMMIT');return {status:'queued',deduplicated:true,requestedAt:accepted.requested_at,personalAvailableAt,availableAt:personalAvailableAt};}
    const row=(await client.query('INSERT INTO inventory_check_requests(retailer,product_id,zip,priority) VALUES($1,$2,$3,1) ON CONFLICT(retailer,product_id,zip) DO UPDATE SET requested_at=now(),priority=1,cancelled_at=NULL RETURNING requested_at',[retailer,productId,zip])).rows[0];
    await client.query('COMMIT');return {status:'queued',deduplicated:false,requestedAt:row.requested_at,personalAvailableAt,availableAt:personalAvailableAt};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
};
module.exports.inventoryRequestStatus=async(retailer,productId,zip,viewer)=>{
  checkerInput(retailer,productId,zip);await checkerStorage();
  const cooldown=(await pool.query('SELECT available_at FROM inventory_checker_cooldowns WHERE retailer=$1 AND available_at>now()',[retailer])).rows[0];
  const row=(await pool.query('SELECT q.requested_at,q.cancelled_at,r.data FROM inventory_check_requests q LEFT JOIN ccn_inventory_reports r ON r.retailer=q.retailer AND r.product_id=q.product_id AND r.zip=q.zip WHERE q.retailer=$1 AND q.product_id=$2 AND q.zip=$3',[retailer,productId,zip])).rows[0];
  const personalAvailableAt=await personalSearchWindow(retailer,viewer);
  const viewerRequest=viewer && (await pool.query('SELECT requested_at FROM inventory_search_viewers WHERE viewer_id=$1 AND retailer=$2 AND product_id=$3 AND zip=$4',[viewer,retailer,productId,zip])).rows[0];
  const permitted=Boolean(viewerRequest);
  const checkerAvailableAt=cooldown?.available_at || null;
  const availableAt=personalAvailableAt && (!checkerAvailableAt || Date.parse(personalAvailableAt)>Date.parse(checkerAvailableAt))?personalAvailableAt:checkerAvailableAt;
  if(!permitted)return {status:personalAvailableAt?'personal_cooldown':checkerAvailableAt?'cooldown':'idle',personalAvailableAt,checkerAvailableAt,availableAt};
  const complete=row?.data && Date.parse(row.data.checkedAt)>=Math.max(Date.parse(row.requested_at),Date.parse(viewerRequest.requested_at));
  return {status:row?.cancelled_at && Date.parse(row.cancelled_at)>=Date.parse(viewerRequest.requested_at)?'cancelled':complete?(row.data.result==='checker_error'?'checker_error':'completed'):row?'queued':'idle',requestedAt:row?.requested_at || null,checkedAt:complete?row.data.checkedAt:null,personalAvailableAt,checkerAvailableAt,availableAt};
};
module.exports.pendingInventory=async()=>{
  await checkerStorage();return (await pool.query("SELECT q.retailer,q.product_id AS \"productId\",q.zip,q.requested_at AS \"requestedAt\",q.priority FROM inventory_check_requests q LEFT JOIN ccn_inventory_reports r ON r.retailer=q.retailer AND r.product_id=q.product_id AND r.zip=q.zip LEFT JOIN inventory_checker_cooldowns c ON c.retailer=q.retailer WHERE q.cancelled_at IS NULL AND (r.data IS NULL OR (r.data->>'checkedAt')::timestamptz<q.requested_at) AND (c.available_at IS NULL OR c.available_at<=now()) ORDER BY q.priority DESC,q.requested_at LIMIT 20")).rows;
};
module.exports.recordCheckerCooldown=async(retailer,availableAt,sourceUrl)=>{
  checkerInput(retailer,'cooldown','60634');
  const at=Date.parse(availableAt);
  if(!Number.isFinite(at)||at<=Date.now()||at>Date.now()+24*3600000||!String(sourceUrl).startsWith('https://discord.com/channels/1367457689386356766/'))throw Error('Use the actual future cooldown and Rippin Packz response permalink');
  await checkerStorage();await pool.query('INSERT INTO inventory_checker_cooldowns(retailer,available_at,source_url) VALUES($1,$2,$3) ON CONFLICT(retailer) DO UPDATE SET available_at=GREATEST(inventory_checker_cooldowns.available_at,EXCLUDED.available_at),source_url=EXCLUDED.source_url',[retailer,new Date(at).toISOString(),sourceUrl]);
};

module.exports.cancelPendingInventory=async(requests)=>{
 if(!Array.isArray(requests)||requests.length>20)throw Error('Load the pending requests first');
 await checkerStorage();let cleared=0;
 for(const request of requests){
  checkerInput(request.retailer,request.productId,request.zip);
  if(!Number.isFinite(Date.parse(request.requestedAt)))throw Error('Original request time required');
  const result=await pool.query("UPDATE inventory_check_requests q SET cancelled_at=now() WHERE retailer=$1 AND product_id=$2 AND zip=$3 AND date_trunc('milliseconds',requested_at)=$4::timestamptz AND cancelled_at IS NULL AND NOT EXISTS (SELECT 1 FROM ccn_inventory_reports r WHERE r.retailer=q.retailer AND r.product_id=q.product_id AND r.zip=q.zip AND (r.data->>'checkedAt')::timestamptz>=q.requested_at)",[request.retailer,request.productId,request.zip,request.requestedAt]);
  cleared+=result.rowCount;
 }
 return {cleared};
};
