'use strict';
const crypto=require('node:crypto');
// Only Discord-origin searches register a callback. Callback credentials expire
// with the interaction and are encrypted at rest; never send them to the app.
function create({inventory,env,fetchImpl=globalThis.fetch,now=Date.now,pool}){
  if(!pool&&env.DATABASE_URL)pool=new (require('pg').Pool)({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000});
  const key=env.DISCORD_BOT_TOKEN&&crypto.createHash('sha256').update(env.DISCORD_BOT_TOKEN).digest();
  let ready,running=false;
  async function storage(){
    if(!pool||!key)throw Error('Discord completion storage unavailable');
    ready ||= pool.query(`CREATE TABLE IF NOT EXISTS discord_search_delivery (interaction_id TEXT PRIMARY KEY, application_id TEXT NOT NULL, callback TEXT NOT NULL, viewer_id TEXT NOT NULL, retailer TEXT NOT NULL, product_id TEXT NOT NULL, zip TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt TIMESTAMPTZ NOT NULL DEFAULT now())`).catch(e=>{ready=null;throw e;});
    await ready;
  }
  function seal(token){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(token),c.final(),c.getAuthTag()]).toString('base64');}
  function open(value){const b=Buffer.from(value,'base64'),d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString();}
  async function track(interaction,viewer,values){
    await storage();
    const issued=Number((BigInt(interaction.id)>>22n)+1420070400000n);
    const expires=Math.min(issued+14*60000,now()+14*60000);
    if(expires<=now())return false;
    await pool.query('INSERT INTO discord_search_delivery(interaction_id,application_id,callback,viewer_id,retailer,product_id,zip,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[interaction.id,interaction.application_id,seal(interaction.token),viewer,values.retailer,values.product,values.zip,new Date(expires)]);
    return true;
  }
  async function drain(){
    if(running||!pool||!key)return;running=true;
    try{
      await storage();
      await pool.query('DELETE FROM discord_search_delivery WHERE expires_at<=now()');
      const rows=(await pool.query('SELECT * FROM discord_search_delivery WHERE next_attempt<=now() ORDER BY expires_at LIMIT 30')).rows;
      for(const r of rows){
        try{
          const status=await inventory.inventoryRequestStatus(r.retailer,r.product_id,r.zip,r.viewer_id);
          if(!['completed','checker_error','cancelled','expired'].includes(status.status))continue;
          let content='Your search was '+status.status+'. Stock remains unknown.';
          if(status.status==='checker_error')content='The checker returned an error. Stock is unknown; no out-of-stock conclusion can be made.';
          if(status.status==='completed'){
            const report=(await inventory.list(r.retailer,r.zip,r.viewer_id)).find(p=>p.productId===r.product_id);
            if(!report)continue;
            content=require('./discord-commands').formatReport(report,r.retailer);
          }
          const response=await fetchImpl(`https://discord.com/api/v10/webhooks/${r.application_id}/${open(r.callback)}/messages/@original`,{method:'PATCH',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify({content,allowed_mentions:{parse:[]}})});
          if(response.ok||[401,403,404].includes(response.status))await pool.query('DELETE FROM discord_search_delivery WHERE interaction_id=$1',[r.interaction_id]);
          else await pool.query("UPDATE discord_search_delivery SET attempts=attempts+1,next_attempt=now()+interval '20 seconds' WHERE interaction_id=$1",[r.interaction_id]);
          console.log('Private Discord search completion:',{status:response.status,ok:response.ok});
        }catch{console.warn('Private Discord search completion deferred');}
      }
    }catch{console.warn('Discord completion storage deferred');}finally{running=false;}
  }
  const timer=setInterval(drain,10000);timer.unref();
  return {track,drain,stop:()=>clearInterval(timer)};
}
module.exports={create};
