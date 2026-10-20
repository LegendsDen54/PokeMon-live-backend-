'use strict';
const crypto = require('node:crypto');
const retailers = {bestbuy:'Best Buy',costco:'Costco',sams:"Sam’s Club",dollargeneral:'Dollar General',barnes:'Barnes & Noble'};
const options = [
  {type:3,name:'retailer',description:'Store to check',required:true,choices:Object.entries(retailers).map(([value,name])=>({name,value}))},
  {type:3,name:'product',description:'Choose a product by name from the suggestions',required:true,max_length:100,autocomplete:true},
  {type:3,name:'zip',description:'Five-digit US ZIP',required:true,min_length:5,max_length:5}
];
const commands = [
  {name:'stock',description:'Queue a private stock check through the monitor',type:1,options},
  {name:'stockstatus',description:'Read your stock-check status and saved result',type:1,options},
  {name:'monitor',description:'Open the Legends Den monitor',type:1}
];
function verified(raw, signature, timestamp, key, now=Date.now()) {
  try {
    if (!/^[a-f0-9]{64}$/i.test(key || '') || !/^[a-f0-9]{128}$/i.test(signature || '') ||
        !/^\d{10}$/.test(timestamp || '') || Math.abs(now-Number(timestamp)*1000)>300000) return false;
    return crypto.verify(null,Buffer.concat([Buffer.from(timestamp),raw]),
      crypto.createPublicKey({key:Buffer.from('302a300506032b6570032100'+key,'hex'),format:'der',type:'spki'}),Buffer.from(signature,'hex'));
  } catch { return false; }
}
const response = content => ({type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
function create({inventory, wake=()=>{}, env=process.env, fetchImpl=globalThis.fetch, now=Date.now}) {
  const seen = new Map();
  async function execute(interaction) {
    const name=interaction.data?.name;
    if(name==='monitor')return 'Open the monitor: https://pokemon-live-backend.onrender.com/';
    const values=Object.fromEntries((interaction.data?.options || []).map(o=>[o.name,String(o.value || '').trim()]));
    const {retailer,product,zip}=values;
    if(!retailers[retailer] || !/^[A-Za-z0-9-]{1,40}$/.test(product || '') || !/^\d{5}$/.test(zip || '')) return 'Choose a retailer, select a product from the suggestions and enter your five-digit ZIP.';
    if(retailer==='barnes' && !/^\d{13}$/.test(product))return 'Barnes & Noble requires the exact 13-digit EAN.';
    if(retailer==='dollargeneral' && !require('./dollar-general.json').products.some(p=>p.upc===product))return 'Choose a verified Dollar General UPC from the monitor’s product menu.';
    const viewer='discord:'+crypto.createHash('sha256').update(interaction.guild_id+':'+interaction.member.user.id).digest('hex');
    if(name==='stock') {
      const result=await inventory.requestInventory(retailer,product,zip,viewer);
      if(result.status==='queued') {
        if(retailer==='dollargeneral')await inventory.requestDg(product,zip);
        void Promise.resolve().then(wake).catch(()=>{});
        return (result.deduplicated?'This exact check is already queued.':'Your stock check is queued.')+' Use /stockstatus with the same retailer, product and ZIP to read the result. Queueing is not a completed check.';
      }
      return 'The checker or your personal cooldown is active.'+(result.availableAt?' Available after '+new Date(result.availableAt).toISOString()+'.':'');
    }
    if(name!=='stockstatus')return 'Unknown command.';
    const status=await inventory.inventoryRequestStatus(retailer,product,zip,viewer);
    if(!['completed','checker_error'].includes(status.status))return 'Your stock-check status: '+status.status+'.'+(status.availableAt?' Available after '+new Date(status.availableAt).toISOString()+'.':'');
    if(status.status==='checker_error')return 'The checker returned an error. Stock is unknown; no out-of-stock conclusion can be made.';
    const reports=await inventory.list(retailer,zip,viewer);
    const report=reports.find(r=>r.productId===product);
    if(!report)return 'Saved result is temporarily unavailable. Stock is unknown.';
    const rows=(report.locations || []).map(r=>`${r.name || 'Store'}${r.address?' — '+r.address:''}: on hand ${r.onHand ?? 'unknown'}, on order ${r.onOrder ?? 'unknown'}, in transit ${r.inTransit ?? 'unknown'}`);
    const header=`${retailers[retailer]} · ${report.name || product}\nChecked ${report.checkedAt}${report.stale?' · Older result; recheck needed':''}\n`;
    const suffix='\nSource: '+(report.sourceUrl || 'not supplied');
    let body=header;
    let count=0;
    for(const row of rows){if(body.length+row.length+suffix.length+100>1900)break;body+=row+'\n';count++;}
    if(count<rows.length)body+=`Showing ${count} of ${rows.length} store rows; the source contains the full response.\n`;
    if(!rows.length)body+='No store rows supplied; missing quantities remain unknown.\n';
    return body+suffix;
  }
  async function handler(req,res) {
    if(!env.DISCORD_APPLICATION_PUBLIC_KEY || !env.DISCORD_APPLICATION_ID || !env.DISCORD_GUILD_ID)return res.status(503).json({error:'Discord commands are not configured'});
    if(!Buffer.isBuffer(req.body) || !verified(req.body,req.get('X-Signature-Ed25519'),req.get('X-Signature-Timestamp'),env.DISCORD_APPLICATION_PUBLIC_KEY,now()))return res.status(401).json({error:'Invalid request signature'});
    let interaction;try{interaction=JSON.parse(req.body.toString('utf8'));}catch{return res.sendStatus(400);}
    if(interaction.application_id!==env.DISCORD_APPLICATION_ID)return res.sendStatus(403);
    if(interaction.type===1)return res.json({type:1});
    if(![2,4].includes(interaction.type) || interaction.guild_id!==env.DISCORD_GUILD_ID || !/^\d+$/.test(interaction.member?.user?.id || '') ||
        (env.DISCORD_COMMAND_CHANNEL_ID && interaction.channel_id!==env.DISCORD_COMMAND_CHANNEL_ID))return res.json(interaction.type===4?{type:8,data:{choices:[]}}:response('Commands are available only in the configured Legends Den server/channel.'));
    if(interaction.type===4){
      const opts=interaction.data?.options||[];
      const focused=opts.find(o=>o.focused);
      const choices=['stock','stockstatus'].includes(interaction.data?.name)&&focused?.name==='product'
        ?require('./discord-product-choices').choices(opts.find(o=>o.name==='retailer')?.value,focused.value):[];
      return res.json({type:8,data:{choices}});
    }
    if(!commands.some(c=>c.name===interaction.data?.name))return res.json(response('Unknown command.'));
    if(!/^\d+$/.test(interaction.id || '') || !/^[A-Za-z0-9._-]{1,512}$/.test(interaction.token || ''))return res.sendStatus(400);
    for(const [id,at] of seen)if(at<now()-900000)seen.delete(id);
    if(seen.has(interaction.id))return res.json({type:5,data:{flags:64}});
    seen.set(interaction.id,now());while(seen.size>1000)seen.delete(seen.keys().next().value);
    res.json({type:5,data:{flags:64}}); // Acknowledge immediately; database work may exceed three seconds.
    let content;try{content=await execute(interaction);}catch{content='Stock-check storage is temporarily unavailable. Stock remains unknown. Use /stockstatus before retrying a request.';}
    try {
      const delivery=await fetchImpl(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`,{
        method:'PATCH',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},
        body:JSON.stringify({content:content.slice(0,2000),allowed_mentions:{parse:[]}})});
      console.log('Discord command response delivery:', {command:interaction.data.name,status:delivery.status,ok:delivery.ok});
    } catch { console.warn('Discord command response delivery failed; no credential or request content logged.'); }
  }
  return {handler,execute};
}
module.exports={commands,verified,create};
