'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('five-minute personal window applies to all three manual warehouse checkers',async()=>{
 const context={module:{exports:{}},process:{env:{}},require:name=>name==='pg'?{Pool:function(){}}:require('../'+name.replace(/^\.\//,'')),console};
 vm.runInNewContext(fs.readFileSync(require.resolve('../ccn-inventory'),'utf8')+'\nmodule.exports.windowForTest=personalSearchWindow;',context);
 for(const retailer of ['costco','sams','bestbuy']){
  let queried=false;const expected=new Date(Date.now()+300000).toISOString();
  const value=await context.module.exports.windowForTest(retailer,'viewer',{query:async(sql,args)=>{queried=true;assert.match(sql,/interval '5 minutes'/);assert.equal(args[1],retailer);return {rows:[{available_at:expected}]};}});
  assert.equal(queried,true);assert.equal(value,expected);
 }
});
