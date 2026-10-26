'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {handler,publicImageUrl}=require('../product-images');
assert.equal(publicImageUrl('https://127.0.0.1/photo.jpg'),null);
assert.equal(publicImageUrl('https://i5.walmartimages.com.evil.test/photo.jpg'),null);
assert.equal(publicImageUrl('https://user:password@i5.walmartimages.com/photo.jpg'),null);
assert.equal(publicImageUrl('file:///photo.jpg'),null);
const source='https://i5.walmartimages.com/test-product.jpg';
const photo=fs.readFileSync(require.resolve('../product-images/walmart-19952559023.jpg'));
let calls=0;const oldFetch=global.fetch;
global.fetch=async()=>{calls++;return new Response(photo,{headers:{'content-type':'image/jpeg'}});};
function result(){return {code:200,headers:{},status(code){this.code=code;return this;},set(headers,value){if(typeof headers==='string')this.headers[headers]=value;else Object.assign(this.headers,headers);return this;},send(body){this.body=body;return this;}};}
(async()=>{
  const first=result();await handler({query:{url:source}},first);assert.equal(first.code,200);assert.deepEqual(first.body,photo);
  global.fetch=async()=>{calls++;throw Error('Image host offline');};
  const cached=result();await handler({query:{url:source}},cached);assert.deepEqual(cached.body,photo);assert.equal(calls,1,'Cached image survives image-host outage');
  const invalid=result();await handler({query:{url:'https://evil.test/a.jpg'}},invalid);assert.equal(invalid.code,400);
  global.fetch=async()=>new Response('<html>Not an image</html>',{headers:{'content-type':'text/html'}});
  const bad=result();await handler({query:{url:'https://i5.walmartimages.com/bad.jpg'}},bad);assert.equal(bad.code,503);
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const context={URL,encodeURIComponent,safeExternalUrl:v=>{try{return new URL(v).protocol==='https:'?v:null;}catch{return null;}}};
  vm.runInNewContext(html.slice(html.indexOf('function productImageSource('),html.indexOf('function retailerImageMarkup(')),context);
  assert.equal(context.productImageSource(null,'19952559023'),'/product-images/walmart-19952559023.jpg');
  assert.match(context.productImageSource(source),/^\/api\/product-image\?url=/);
  const handlers={},stored=new Map();let networkCalls=0;
  const cache={match:async r=>stored.get(r.url)?.clone(),put:async(r,v)=>stored.set(r.url,v),keys:async()=>[...stored.keys()].map(url=>new Request(url)),delete:async r=>stored.delete(r.url)};
  const self={location:{origin:'https://monitor.test'},addEventListener:(k,v)=>handlers[k]=v};
  vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),{self,console,URL,Date,Promise,Response,caches:{open:async()=>cache},fetch:async()=>{networkCalls++;if(networkCalls>1)throw Error('offline');return new Response(photo,{headers:{'content-type':'image/jpeg'}});},encodeURIComponent});
  async function imageRequest(){let response;handlers.fetch({request:{url:'https://monitor.test/api/product-image?url=x',destination:'image'},respondWith:p=>response=p});return response;}
  assert.equal((await imageRequest()).status,200);assert.equal((await imageRequest()).status,200);assert.equal(networkCalls,1,'Browser retains last good image across server or upstream outages');
  console.log('Product image regression checks passed: exact local photo, host validation, cached outage, non-image rejection and persistent browser fallback.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>global.fetch=oldFetch);
