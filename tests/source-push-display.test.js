'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const stored=new Map(),shown=[];
function worker(){
  const listeners={};
  const cache={match:async key=>stored.get(key.url)?.clone(),put:async(key,value)=>stored.set(key.url,value),keys:async()=>[...stored.keys()].map(url=>new Request(url)),delete:async key=>stored.delete(key.url)};
  const self={addEventListener:(name,handler)=>listeners[name]=handler,location:{origin:'https://example.test'},registration:{showNotification:async(title,options)=>shown.push({title,options})}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),{self,console:{log(){},error(){}},caches:{open:async()=>cache},URL,Request,Response,Date,Promise,encodeURIComponent});
  return data=>{let completion;listeners.push({data:{json:()=>data},waitUntil:work=>completion=work});return completion;};
}
(async()=>{
  let deliver=worker();
  const alert={eventId:'walmart-results-revision',title:'Orders rolling out from Walmart',tag:'ccn-news-results'};
  await Promise.all([deliver(alert),deliver(alert),deliver(alert)]);
  assert.equal(shown.length,1,'Concurrent duplicate push delivery displays once');
  deliver=worker();await deliver(alert);
  assert.equal(shown.length,1,'Receipt survives worker restart');
  await deliver({...alert,eventId:'new-actual-revision',tag:'new-event'});
  assert.equal(shown.length,2,'A new event displays');
  await deliver({title:'Manual stock result',tag:'private-request'});
  assert.equal(shown.length,3,'Other stock request notifications remain active');
  console.log('Device display tests passed: repeated delivery, concurrency, restart persistence, new event and manual-result isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
