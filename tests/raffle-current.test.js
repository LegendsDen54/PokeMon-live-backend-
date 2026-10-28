'use strict';
const assert=require('node:assert/strict');
const policy=require('../raffle-policy');
const now=Date.parse('2026-10-26T00:00:00Z');
const upcoming={name:'Pokemon TCG Prismatic Evolutions 2Pk Booster Bundle',raffle:true,startsAt:'2026-10-26T21:00:00Z',endsAt:'2026-10-26T22:00:00Z'};
assert(policy.isCurrent(upcoming,now));
assert(policy.isCurrent({...upcoming,name:'One Piece Card Game Premium Booster Box'},now));
assert(!policy.isCurrent({...upcoming,name:'One Piece Figure'},now));
assert(!policy.isCurrent({...upcoming,name:'One Piece Card Game Mystery Repack'},now));
assert(!policy.isCurrent({...upcoming,startsAt:'2026-10-24T22:00:00Z',endsAt:null},now),'Past opening without closing time must not stay current');
assert(!policy.isCurrent({...upcoming,status:'closed'},now));
assert(!policy.isCurrent({...upcoming,name:'NeeDoh Nice Ice Baby'},now));
assert(!policy.isCurrent({...upcoming,name:'Pokemon Mystery Repack Booster Pack'},now));
assert(!policy.isCurrent(upcoming,Date.parse('2026-10-26T22:00:00Z')));
assert(policy.isCurrent(upcoming,Date.parse('2026-10-26T21:30:00Z')));
assert(policy.isPastAnnouncement({expectedWindow:'Confirmed scheduled drawing: October 21, 2026, 2:00–3:00 PM PDT'},now));
assert(!policy.isPastAnnouncement({expectedWindow:'Confirmed scheduled drawing: October 26, 2026, 2:00–3:00 PM PDT'},now));
assert(!policy.isPastAnnouncement({expectedWindow:'A future drawing may be announced'},now));
// Regression fixture reproduces Walmart's upcoming/closed carousel structure.
const oldFetch=global.fetch;
global.fetch=async()=>({ok:true,text:async()=>`<section><h2>Upcoming drawings</h2><div data-item-id="20288667355">Drawing entry window <span>Oct 26, 2:00pm - 3:00pm PDT</span></div></section><section><h2>Closed drawings</h2><div data-item-id="21077661804">Drawing results by today</div></section><script type="application/json">${JSON.stringify({items:[{usItemId:'20288667355',name:upcoming.name,showDrawCTA:true},{usItemId:'21077661804',name:'Pokemon 30th Celebration Booster Bundle 2-Pack',showDrawCTA:true},{usItemId:'9773718591',name:'NeeDoh Nice Ice Baby',showDrawCTA:true}]})}</script>`});
require('../walmart-raffles').scan().then(result=>{
  assert(result.ok);assert.equal(result.items.length,2,'Unrelated toys excluded at ingestion');
  assert.equal(result.items.find(i=>i.walmartItemId==='21077661804').raffleStatus,'closed','Closed section is authoritative despite showDrawCTA');
  assert.equal(result.items.find(i=>i.walmartItemId==='20288667355').endsAt,'2026-10-26T22:00:00.000Z');
  console.log('Raffle current/closed product and exact-window regressions passed');
}).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>global.fetch=oldFetch);
