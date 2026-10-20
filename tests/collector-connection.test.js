const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../ccn-import.html'),'utf8');
function collector(reply){
  const elements=new Map(),requests=[];
  const document={visibilityState:'visible',addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',addEventListener(){}});return elements.get(id);}};
  const context=vm.createContext({document,window:{addEventListener(){}},sessionStorage:{getItem(){return null;},removeItem(){}},fetch:async(url,options)=>{requests.push({url,options});return reply();}});
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  return {context,elements,requests};
}
test('connecting an already paired collector never requests another key or creates another session',async()=>{
  const c=collector(()=>({ok:true,json:async()=>({connected:true})}));
  await c.elements.get('connectOwner').onclick();
  assert.match(c.elements.get('ownerStatus').textContent,/Owner collector connected/);
  assert.ok(c.requests.every(r=>!r.options.method));
});
test('a failed connection check stays unknown instead of asking for a pairing key',async()=>{
  const c=collector(()=>({ok:false}));
  await c.elements.get('connectOwner').onclick();
  assert.match(c.elements.get('ownerStatus').textContent,/Pairing status is unknown/);
  assert.ok(c.requests.every(r=>!r.options.method));
});
test('a confirmed unpaired collector still requires the existing key',async()=>{
  const c=collector(()=>({ok:true,json:async()=>({connected:false})}));
  await c.elements.get('connectOwner').onclick();
  assert.equal(c.elements.get('ownerStatus').textContent,'Enter the existing owner pairing key once.');
});
