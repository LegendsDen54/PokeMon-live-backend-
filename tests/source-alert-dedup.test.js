'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {identity,pokemonCenterEvidenceEligible}=require('../source-alert-identity');
const now=new Date().toISOString();
const base={game:'pokemon',retailer:'walmart',sourceUrl:'https://discord.com/channels/1410547930250612828/1514248684575920160/1557583216431337495',publishedAt:now,summary:'CCN: Orders rolling out from Walmart drawings! Check your order history or emails!'};
const repost={...base,sourceUrl:'https://discord.com/channels/1182136115981996033/1219394012406878238/1557583309662457931',summary:'Prismatic Evolutions & 30th Celebration Walmart Drawing Results Going Out Now! Check your email.'};
assert.equal(identity(base).event,identity(repost).event);
assert.notEqual(identity(base).event,identity({...base,summary:'Walmart drawings open now!'}).event);
assert.notEqual(identity(base).event,identity({...base,summary:'Walmart drawings tomorrow. If selected, your order will be placed automatically. Results expected soon.'}).event);
assert.notEqual(identity(base).event,identity({...base,retailer:'target'}).event);
assert.notEqual(identity(base).event,identity({...base,game:'onepiece'}).event);
assert.equal(identity(base).revision,identity({...base,summary:'A differently worded summary'}).revision);
assert.notEqual(identity(base).revision,identity({...base,editedAt:new Date(Date.now()+1000).toISOString()}).revision);
assert.equal(pokemonCenterEvidenceEligible({retailer:'pokemoncenter',summary:'Best Buy Pokémon stock update; Pokémon Center giveaways today'}),false);
assert.equal(pokemonCenterEvidenceEligible({retailer:'pokemoncenter',summary:'Pokémon Center Ascended Heroes ETB invitation period warning'}),true);
assert.equal(pokemonCenterEvidenceEligible({retailer:'bestbuy',summary:'Pokémon Center invite mentioned in giveaway'}),false);

const claims=new Map();let gate=Promise.resolve();
const query=async(sql,args)=>{
  if(sql.startsWith('CREATE') || sql==='BEGIN' || sql==='COMMIT' || sql==='ROLLBACK')return {rows:[]};
  if(sql.startsWith('SELECT data'))return {rows:[]};
  if(sql.startsWith('SELECT pg_advisory'))return {rows:[]};
  if(sql.startsWith('SELECT claim_key'))return {rows:args[0].filter(k=>claims.has(k)).map(k=>({claim_key:k,claimed_at:claims.get(k)}))};
  if(sql.startsWith('INSERT INTO ccn_news_notification_claims')){claims.set(args[0],new Date());return {rows:[]};}
  if(sql.startsWith('DELETE')){for(const key of args[0])claims.delete(key);return {rows:[]};}
  throw Error('Unexpected mock query: '+sql);
};
const pool={query,connect:async()=>{const previous=gate;let release;gate=new Promise(r=>release=r);await previous;return {query,release};}};
const context={module:{exports:{}},process:{env:{DATABASE_URL:'mock'}},Date,Set,Map,Intl,require:name=>name==='pg'?{Pool:function(){return pool;}}:name==='./source-alert-identity'?require('../source-alert-identity'):require(name)};
vm.runInNewContext(fs.readFileSync(require.resolve('../ccn-inventory'),'utf8'),context);
(async()=>{
  const api=context.module.exports;
  const outcomes=await Promise.all([api.claimNewsNotification(base),api.claimNewsNotification(base),api.claimNewsNotification(repost)]);
  assert.equal(outcomes.filter(r=>r.allowed).length,1,'Concurrent same-message and cross-source outcomes send once');
  assert.equal((await api.claimNewsNotification({...base,summary:'Reworded orders rolling out from Walmart drawings'})).allowed,false);
  assert.equal((await api.claimNewsNotification({...base,sourceUrl:base.sourceUrl+'9',summary:'Walmart drawings open now'})).allowed,true,'Different opening event survives');
  await api.releaseNewsNotification(base);
  assert.equal((await api.claimNewsNotification(base)).allowed,true,'All-failed send may retry');
  const prior={...base,sourceUrl:base.sourceUrl+'8',pipeline:{sourceAt:now,notification:{sent:15}}};
  assert.equal((await api.claimNewsNotification(prior)).allowed,false,'Previously accepted legacy receipt suppresses replay');
  console.log('Source alert tests passed: drawing-result reposts, retailer/game isolation, revision edits, concurrent claims, retry and PC giveaway exclusion.');
})().catch(error=>{console.error(error);process.exitCode=1;});
