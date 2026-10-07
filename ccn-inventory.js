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
async function save(input){
  const report=clean(input);await checkerStorage();
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
      await client.query("COMMIT");return {report:previous,alertLocations:[]};
    }
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
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
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
    const allowed={target:['www.target.com','target.com'],walmart:['www.walmart.com','walmart.com'],pokemoncenter:['www.pokemoncenter.com','pokemoncenter.com']};
    if(url.protocol!=='https:' || !allowed[retailer]?.includes(host) || !item.name)return null;
    const name=String(item.name).slice(0,240);const seller=String(item.seller || '').slice(0,100);
    if(retailer==='target' && ((item.status!=='upcoming' && !/^target$/i.test(seller)) || (seller && !/^target$/i.test(seller)) || !/ascended heroes|prismatic|destined rivals|30th|(?:ultra|special|super)[- ]premium collection|\b(?:upc|spc)\b/i.test(name)))return null;
    if(retailer==='walmart' && !/^(?:walmart|gt collectibles(?: and toys)?)$/i.test(seller))return null;
    if(!/pok[eé]mon|trading card/i.test(name))return null;
    if(retailer==='pokemoncenter' && !/tcg|trading card|booster|trainer box|premium collection|(?:ex|v|gx) box|tin|battle deck/i.test(name))return null;
    const price=typeof item.price==='number' && Number.isFinite(item.price)&&item.price>0?item.price:null;
    const msrp=typeof item.msrp==='number' && Number.isFinite(item.msrp)&&item.msrp>0?item.msrp:null;
    const withinPriceRule=retailer!=='walmart' || price!==null && msrp!==null && price<=msrp*1.5;
    let image=null;try{const im=new URL(item.image);if(im.protocol==='https:' && /(?:^|\.)(?:target\.com|scene7\.com|walmartimages\.com|pokemoncenter\.com)$/.test(im.hostname))image=im.href;}catch{}
    const id=retailer==='target'?url.pathname.match(/\/A-(\d+)/)?.[1]:retailer==='walmart'?url.pathname.match(/\/ip\/(?:[^/]+\/)?(\d+)\/?$/)?.[1]:url.pathname.match(/\/product\/([^/]+)/)?.[1];
    if(!id)return null;
    if(retailer==='walmart')url=new URL('https://www.walmart.com/ip/'+id);
    if(retailer==='target')url=new URL('https://www.target.com/p/-/A-'+id);
    url.search='';url.hash='';
    return {name,url:url.href,image,seller,price,msrp,withinPriceRule,status:['reported_available','upcoming','reported_unavailable','queue'].includes(item.status)?item.status:'upcoming',productId:id,expectedWindow:String(item.expectedWindow || '').slice(0,250)};
  }).filter(Boolean);
}
async function saveNews(input){
  if(!/pok[eé]mon|\btcg\b|prismatic|destined rivals|ascended heroes|30th.*(?:etb|collection|bundle)/i.test(String(input.summary || "")+" "+JSON.stringify(input.products || []))) throw new Error("Only Pokémon TCG product and restock reports are accepted");
  const timestamp=Date.parse(input.publishedAt);
  const edited=input.editedAt==null?null:Date.parse(input.editedAt);
  const effective=edited ?? timestamp;
  if(!/^https:\/\/discord\.com\/channels\/1410547930250612828\/\d+\/\d+$/.test(input.sourceUrl || "") || !input.summary || !Number.isFinite(timestamp) || !Number.isFinite(effective) || timestamp>Date.now()+60000 || effective<timestamp || effective>Date.now()+60000 || Date.now()-effective>48*3600000) throw new Error("Provide an actual CCN message link, summary and publication time; old messages need their recent actual edit time");
  const report={sourceUrl:input.sourceUrl,summary:String(input.summary).trim().slice(0,1000),retailer:["costco","sams","bestbuy","target","pokemoncenter","walmart"].includes(input.retailer)?input.retailer:null,publishedAt:new Date(timestamp).toISOString(),editedAt:edited===null?null:new Date(edited).toISOString(),updatedAt:new Date(effective).toISOString(),source:"CCN",importedAt:new Date().toISOString()};
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
    report.seenRevisions=[...new Set([...seen,revision])].slice(-100);
    await client.query('INSERT INTO ccn_news_reports(source_url,data) VALUES($1,$2) ON CONFLICT(source_url) DO UPDATE SET data=EXCLUDED.data',[report.sourceUrl,report]);
    await client.query('COMMIT');
    return {...report,isNew:!previous,isUpdated:Boolean(previous && changed && unseen)};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function news(){
  await newsStorage();
  const result=await pool.query("SELECT data FROM ccn_news_reports WHERE (COALESCE(data->>'updatedAt',data->>'publishedAt'))::timestamptz >= date_trunc('day',now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago' ORDER BY (COALESCE(data->>'updatedAt',data->>'publishedAt'))::timestamptz DESC LIMIT 40");
  return result.rows.map(row=>row.data);
}
module.exports.saveNews=saveNews;module.exports.news=news;

async function onlineProducts(retailer){
  await newsStorage();
  const rows=await pool.query("SELECT data FROM ccn_news_reports WHERE data->>'retailer'=$1 AND (COALESCE(data->>'updatedAt',data->>'publishedAt'))::timestamptz > now()-interval '7 days' ORDER BY (COALESCE(data->>'updatedAt',data->>'publishedAt'))::timestamptz DESC LIMIT 200",[retailer]);
  const posts=rows.rows.map(row=>row.data);const latest=new Map();
  for(const post of posts.filter(p=>p.retailer===retailer))for(const product of post.products || []){
    if(latest.has(product.url))continue;
    latest.set(product.url,{...product,source:post.source,sourceUrl:post.sourceUrl,reportedAt:post.updatedAt || post.publishedAt,stale:Date.now()-Date.parse(post.updatedAt || post.publishedAt)>30*60000});
  }
  return [...latest.values()].filter(p=>p.status!=='reported_unavailable' && (p.withinPriceRule || p.price===null || p.msrp===null));
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
      if(previous && Date.parse(previous.reportedAt)>=at)continue;
      const changed=!previous || previous.status!==item.status;
      if(changed && item.withinPriceRule && ['reported_available','queue'].includes(item.status) && Date.now()-at<30*60000)alerts.push(item);
      await client.query('INSERT INTO ccn_online_alert_states(product_key,data) VALUES($1,$2) ON CONFLICT(product_key) DO UPDATE SET data=EXCLUDED.data',[key,{status:item.status,reportedAt:new Date(at).toISOString()}]);
    }
    await client.query('COMMIT');return alerts;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
module.exports.onlineAlerts=onlineAlerts;

async function dgQueueStorage(){await storage();await pool.query("CREATE TABLE IF NOT EXISTS dg_check_requests (product_id TEXT NOT NULL, zip TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(product_id,zip))");}
module.exports.requestDg=async(productId,zip)=>{await dgQueueStorage();await pool.query("INSERT INTO dg_check_requests(product_id,zip) VALUES($1,$2) ON CONFLICT(product_id,zip) DO UPDATE SET requested_at=now() WHERE dg_check_requests.requested_at < now()-interval '1 hour' OR EXISTS (SELECT 1 FROM ccn_inventory_reports r WHERE r.retailer='dollargeneral' AND r.product_id=EXCLUDED.product_id AND r.zip=EXCLUDED.zip AND (r.data->>'checkedAt')::timestamptz>=dg_check_requests.requested_at)",[productId,zip]);};
module.exports.pendingDg=async()=>{await dgQueueStorage();const r=await pool.query("SELECT q.product_id AS \"productId\",q.zip,q.requested_at AS \"requestedAt\" FROM dg_check_requests q LEFT JOIN ccn_inventory_reports r ON r.retailer='dollargeneral' AND r.product_id=q.product_id AND r.zip=q.zip WHERE q.requested_at>now()-interval '1 hour' AND (r.data IS NULL OR (r.data->>'checkedAt')::timestamptz<q.requested_at) ORDER BY q.requested_at LIMIT 10");return r.rows;};
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
  await pool.query("CREATE TABLE IF NOT EXISTS inventory_check_requests (retailer TEXT NOT NULL, product_id TEXT NOT NULL, zip TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), priority INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(retailer,product_id,zip))");
  await pool.query("CREATE TABLE IF NOT EXISTS inventory_checker_cooldowns (retailer TEXT PRIMARY KEY, available_at TIMESTAMPTZ NOT NULL, source_url TEXT NOT NULL)");
}
function checkerInput(retailer,productId,zip){
  if(!['bestbuy','costco','sams','dollargeneral','barnes'].includes(retailer)||!/^\d{5}$/.test(zip)||!/^[A-Za-z0-9-]{1,40}$/.test(productId))throw Error('Choose a retailer, valid product identifier and five-digit ZIP');
}
module.exports.requestInventory=async(retailer,productId,zip,viewer)=>{
  checkerInput(retailer,productId,zip);await checkerStorage();
  if(!viewer)throw Error('Private search session unavailable');
  await pool.query('INSERT INTO inventory_search_viewers(viewer_id,retailer,product_id,zip) VALUES($1,$2,$3,$4) ON CONFLICT(viewer_id,retailer,product_id,zip) DO UPDATE SET requested_at=now()',[viewer,retailer,productId,zip]);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['manual-check:'+retailer+':'+productId+':'+zip]);
    const cooldown=(await client.query('SELECT available_at FROM inventory_checker_cooldowns WHERE retailer=$1 AND available_at>now()',[retailer])).rows[0];
    if(cooldown){await client.query('COMMIT');return {status:'cooldown',availableAt:cooldown.available_at};}
    const existing=(await client.query("SELECT q.requested_at FROM inventory_check_requests q LEFT JOIN ccn_inventory_reports r ON r.retailer=q.retailer AND r.product_id=q.product_id AND r.zip=q.zip WHERE q.retailer=$1 AND q.product_id=$2 AND q.zip=$3 AND q.requested_at>now()-interval '1 hour' AND (r.data IS NULL OR (r.data->>'checkedAt')::timestamptz<q.requested_at)",[retailer,productId,zip])).rows[0];
    if(existing){await client.query('COMMIT');return {status:'queued',deduplicated:true,requestedAt:existing.requested_at};}
    const row=(await client.query('INSERT INTO inventory_check_requests(retailer,product_id,zip,priority) VALUES($1,$2,$3,1) ON CONFLICT(retailer,product_id,zip) DO UPDATE SET requested_at=now(),priority=1 RETURNING requested_at',[retailer,productId,zip])).rows[0];
    await client.query('COMMIT');return {status:'queued',deduplicated:false,requestedAt:row.requested_at};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
};
module.exports.inventoryRequestStatus=async(retailer,productId,zip,viewer)=>{
  checkerInput(retailer,productId,zip);await checkerStorage();
  const cooldown=(await pool.query('SELECT available_at FROM inventory_checker_cooldowns WHERE retailer=$1 AND available_at>now()',[retailer])).rows[0];
  const row=(await pool.query('SELECT q.requested_at,r.data FROM inventory_check_requests q LEFT JOIN ccn_inventory_reports r ON r.retailer=q.retailer AND r.product_id=q.product_id AND r.zip=q.zip WHERE q.retailer=$1 AND q.product_id=$2 AND q.zip=$3',[retailer,productId,zip])).rows[0];
  const permitted=viewer && (await pool.query('SELECT 1 FROM inventory_search_viewers WHERE viewer_id=$1 AND retailer=$2 AND product_id=$3 AND zip=$4',[viewer,retailer,productId,zip])).rowCount;
  if(!permitted)return {status:'idle',availableAt:cooldown?.available_at || null};
  const complete=row?.data && Date.parse(row.data.checkedAt)>=Date.parse(row.requested_at);
  return {status:complete?(row.data.result==='checker_error'?'checker_error':'completed'):row?(Date.now()-Date.parse(row.requested_at)>3600000?'expired':'queued'):'idle',requestedAt:row?.requested_at || null,checkedAt:complete?row.data.checkedAt:null,availableAt:cooldown?.available_at || null};
};
module.exports.pendingInventory=async()=>{
  await checkerStorage();return (await pool.query("SELECT q.retailer,q.product_id AS \"productId\",q.zip,q.requested_at AS \"requestedAt\",q.priority FROM inventory_check_requests q LEFT JOIN ccn_inventory_reports r ON r.retailer=q.retailer AND r.product_id=q.product_id AND r.zip=q.zip LEFT JOIN inventory_checker_cooldowns c ON c.retailer=q.retailer WHERE q.requested_at>now()-interval '1 hour' AND (r.data IS NULL OR (r.data->>'checkedAt')::timestamptz<q.requested_at) AND (c.available_at IS NULL OR c.available_at<=now()) ORDER BY q.priority DESC,q.requested_at LIMIT 20")).rows;
};
module.exports.recordCheckerCooldown=async(retailer,availableAt,sourceUrl)=>{
  checkerInput(retailer,'cooldown','60634');
  const at=Date.parse(availableAt);
  if(!Number.isFinite(at)||at<=Date.now()||at>Date.now()+24*3600000||!String(sourceUrl).startsWith('https://discord.com/channels/1367457689386356766/'))throw Error('Use the actual future cooldown and Rippin Packz response permalink');
  await checkerStorage();await pool.query('INSERT INTO inventory_checker_cooldowns(retailer,available_at,source_url) VALUES($1,$2,$3) ON CONFLICT(retailer) DO UPDATE SET available_at=GREATEST(inventory_checker_cooldowns.available_at,EXCLUDED.available_at),source_url=EXCLUDED.source_url',[retailer,new Date(at).toISOString(),sourceUrl]);
};
