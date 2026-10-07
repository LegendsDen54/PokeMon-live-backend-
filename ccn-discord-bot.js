"use strict";

// Official bot connection. Inactive until an owner-provided bot token is configured.
// No user account tokens. Reads only these authorized channels; never sends messages.
const guildId='1410547930250612828';
const channels=new Set(['1424776504767680722','1514248684575920160','1460973469150875720','1424776415286657136']);
const state={configured:false,connected:false,lastReceivedAt:null,lastPublishedAt:null,error:null};
let client;
const text=value=>String(value || '').replace(/\s+/g,' ').trim();
function reports(message){
  if(message.guildId!==guildId || !channels.has(message.channelId))return [];
  const embeds=message.embeds || [];
  const body=[message.content,...embeds.flatMap(e=>[e.author?.name,e.title,e.description,...(e.fields || []).map(f=>f.name+': '+f.value)])].filter(Boolean).join('\n');
  if(!/pok[eé]mon|\btcg\b|\bupc\b|\bspc\b|prismatic|destined rivals|ascended heroes|30th.*(?:etb|collection|bundle)/i.test(body))return [];
  const stores=[['walmart',/walmart(?:\.com)?/i],['target',/\btarget(?:\.com)?\b/i],['pokemoncenter',/pok[eé]mon\s*center|pokemoncenter\.com/i]].filter(([,p])=>p.test(body+' '+embeds.map(e=>e.url || '').join(' ')));
  if(stores.length!==1)return []; // Collector splits digests, rather than guessing a retailer.
  const retailer=stores[0][0];
  const products=[];
  for(const embed of embeds){
    const fields=Object.fromEntries((embed.fields || []).map(f=>[text(f.name).toLowerCase(),text(f.value)]));
    const seller=fields.seller || (retailer==='pokemoncenter'?'Pokémon Center':'');
    const priceText=fields.price || fields.retail || '';
    const price=priceText.match(/(?:^|\$)(\d+(?:\.\d{1,2})?)/)?.[1];
    const stock=fields.stock || '';
    const status=/🔴|out of stock|sold out|unavailable/i.test(stock)?'reported_unavailable':/🟢|in stock|available/i.test(stock)?'reported_available':/queue (?:is )?(?:active|live)/i.test(body)?'queue':'upcoming';
    const candidates=[];
    if(embed.url && embed.title)candidates.push({name:embed.title,url:embed.url});
    for(const match of String(embed.description || '').matchAll(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g))candidates.push({name:match[1],url:match[2]});
    for(const item of candidates){
      let u;try{u=new URL(item.url);}catch{continue;}
      const hosts={walmart:['www.walmart.com','walmart.com'],target:['www.target.com','target.com'],pokemoncenter:['www.pokemoncenter.com','pokemoncenter.com']};
      if(u.protocol!=='https:' || !hosts[retailer].includes(u.hostname))continue;
      const id=retailer==='walmart'?u.pathname.match(/\/ip\/(?:[^/]+\/)?(\d+)\/?$/)?.[1]:retailer==='target'?u.pathname.match(/\/A-(\d+)/)?.[1]:u.pathname.match(/\/product\/([^/]+)/)?.[1];
      if(id)products.push({name:text(item.name),url:u.href,productId:id,seller,price:price?Number(price):null,msrp:null,image:embed.image?.url || embed.thumbnail?.url || null,status});
    }
    if(retailer==='target'){
      const description=String(embed.description || '');
      for(const m of description.matchAll(/\[([^\]]+)\]\([^)]+\)[\s\S]{0,80}?SKU[^0-9]{0,12}(\d{9,10})/gi)){
        if(!products.some(p=>p.productId===m[2]))products.push({name:'Pokemon TCG '+text(m[1]),url:'https://www.target.com/p/-/A-'+m[2],productId:m[2],seller:'',price:null,msrp:null,image:null,status:'upcoming'});
      }
    }
  }
  return [{kind:'news',retailer,sourceUrl:`https://discord.com/channels/${guildId}/${message.channelId}/${message.id}`,publishedAt:message.createdAt.toISOString(),editedAt:message.editedAt?.toISOString() || null,summary:'CCN source report: '+text(body).slice(0,940),products}];
}
function start(publish){
  const token=process.env.CCN_DISCORD_BOT_TOKEN;
  if(!token)return;
  state.configured=true;
  const {Client,GatewayIntentBits,Partials}=require('discord.js');
  client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],partials:[Partials.Message,Partials.Channel]});
  const pending=new Map();let flushing=false;
  async function drain(){
    if(flushing)return;flushing=true;
    try{for(const [key,row] of pending){
      if(row.nextTry>Date.now())continue;
      try{await publish(row.report);pending.delete(key);state.lastPublishedAt=new Date().toISOString();state.error=null;}
      catch{row.attempts++;row.nextTry=Date.now()+Math.min(3600000,15000*2**Math.min(row.attempts,8))+Math.random()*5000;state.error='Report publishing failed; retry pending.';}
    }}finally{flushing=false;}
  }
  async function receive(message){
    if(message.guildId!==guildId || !channels.has(message.channelId))return;
    try{
      if(message.partial)message=await message.fetch();
      state.lastReceivedAt=new Date().toISOString();
      for(const report of reports(message)){
        const at=Date.parse(report.editedAt || report.publishedAt);
        if(Date.now()-at>48*3600000)continue;
        pending.set(report.sourceUrl,{report,attempts:0,nextTry:0});
      }
      while(pending.size>100)pending.delete(pending.keys().next().value);
      await drain();
    }catch{state.error='Cannot read an authorized channel message. Check bot permissions.';}
  }
  async function catchUp(){
    for(const id of channels){
      try{const channel=await client.channels.fetch(id);if(!channel?.isTextBased() || !channel.messages)continue;
        const messages=await channel.messages.fetch({limit:25});
        for(const message of [...messages.values()].reverse())await receive(message);
      }catch{state.error='A configured channel is not accessible. Check bot channel permissions.';}
    }
  }
  client.on('messageCreate',receive);
  client.on('messageUpdate',(_,message)=>receive(message));
  client.on('ready',()=>{state.connected=true;state.error=null;catchUp().catch(()=>{});});
  client.on('shardDisconnect',()=>{state.connected=false;});
  client.on('shardResume',()=>{state.connected=true;catchUp().catch(()=>{});});
  client.on('error',()=>{state.error='Discord connection error. Check bot configuration.';});
  const retry=setInterval(()=>drain().catch(()=>{}),30000);retry.unref();
  const recovery=setInterval(()=>{if(state.connected)catchUp().catch(()=>{});},10*60000);recovery.unref();
  client.login(token).catch(()=>{state.connected=false;state.error='Bot login failed. Check the bot token and Message Content intent.';});
}
module.exports={start,health:()=>({...state})};
