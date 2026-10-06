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
  const locations=(input.locations || []).slice(0,100).map(row=>({name:String(row.name || "").slice(0,150),address:String(row.address || "").slice(0,250),onOrder:quantity(row.onOrder),inTransit:quantity(row.inTransit),onHand:quantity(row.onHand),status:String(row.status || "Not published").slice(0,100)}));
  let image=null;
  try{const u=new URL(input.image);if(u.protocol==="https:" && /(?:^|\.)(?:costco\.com|samsclub\.com|scene7\.com|bbystatic\.com|bestbuy\.com|wal\.co)$/.test(u.hostname))image=u.href;}catch{}
  return {retailer:input.retailer,productId:input.productId,zip:input.zip,name:String(input.name).slice(0,240),image,source:"CCN / Zephyr stock checker",sourceUrl:input.sourceUrl,checkedAt:new Date(checked).toISOString(),result:input.result,detail:String(input.detail || "").slice(0,400),locations:input.result==="results"?locations:[]};
}
async function save(input){
  const report=clean(input);await storage();
  await pool.query("INSERT INTO ccn_inventory_reports(retailer,product_id,zip,data) VALUES($1,$2,$3,$4) ON CONFLICT(retailer,product_id,zip) DO UPDATE SET data=EXCLUDED.data WHERE (ccn_inventory_reports.data->>'checkedAt')::timestamptz <= (EXCLUDED.data->>'checkedAt')::timestamptz",[report.retailer,report.productId,report.zip,report]);
  return report;
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
async function saveNews(input){
  const timestamp=Date.parse(input.publishedAt);
  if(!/^https:\/\/discord\.com\/channels\/1410547930250612828\/\d+\/\d+$/.test(input.sourceUrl || "") || !input.summary || !Number.isFinite(timestamp) || timestamp>Date.now()+60000 || Date.now()-timestamp>48*3600000) throw new Error("Provide a recent actual CCN message link, summary and publication time");
  const report={sourceUrl:input.sourceUrl,summary:String(input.summary).slice(0,1000),retailer:["costco","sams","bestbuy","target","pokemoncenter","walmart"].includes(input.retailer)?input.retailer:null,publishedAt:new Date(timestamp).toISOString(),source:"CCN",importedAt:new Date().toISOString()};
  await newsStorage();
  await pool.query("INSERT INTO ccn_news_reports(source_url,data) VALUES($1,$2) ON CONFLICT(source_url) DO UPDATE SET data=EXCLUDED.data",[report.sourceUrl,report]);
  return report;
}
async function news(){
  await newsStorage();
  const result=await pool.query("SELECT data FROM ccn_news_reports WHERE (data->>'publishedAt')::timestamptz >= date_trunc('day',now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago' ORDER BY (data->>'publishedAt')::timestamptz DESC LIMIT 40");
  return result.rows.map(row=>row.data);
}
module.exports.saveNews=saveNews;module.exports.news=news;
