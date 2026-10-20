'use strict';
const assert = require('node:assert/strict');
const {create} = require('../discord-alerts');
(async () => {
  const calls=[];
  const env={DISCORD_ALERT_WEBHOOK_URL:'https://discord.com/api/webhooks/123/example-placeholder'};
  const sender=create({env,fetchImpl:async(url,options)=>{
    calls.push({url,...options}); return {ok:true,json:async()=>({id:'456'})};
  }});
  const alert={eventId:'fresh-source',title:'Potential Pokémon Center drop',body:'@everyone Source prediction; stock unconfirmed.',
    url:'https://www.pokemoncenter.com/',sourceUrl:'https://discord.com/channels/1/2/3',publishedAt:'2026-10-20T17:18:14Z'};
  const receipts=await Promise.all([sender.send(alert),sender.send(alert)]);
  assert.equal(calls.length,1,'Concurrent duplicate alerts send once');
  assert.equal(receipts[0].messageId,'456');
  assert.match(calls[0].url,/\?wait=true$/);
  const body=JSON.parse(calls[0].body);
  assert.deepEqual(body.allowed_mentions,{parse:[]});
  assert.equal(body.embeds[0].fields.length,2);
  await sender.send({...alert,eventId:'private',zip:'60634'});
  await sender.send({...alert,eventId:'test',tag:'push-test'});
  assert.equal(calls.length,1,'Private inventory and test pushes stay out of Discord');
  await sender.send({...alert,eventId:'revision',body:'A real new source revision'});
  assert.equal(calls.length,2);
  assert.equal((await create().send(alert)).reason,'not_configured');
  for(const bad of ['https://example.com/api/webhooks/123/secret','http://discord.com/api/webhooks/123/secret','https://discord.com.evil.test/api/webhooks/123/secret']) {
    assert.equal((await create({env:{DISCORD_ALERT_WEBHOOK_URL:bad},fetchImpl:()=>{throw Error('must not send');}}).send(alert)).reason,'invalid_webhook_configuration');
  }
  const limited=create({env,fetchImpl:async()=>({ok:false,status:429,headers:new Headers({'retry-after':'3'})})});
  assert.equal((await limited.send(alert)).retryAfterSeconds,3);
  const unknown=create({env,fetchImpl:async()=>{throw Error('secret webhook must never appear');}});
  assert.deepEqual(await unknown.send(alert),{ok:false,reason:'delivery_unknown'});
  console.log('Discord alerts: deduplication, attribution, mentions, private isolation, URL validation and safe failures passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
