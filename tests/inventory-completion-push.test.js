'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
async function scenario(retailer,active,delay,result='no_stock_reported'){
  let notice=null,sent=[];
  const now=Date.now(),requestedAt=new Date(now-delay).toISOString();
  const pool={query:async(sql,args)=>{
    if(sql.startsWith('CREATE'))return {rows:[]};
    if(sql.startsWith('SELECT v.'))return {rows:[{viewer_id:'requesting-device',requested_at:requestedAt}]};
    if(sql.startsWith('SELECT 1'))return {rowCount:active?1:0};
    if(sql.startsWith('INSERT INTO inventory_completion_notices')){notice ||= {viewer_id:args[0],retailer:args[1],product_id:args[2],zip:args[3],requested_at:args[4],payload:args[5],state:args[6],attempts:0};return {};}
    if(sql.startsWith('SELECT *'))return {rows:notice?.state==='pending'?[notice]:[]};
    if(sql.startsWith('SELECT endpoint')){assert.equal(args[0],'requesting-device');return {rows:[{endpoint:'only-requesting-device'}]};}
    if(sql.startsWith('UPDATE inventory_completion_notices')){notice.state=args[5];return {};}
    throw Error('Unexpected query');
  }};
  const context={exports:{},process:{env:{DATABASE_URL:'mock'}},console,setInterval:()=>({unref(){}}),require:name=>name==='pg'?{Pool:function(){return pool;}}:{sendPrivate:async(endpoint,payload)=>{sent.push({endpoint,payload});return {ok:true};}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../inventory-completion-push'),'utf8'),context);
  const report={retailer,productId:'12345',zip:'60634',name:'Test product',checkedAt:new Date(now).toISOString(),result,locations:[]};
  await context.exports.completed(report);
  for(let i=0;i<5;i++)await new Promise(setImmediate);
  assert.equal(sent.length,active&&delay<30000?0:1);
  assert.equal(notice.state,active&&delay<30000?'suppressed':'sent');
  if(sent.length){assert.equal(sent[0].endpoint,'only-requesting-device');assert.match(sent[0].payload.url,/productId=12345&zip=60634/);assert.match(sent[0].payload.body,result==='checker_error'?/stock is unknown/:/missing stores remain unknown/);}
  await context.exports.completed(report);
  for(let i=0;i<5;i++)await new Promise(setImmediate);
  assert.equal(sent.length,active&&delay<30000?0:1,'Repeated report must not send twice');
}
(async()=>{
  for(const retailer of ['bestbuy','costco','sams','dollargeneral','barnes']){await scenario(retailer,true,5000);await scenario(retailer,true,60000);await scenario(retailer,false,5000);await scenario(retailer,false,60000,'checker_error');}
  console.log('20 private completion scenarios passed: foreground suppression, delayed/background delivery, errors, and deduplication.');
})().catch(e=>{console.error(e);process.exitCode=1;});
