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
    if(!product){
      const title=document.querySelector('#pdp-product-title-id')?.textContent?.trim();if(!title || !/pok[eé]mon/i.test(title))return;
      const area=document.querySelector('[class*="AboveTheFold"]');const visible=area?.innerText || '';const seller=/sold (?:and|&) shipped by target/i.test(visible)?'Target':'';
      const button=area?.querySelector('button[data-test="orderPickupButton"],button[data-test="shippingButton"]');
      const availability=seller && button && !button.disabled && /add to cart|preorder/i.test(button.innerText)?(/preorder/i.test(button.innerText)?'preorder':'available'):'unknown';
      const priceText=area?.querySelector('[data-test="product-price"]')?.textContent || '';const match=priceText.match(/\$(\d+(?:\.\d{2})?)/);
      chrome.runtime.sendMessage({kind:'targetObservation',payload:{url:location.href,title,seller,availability,price:match?Number(match[1]):null,image:document.querySelector('#PdpImageGallerySection img')?.currentSrc,itemNumber:location.pathname.match(/A-(\d+)/)?.[1]}}).catch(()=>{});return;
    }
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
