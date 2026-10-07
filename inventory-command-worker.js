"use strict";
// Optional provider relay. Never uses Discord user tokens or invokes another bot's commands.
module.exports=function createWorker(storage){
  const endpoint=process.env.INVENTORY_CHECKER_RELAY_URL;
  const token=process.env.INVENTORY_CHECKER_RELAY_TOKEN;
  const state={configured:Boolean(endpoint && token),running:false,lastCompletedAt:null,error:null};
  const retryAfter=new Map();
  let rerun=false;
  async function wake(){
    if(!state.configured)return;
    if(state.running){rerun=true;return;}
    state.running=true;
    try{
      do{
        rerun=false;
        const pending=await storage.pendingInventory();
        for(const request of pending){
          const key=[request.retailer,request.productId,request.zip].join(':');
          if((retryAfter.get(key)||0)>Date.now())continue;
          try{
            const url=new URL(endpoint);
            if(url.protocol!=='https:')throw Error('Relay requires HTTPS');
            const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({...request,idempotencyKey:key+':'+new Date(request.requestedAt).toISOString()}),signal:AbortSignal.timeout(45000)});
            if(!response.ok)throw Error('Relay unavailable');
            const result=await response.json();
            if(result.retailer!==request.retailer)throw Error('Retailer mismatch');
            if(result.kind==='cooldown'){
              await storage.recordCheckerCooldown(request.retailer,result.availableAt,result.sourceUrl);
            }else{
              if(String(result.productId)!==request.productId || result.zip!==request.zip || Date.parse(result.checkedAt)<Date.parse(request.requestedAt) || !Number.isFinite(Date.parse(result.checkedAt)))throw Error('Response does not match request');
              await storage.save(result);
              state.lastCompletedAt=new Date().toISOString();
            }
            retryAfter.delete(key);state.error=null;
          }catch{
            // Transport failures do not manufacture stock or a checker cooldown.
            retryAfter.set(key,Date.now()+30000);
            state.error='Provider relay failed; request remains queued for the collector.';
          }
        }
      }while(rerun);
    }catch{state.error='Request queue unavailable';}
    finally{state.running=false;}
  }
  if(state.configured){const timer=setInterval(wake,5000);timer.unref();wake();}
  return {wake,health:()=>({...state})};
};
