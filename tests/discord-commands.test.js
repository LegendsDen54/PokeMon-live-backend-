'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {create,verified}=require('../discord-commands');
(async()=>{
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const hex=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
  const timestamp=String(Math.floor(Date.now()/1000));
  const raw=Buffer.from('{"type":1}');
  const sig=crypto.sign(null,Buffer.concat([Buffer.from(timestamp),raw]),privateKey).toString('hex');
  assert(verified(raw,sig,timestamp,hex));
  assert(!verified(Buffer.from('{}'),sig,timestamp,hex));
  assert(!verified(raw,sig,timestamp,hex,Date.now()+600001));
  const calls=[],posted=[]; let cooldown=false;
  const inventory={
    stockCommandNews:async()=>[{publishedAt:new Date().toISOString(),retailer:'bestbuy',products:[{productId:'6606082',status:'reported_available'}]}],
    requestInventory:async(...args)=>{calls.push(args);return cooldown?{status:'cooldown',availableAt:'2026-10-21T00:00:00Z'}:{status:'queued'};},
    requestDg:async()=>{throw Error('Unexpected DG');},
    inventoryRequestStatus:async()=>({status:'completed'}),
    list:async(retailer,zip,viewer)=>{assert.match(viewer,/^discord:[a-f0-9]{64}$/);return [{productId:'2007495',name:'Test TCG',checkedAt:'2026-10-20T12:00:00Z',sourceUrl:'https://discord.com/channels/1/2/3',locations:Array.from({length:60},(_,i)=>({name:'Store '+i,address:'Test address',onHand:i?null:2,onOrder:null,inTransit:null}))}];}
  };
  const env={DISCORD_APPLICATION_PUBLIC_KEY:hex,DISCORD_APPLICATION_ID:'100',DISCORD_GUILD_ID:'200'};
  const bridge=create({inventory,env,fetchImpl:async(url,opts)=>{posted.push({url,body:JSON.parse(opts.body)});return {ok:true};}});
  const input={id:'123',application_id:'100',guild_id:'200',type:2,token:'placeholder',member:{user:{id:'300'}},data:{name:'stock',options:[{name:'retailer',value:'costco'},{name:'product',value:'2007495'},{name:'zip',value:'60634'}]}};
  assert.match(await bridge.execute(input),/queued/);
  assert.equal(calls[0][0],'costco');assert.equal(calls[0][2],'60634');
  assert(!calls[0][3].includes('300'),'Raw Discord member ID is not used as viewer identity');
  cooldown=true;assert.match(await bridge.execute(input),/cooldown/);
  const output=await bridge.execute({...input,data:{...input.data,name:'stockstatus'}});
  assert.match(output,/on hand unknown/);assert.match(output,/Showing \d+ of 60/);assert(output.length<=2000);
  function req(body,invalid=false){const bytes=Buffer.from(JSON.stringify(body));return {body:bytes,get:name=>name==='X-Signature-Timestamp'?timestamp:invalid?'0'.repeat(128):crypto.sign(null,Buffer.concat([Buffer.from(timestamp),bytes]),privateKey).toString('hex')};}
  function res(){return {code:200,status(n){this.code=n;return this;},json(value){this.value=value;return this;},sendStatus(n){this.code=n;return this;}};}
  const rejected=res();await bridge.handler(req(input,true),rejected);assert.equal(rejected.code,401);
  const other=res();await bridge.handler(req({...input,guild_id:'999'}),other);assert.equal(other.value.data.flags,64);assert.equal(posted.length,0);
  const ping=res();await bridge.handler(req({type:1,application_id:'100'}),ping);assert.deepEqual(ping.value,{type:1});
  const suggestion=res();await bridge.handler(req({...input,type:4,data:{name:'stock',options:[{name:'retailer',value:'bestbuy'},{name:'product',value:'prismatic etb',focused:true}]}}),suggestion);
  assert.equal(suggestion.value.type,8);assert(suggestion.value.data.choices.some(p=>p.value==='6606082'));
  assert(suggestion.value.data.choices.length<=25);assert.equal(posted.length,0,'Autocomplete never requests stock or sends a followup');
  const outside=res();await bridge.handler(req({...input,type:4,guild_id:'999'}),outside);assert.deepEqual(outside.value,{type:8,data:{choices:[]}});
  const {choices}=require('../discord-product-choices');
  const catalogNow=Date.parse('2026-10-20T19:00:00Z');
  const reports=[{publishedAt:'2026-10-20T12:00:00Z',products:[{retailer:'dollargeneral',productId:'196214158801',status:'reported_available'},{retailer:'barnes',productId:'0196214158801',status:'reported_available'}]}];
  assert(choices('barnes','30th',reports,catalogNow).every(p=>/^\d{13}$/.test(p.value)));
  assert(choices('dollargeneral','30th',reports,catalogNow).some(p=>p.value==='196214158801'));
  const costcoReport=at=>[{publishedAt:at,retailer:'costco',products:[{productId:'2007495',status:'reported_available'}]}];
  assert(choices('costco','',costcoReport('2026-10-06T19:00:00Z'),catalogNow,[]).length>0);
  assert.equal(choices('costco','',costcoReport('2026-10-06T18:59:59Z'),catalogNow,[]).length,0);
  assert.equal(choices('bestbuy','',[{publishedAt:'2026-10-19T18:00:00Z',retailer:'bestbuy',products:[{productId:'6606082',status:'reported_available'}]}],catalogNow).length,0);
  const upcoming=known=>[{publishedAt:'2026-10-19T12:00:00Z',retailer:'bestbuy',products:[{productId:'6606082',status:'upcoming',dropClassification:known?'known':'potential',expectedWindow:'2026-10-23'}]}];
  assert(choices('bestbuy','prismatic',upcoming(true),catalogNow).length>0);
  assert.equal(choices('bestbuy','prismatic',upcoming(false),catalogNow).length,0);
  assert.equal(choices('costco','',[],catalogNow,[]).length,0,'Catalog verification date alone is not a drop');
  assert.deepEqual(choices('costco','mini tins',[],Date.parse('2026-10-20T20:20:00Z')),[{name:'Pokemon Ascended Heroes 5 Mini Tins 2-Pack',value:'2007495'}]);
  assert.equal(choices('costco','mini tins',[],Date.parse('2026-11-03T19:00:00Z')).length,0,'Dated Radar inventory must expire after 14 days');
  assert.equal(choices('costco','no such product').length,0);
  assert(choices('costco').every(p=>/^\d+$/.test(p.value)),'Unknown item numbers must not become suggestions');
  const accepted=res();await bridge.handler(req(input),accepted);assert.equal(accepted.value.type,5);assert.equal(accepted.value.data.flags,64);assert.equal(posted.length,1);assert.deepEqual(posted[0].body.allowed_mentions,{parse:[]});
  await bridge.handler(req(input),res());assert.equal(posted.length,1,'Duplicate interaction must not queue or reply twice');
  console.log('Discord commands: signed requests, replay age, server restriction, ephemeral responses, cooldowns, private identity and full-result truncation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
