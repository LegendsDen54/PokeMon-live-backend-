"use strict";
const {Pool}=require('pg');
const push=require('./push');
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000}):null;
let ready,running=false;
async function storage(){
  if(!pool)throw Error('Notification storage unavailable');
  ready ||= pool.query(`CREATE TABLE IF NOT EXISTS inventory_push_devices (endpoint TEXT PRIMARY KEY, viewer_id TEXT NOT NULL, visible BOOLEAN NOT NULL DEFAULT false, seen_at TIMESTAMPTZ NOT NULL DEFAULT now()); CREATE TABLE IF NOT EXISTS inventory_completion_notices (viewer_id TEXT NOT NULL, retailer TEXT NOT NULL, product_id TEXT NOT NULL, zip TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(viewer_id,retailer,product_id,zip,requested_at))`).catch(e=>{ready=null;throw e;});
  await ready;
}
exports.connect=async(viewer,endpoint,visible)=>{await storage();await pool.query('INSERT INTO inventory_push_devices(endpoint,viewer_id,visible) VALUES($1,$2,$3) ON CONFLICT(endpoint) DO UPDATE SET viewer_id=EXCLUDED.viewer_id,visible=EXCLUDED.visible,seen_at=now()',[endpoint,viewer,visible]);};
exports.presence=async(viewer,visible)=>{await storage();await pool.query('UPDATE inventory_push_devices SET visible=$2,seen_at=now() WHERE viewer_id=$1',[viewer,visible]);};
exports.completed=async(report)=>{
  await storage();
  const viewers=(await pool.query(`SELECT v.viewer_id,v.requested_at FROM inventory_search_viewers v WHERE v.retailer=$1 AND v.product_id=$2 AND v.zip=$3 AND v.requested_at<=$4 AND v.requested_at>now()-interval '1 hour' AND EXISTS(SELECT 1 FROM inventory_push_devices d WHERE d.viewer_id=v.viewer_id)`,[report.retailer,report.productId,report.zip,report.checkedAt])).rows;
  const retailer={bestbuy:'Best Buy',costco:'Costco',sams:"Sam’s Club",dollargeneral:'Dollar General',barnes:'Barnes & Noble'}[report.retailer];
  const result=report.result==='checker_error'?'Checker error; stock is unknown.':report.result==='no_stock_reported'?'No stock reported; missing stores remain unknown.':report.locations.some(l=>l.onHand>0)?'Stock reported. Open your search for stores and quantities.':'Results received. Open your search for store details; unreported quantities are unknown.';
  for(const v of viewers){
    const quick=Date.parse(report.checkedAt)-Date.parse(v.requested_at)<30000;
    const active=quick && (await pool.query("SELECT 1 FROM inventory_push_devices WHERE viewer_id=$1 AND visible AND seen_at>now()-interval '40 seconds'",[v.viewer_id])).rowCount;
    const payload={title:retailer+' — Your search is complete',body:report.name+' · ZIP '+report.zip+'. '+result,retailer:report.retailer,url:'/?retailer='+encodeURIComponent(report.retailer)+'&productId='+encodeURIComponent(report.productId)+'&zip='+report.zip,tag:'inventory-'+report.retailer+'-'+report.productId+'-'+report.zip};
    await pool.query("INSERT INTO inventory_completion_notices(viewer_id,retailer,product_id,zip,requested_at,payload,state) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",[v.viewer_id,report.retailer,report.productId,report.zip,v.requested_at,payload,active?'suppressed':'pending']);
  }
  void drain();
};
async function drain(){
  if(running||!pool)return;running=true;
  try{
    await storage();
    const notices=(await pool.query("SELECT * FROM inventory_completion_notices WHERE state='pending' AND next_attempt<=now() AND requested_at>now()-interval '24 hours' LIMIT 30")).rows;
    for(const n of notices){
      const devices=(await pool.query('SELECT endpoint FROM inventory_push_devices WHERE viewer_id=$1',[n.viewer_id])).rows;
      const results=await Promise.all(devices.map(d=>push.sendPrivate(d.endpoint,n.payload)));
      const accepted=results.some(r=>r.ok),permanent=results.every(r=>r.expired);
      await pool.query("UPDATE inventory_completion_notices SET state=$6,attempts=attempts+1,next_attempt=now()+interval '1 minute' WHERE viewer_id=$1 AND retailer=$2 AND product_id=$3 AND zip=$4 AND requested_at=$5",[n.viewer_id,n.retailer,n.product_id,n.zip,n.requested_at,accepted?'sent':permanent||n.attempts>=4?'failed':'pending']);
    }
  }catch{console.warn('Private search completion notification deferred');}finally{running=false;}
}
setInterval(drain,60000).unref();
