'use strict';
const ALLOWED_HOSTS=new Set(['i5.walmartimages.com','i5.wal.co','www.pokemoncenter.com','www.pokemon.com','images.pokemon.com','target.scene7.com','scene7.targetimg1.com','images.costco-static.com','scene7.samsclub.com','cdn.shopify.com','pbs.twimg.com','d24n0m32eirf1b.cloudfront.net']);
function publicImageUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&ALLOWED_HOSTS.has(url.hostname)?url.href:null;}catch{return null;}
}
const MAX_BYTES=3*1024*1024,MAX_CACHE_BYTES=16*1024*1024,cache=new Map(),pending=new Map();
let cacheBytes=0;
async function loadImage(url){
  if(pending.has(url))return pending.get(url);
  const job=(async()=>{
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(8000)});
    const type=(response.headers.get('content-type')||'').split(';')[0];
    if(!response.ok||!/^image\/(jpeg|png|webp|gif|avif)$/.test(type))throw Error('Product image could not load');
    if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('Image too large');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw Error('Image too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
    if(size<12)throw Error('Empty image');
    const body=Buffer.concat(chunks),old=cache.get(url);if(old)cacheBytes-=old.body.length;
    const image={body,type,savedAt:Date.now()};cache.delete(url);cache.set(url,image);cacheBytes+=size;
    while(cacheBytes>MAX_CACHE_BYTES){const first=cache.keys().next().value;cacheBytes-=cache.get(first).body.length;cache.delete(first);}
    return image;
  })();pending.set(url,job);try{return await job;}finally{pending.delete(url);}
}
async function handler(req,res){
  const url=publicImageUrl(req.query.url);if(!url)return res.status(400).send('Unsupported product image');
  let image=cache.get(url);
  try{if(!image||Date.now()-image.savedAt>86400000)image=await loadImage(url);}catch{if(!image)return res.status(503).set('Cache-Control','no-store').send('Product image temporarily unavailable');}
  res.set({'Content-Type':image.type,'Cache-Control':'public, max-age=86400, stale-if-error=604800','X-Content-Type-Options':'nosniff'}).send(image.body);
}
module.exports={handler,publicImageUrl};
