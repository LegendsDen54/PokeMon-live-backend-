'use strict';
const assert=require('node:assert/strict');
const {create}=require('../discord-search-delivery');
(async()=>{
  const rows=new Map(),sent=[],checks=[];let status='queued';
  const pool={query:async(sql,args=[])=>{
    if(sql.startsWith('CREATE'))return {rows:[]};
    if(sql.startsWith('INSERT')){const [interaction_id,application_id,callback,viewer_id,retailer,product_id,zip,expires_at]=args;rows.set(interaction_id,{interaction_id,application_id,callback,viewer_id,retailer,product_id,zip,expires_at});return {rows:[]};}
    if(sql.startsWith('SELECT'))return {rows:[...rows.values()]};
    if(sql.includes('WHERE interaction_id=$1'))rows.delete(args[0]);
    return {rows:[]};
  }};
  const inventory={inventoryRequestStatus:async(...args)=>{checks.push(args);return {status};},list:async()=>[{productId:'2007495',name:'Actual report',checkedAt:new Date().toISOString(),sourceUrl:'https://discord.com/channels/1/2/3',locations:[{name:'Actual store',onHand:null,onOrder:null,inTransit:77}]}]};
  const env={DISCORD_BOT_TOKEN:'test-only-encryption-key'};
  const fetchImpl=async(url,options)=>{sent.push({url,...JSON.parse(options.body)});return {ok:true,status:200};};
  const first=create({inventory,env,pool,fetchImpl});
  const id=String((BigInt(Date.now()-1420070400000)<<22n));
  await first.track({id,application_id:'100',token:'private-test-callback'},'discord:private-viewer',{retailer:'costco',product:'2007495',zip:'60634'});
  assert(!rows.get(id).callback.includes('private-test-callback'),'Callback must be encrypted at rest');
  await first.drain();assert.equal(sent.length,0,'Queued checks must not be reported completed');first.stop();
  // A replacement process can decrypt the saved callback and deliver only to
  // the original private interaction, using the original viewer permission.
  const restarted=create({inventory,env,pool,fetchImpl});status='completed';await restarted.drain();restarted.stop();
  assert.equal(sent.length,1);assert(sent[0].url.endsWith('/private-test-callback/messages/@original'));
  assert.match(sent[0].embeds[0].fields[0].value,/On hand:\*\* Unknown.*In transit:\*\* 77/);
  assert.deepEqual(sent[0].allowed_mentions,{parse:[]});assert.equal(rows.size,0);
  assert(checks.every(a=>a[3]==='discord:private-viewer'));
  assert.equal(sent.filter(s=>s.url.includes('monitor-alert')).length,0,'Private search must not broadcast');
  const {formatReportMessage}=require('../discord-commands');
  const card=formatReportMessage({name:'Mini tins',checkedAt:'2026-10-20T20:46:03Z',sourceUrl:'https://discord.com/channels/1/2/3',locations:[{name:'NILES',onHand:null,onOrder:null,inTransit:77,distanceMiles:4.9,sourceFields:[{name:'Qty',value:'77'},{name:'Status',value:'In Transit'},{name:'Added',value:'Oct 19th'},{name:'ZIP',value:'60714'}]}]},'costco');
  assert.match(card.embeds[0].fields[0].value,/Qty:\*\* 77.*Status:\*\* In Transit/);
  assert.match(card.embeds[0].fields[0].value,/Added:\*\* Oct 19th/);assert.match(card.embeds[0].fields[0].value,/60714.*4.9 mi/);
  const many=formatReportMessage({name:'UPC',checkedAt:'now',locations:Array.from({length:50},(_,i)=>({name:'Store '+i,onHand:null,onOrder:null,inTransit:null}))},'dollargeneral');
  assert.equal(many.embeds.flatMap(e=>e.fields).length,50);assert(many.embeds.every(e=>e.fields.length<=25));
  console.log('Discord completion: encrypted restart recovery, pending isolation, original private destination, unknown quantities and successful cleanup passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
