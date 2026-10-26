'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const handlers={},opened=[],navigated=[];
const self={location:{origin:'https://monitor.test'},addEventListener:(k,v)=>handlers[k]=v,clients:{matchAll:async()=>[{url:'https://monitor.test/',navigate:async url=>{navigated.push(url);return {focus:async()=>{}};}}],openWindow:async url=>opened.push(url)}};
vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),{self,console,URL,Date,Promise,Response,fetch:async()=>{throw Error('offline');},encodeURIComponent});
async function click(data){let promise;handlers.notificationclick({notification:{data,close(){}},waitUntil:p=>promise=p});await promise;}
(async()=>{
  const source='https://discord.com/channels/1367457689386356766/1384205489679892540/1563244913598926920';
  await click({retailer:'walmart',url:'https://www.walmart.com/ip/20288667355',sourceUrl:source});assert.equal(opened.pop(),source,'Source ping must preserve exact message');
  const product='https://www.pokemoncenter.com/product/123/etb';await click({retailer:'pokemoncenter',url:product});assert.equal(opened.pop(),product,'Direct product alerts keep product');
  const draw='https://www.walmart.com/shop/collectibles/draw';await click({url:draw,retailer:'walmart'});assert.equal(opened.pop(),draw);
  await click({retailer:'costco',url:'/?retailer=costco&productId=2007496&zip=60634'});const privateUrl=new URL(navigated.pop());assert.equal(privateUrl.searchParams.get('productId'),'2007496');assert.equal(privateUrl.searchParams.get('zip'),'60634');
  await click({url:'javascript:alert(1)'});assert.equal(new URL(navigated.pop()).origin,'https://monitor.test');
  let response;handlers.fetch({request:{mode:'navigate',url:'https://monitor.test/?retailer=costco'},respondWith:p=>response=p});assert.match(await (await response).text(),/Monitor could not load/);
  console.log('Exact source, product, drawing, private search and offline navigation regressions passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
