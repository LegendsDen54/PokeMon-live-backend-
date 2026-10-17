'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const view=require('../inventory-report-view');
test('preserves long Rip Radar details, source labels, multiline text and all locations',()=>{
  const input={detail:'Uploaded inventory; verify before driving. '.repeat(30),sourceText:'Rip Radar\nOn Hand: 1,058\nAdded Sept 24th\nCall club to verify.',sourceFields:[{name:'Radius',value:'50 miles'},{name:'Uploaded',value:'Sept 24th'}],locations:Array.from({length:115},(_,i)=>({name:'Club '+i,address:'ZIP 60164',onHand:i===0?0:null,onOrder:24,inTransit:null,distanceMiles:4.8,status:'Uploaded Sept 24th',sourceFields:[{name:'Price',value:'$39.98'},{name:'Reported quantity',value:'100+'}]}))};
  const result=view.cleanDetails(input);
  assert.deepEqual(result,input);
  const html=view.render({...result,source:'Rippin Packz stock checker',sourceUrl:'https://discord.com/channels/1367457689386356766/1548379934207254649/1560778105516331090'});
  assert.match(html,/Reported locations \(115\)/);assert.match(html,/4.8 miles/);assert.match(html,/100\+/);assert.match(html,/\$39.98/);assert.ok(html.includes(input.sourceText));assert.ok(html.includes(input.detail));
});
test('keeps zero distinct from missing quantities and never renders source HTML',()=>{
  const html=view.render({locations:[{name:'<img src=x onerror=alert(1)>',onHand:0,inTransit:null,onOrder:2}],sourceText:'<script>alert(1)</script>',sourceUrl:'javascript:alert(1)'});
  assert.match(html,/<dt>On hand<\/dt><dd>0<\/dd>/);assert.match(html,/<dt>In transit<\/dt><dd>Not supplied/);
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));
});
test('rejects oversize content explicitly instead of silently cutting the report',()=>{
  assert.throws(()=>view.cleanDetails({sourceText:'x'.repeat(60001)}),/too long/);
  assert.throws(()=>view.cleanDetails({locations:Array(1001).fill({})}),/Invalid location/);
});
test('storage normalizer retains original response and extra fields',()=>{
  const context={module:{exports:{}},exports:{},process:{env:{}},require:name=>name==='pg'?{Pool:function(){}}:require('../'+name.replace(/^\.\//,'')),console};
  vm.runInNewContext(fs.readFileSync(require.resolve('../ccn-inventory'),'utf8')+'\nmodule.exports.cleanForTest=clean;',context);
  const result=context.module.exports.cleanForTest({retailer:'sams',productId:'990518062',zip:'60634',name:'Focused Fighters',checkedAt:new Date().toISOString(),sourceUrl:'https://discord.com/channels/1367457689386356766/1548379934207254649/1560778105516331090',result:'results',detail:'x'.repeat(700),sourceText:'Actual multiline\nchecker response',sourceFields:[{name:'Radius',value:'50 miles'}],locations:[{name:'Club',distanceMiles:4.8,onHand:0,sourceFields:[{name:'Added',value:'Sept 24th'}]}]});
  assert.equal(result.detail.length,700);assert.equal(result.sourceText,'Actual multiline\nchecker response');assert.equal(result.locations[0].sourceFields[0].value,'Sept 24th');assert.equal(result.sourceFields[0].value,'50 miles');
});
