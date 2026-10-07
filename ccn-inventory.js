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
  if(!["costco","sams","bestbuy"].includes(input.retailer) || !/^\d{5}$/.test(input.zip || "") || !/^[a-zA-Z0-9-]{1,40}$/.test(input.productId || "")) throw new Error("Invalid retailer, product identifier or ZIP");
  if(!input.name || !/^https:\/\/discord\.com\/channels\//.test(input.sourceUrl || "")) throw new Error("Product name and CCN message or channel link are required");
  const checked=Date.parse(input.checkedAt);
  if(!Number.isFinite(checked) || checked>Date.now()+60000 || Date.now()-checked>6*3600000) throw new Error("Report must have a recent actual check time");
  if(!["results","no_stock_reported","checker_error"].includes(input.result)) throw new Error("Invalid checker result");
  const quantity=value=>value==null?null:Number.isInteger(value)&&value>=0?value:null;
  const locations=(input.locations || []).slice(0,100).map(row=>({name:String(row.name || "").slice(0,150),address:String(row.address || "").slice(0,250),onOrder:quantity(row.onOrder),inTransit:quantity(row.inTransit),onHand:quantity(row.onHand),distanceMiles:Number.isFinite(row.distanceMiles)&&row.distanceMiles>=0?row.distanceMiles:null,status:String(row.status || "Not published").slice(0,100)}));
  let image=null;
  try{const u=new URL(input.image);if(u.protocol==="https:" && /(?:^|\.)(?:costco\.com|samsclub\.com|scene7\.com|bbystatic\.com|bestbuy\.com|wal\.co)$/.test(u.hostname))image=u.href;}catch{}
  return {retailer:input.retailer,productId:input.productId,zip:input.zip,name:String(input.name).slice(0,240),image,source:input.sourceUrl.startsWith("https://discord.com/channels/1367457689386356766/") ? "Rippin Packz stock checker" : "CCN / Zephyr stock checker",sourceUrl:input.sourceUrl,checkedAt:new Date(checked).toISOString(),result:input.result,detail:String(input.detail || "").slice(0,400),locations:input.result==="results"?locations:[]};
}
async function save(input){
  const report=clean(input);await storage();
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
    await client.query("INSERT INTO ccn_inventory_reports(retailer,product_id,zip,data) VALUES($1,$2,$3,$4) ON CONFLICT(retailer,product_id,zip) DO UPDATE SET data=EXCLUDED.data",[report.retailer,report.productId,report.zip,report]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return {report,alertLocations};
}
async function list(retailer,zip){
  await storage();
  const rows=await pool.query("SELECT data FROM ccn_inventory_reports WHERE retailer=$1 AND zip=$2",[retailer,zip]);
  return rows.rows.map(row=>({...row.data,stale:Date.now()-Date.parse(row.data.checkedAt)>90*60000}));
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
    if(retailer==='target' && (!/^target$/i.test(seller) || !/ascended heroes|prismatic|destined rivals|30th|(?:ultra|special|super)[- ]premium collection|\b(?:upc|spc)\b/i.test(name)))return null;
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
