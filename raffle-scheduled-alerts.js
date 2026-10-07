"use strict";
const {Pool}=require('pg');
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000}):null;
let ready,busy=false,lastReceipt=null;
async function tick(items,push){
 if(!pool || busy)return;busy=true;
 try{
  ready ||= pool.query('CREATE TABLE IF NOT EXISTS raffle_scheduled_alerts (event_key TEXT PRIMARY KEY, sent_at TIMESTAMPTZ NOT NULL DEFAULT now(), receipt JSONB)').catch(e=>{ready=null;throw e;});await ready;
  const groups=new Map();for(const item of items || []){const start=Date.parse(item.startsAt);if(!Number.isFinite(start))continue;const names=groups.get(start)||[];if(!names.includes(item.name))names.push(item.name);groups.set(start,names);}
  for(const [start,names] of groups)for(const phase of ['five-minute','opening','halfway']){
   const closesAt=(items || []).filter(item=>Date.parse(item.startsAt)===start).map(item=>Date.parse(item.endsAt || item.closesAt)).find(at=>at===start+3600000) || (start===Date.parse('2026-10-07T21:00:00Z')?start+3600000:null);
   if(phase==='halfway' && !closesAt)continue;
   const due=start+(phase==='halfway'?1800000:phase==='five-minute'?-300000:0),age=Date.now()-due;if(age<0 || age>(phase==='halfway'?1800000:60000))continue;
   const key=new Date(start).toISOString()+':'+phase;
   const claim=await pool.query('INSERT INTO raffle_scheduled_alerts(event_key) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_key',[key]);if(!claim.rowCount)continue;
   const receipt=await push.broadcast({title:phase==='halfway'?'Less than 30 minutes left for Walmart drawings':phase==='five-minute'?'Walmart drawing opens in 5 minutes':'Walmart scheduled drawing window has started',body:(names.slice(0,3).join('; ')+(names.length>3?' and more':'')+'. '+(phase==='halfway'?'The reported one-hour entry window is nearing its end. Open Walmart to check entry.':phase==='five-minute'?'Get ready to check Walmart.':'Check Walmart for the Enter Drawing button; live entry is not yet confirmed.')).slice(0,250),url:'https://www.walmart.com/shop/collectibles/draw',tag:'walmart-scheduled-'+key});
   lastReceipt={phase,startsAt:new Date(start).toISOString(),...receipt};await pool.query('UPDATE raffle_scheduled_alerts SET receipt=$2 WHERE event_key=$1',[key,receipt]);
  }
 }catch(e){console.warn('Scheduled drawing alert failed:',e.message);}finally{busy=false;}
}
module.exports={tick,status:()=>({enabled:Boolean(pool),leadMinutes:5,halfwayReminder:true,pollSeconds:5,lastReceipt})};
