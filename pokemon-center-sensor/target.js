"use strict";
(() => {
  if(window.__retailProductSensor) return;
  window.__retailProductSensor=true;
  const retailer="target";
  let signature="";let timer;
  function report() {
    const nodes=[];
    const walk=v=>{if(Array.isArray(v)) return v.forEach(walk);if(!v || typeof v!=="object")return;if([].concat(v["@type"] || []).includes("Product"))nodes.push(v);if(v["@graph"])walk(v["@graph"]);};
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el=>{try{walk(JSON.parse(el.textContent));}catch{}});
    const product=nodes.find(p=>/pok[eé]mon/i.test(p.name || ""));
    if(!product) return;
    const offer=[].concat(product.offers || []).find(o=>/^target$/i.test(o?.seller?.name || ""));
    if(!offer)return;
    const status=String(offer.availability || "").split("/").pop();
    const availability=({InStock:"available",PreOrder:"preorder",PreSale:"preorder",OutOfStock:"unavailable",SoldOut:"unavailable",Discontinued:"unavailable"})[status] || "unknown";
    const url=new URL(location.href);url.search="";url.hash="";
    const image=[].concat(product.image || [])[0];
    const payload={seller:"Target",url:url.href,title:product.name,image:typeof image==="object"?image.url:image,price:offer.price!=null && offer.price!==""?Number(offer.price):null,itemNumber:product.sku || product.productID || null,availability,observedAt:new Date().toISOString()};
    const next=JSON.stringify({...payload,observedAt:null});
    chrome.runtime.sendMessage({kind:retailer+"Observation",payload}).then(response=>{if(response?.ok)signature=next;}).catch(()=>{});
  }
  report();
  new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(report,1500);}).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["content"]});
  // A fresh observation heartbeat prevents idle pages from appearing disconnected.
  setInterval(report,60000);
})();
