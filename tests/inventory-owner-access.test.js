'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('connected owner sees saved checker errors while ordinary viewers retain private access',async()=>{
  const reports=[{data:{productId:'2007496',checkedAt:new Date().toISOString(),result:'checker_error',sourceText:'Exact different-product response'}},{data:{productId:'2007495',checkedAt:new Date().toISOString(),result:'results'}}];
  class Pool{async query(sql,args){
    if(sql.startsWith('SELECT data FROM ccn_inventory_reports'))return {rows:reports};
    if(sql.startsWith('SELECT product_id FROM inventory_search_viewers'))return {rows:args[0]==='requester'?[{product_id:'2007495'}]:[]};
    return {rows:[]};
  }}
  const context={module:{exports:{}},process:{env:{DATABASE_URL:'test'}},require:name=>{if(name==='pg')return {Pool};throw Error(name);},console};
  vm.runInNewContext(fs.readFileSync(require.resolve('../ccn-inventory'),'utf8'),context);
  const list=context.module.exports.list;
  assert.equal((await list('costco','89128',null)).length,0);
  assert.equal((await list('costco','89128','unrelated')).length,0);
  assert.equal((await list('costco','89128','requester')).length,1);
  const owner=await list('costco','89128',null,true);
  assert.equal(owner.length,2);
  assert.equal(owner[0].sourceText,'Exact different-product response');
  assert.equal(owner[0].result,'checker_error');
});
