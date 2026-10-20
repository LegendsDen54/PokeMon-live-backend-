'use strict';
// Reuse the monitor's known identifiers; catalog inclusion is not stock evidence.
const retail=require('./retail-catalog.json');
const catalogs={
  bestbuy:require('./bestbuy-catalog.json').products.map(p=>({name:p.name,id:p.sku})),
  dollargeneral:require('./dollar-general.json').products.map(p=>({name:p.name,id:p.upc})),
  barnes:require('./barnes-catalog.json').products.map(p=>({name:p.name,id:p.ean})),
  costco:(retail.costco||[]).map(p=>({name:p.label,id:p.itemNumber,url:p.url})),
  sams:(retail.sams||[]).map(p=>({name:p.label,id:p.itemNumber,url:p.url}))
};
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\betb\b/g,'elite trainer box').replace(/[^a-z0-9]+/g,' ').trim();
const day=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
function eligible(retailer,product,reports,now){
  return reports.some(report=>{
    const at=Date.parse(report.publishedAt);
    if(!Number.isFinite(at)||at>now)return false;
    return (report.products||[]).some(p=>{
      if((p.retailer||report.retailer)!==retailer)return false;
      if(!(String(p.productId||'')===String(product.id)||product.url&&p.url===product.url))return false;
      if(p.status==='reported_available')return retailer==='costco'?now-at<=14*86400000:day(at)===day(now);
      // Only retailer-confirmed announcements with an explicit future date qualify.
      const date=String(p.expectedWindow||'').match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
      return p.status==='upcoming'&&p.dropClassification==='known'&&date&&date>=day(now);
    });
  });
}
function choices(retailer,query='',reports=[],now=Date.now()){
  const terms=normalize(query).split(' ').filter(Boolean),seen=new Set();
  return (catalogs[retailer]||[]).filter(p=>{
    if(!p.id||seen.has(p.id)||!eligible(retailer,p,reports,now)||!terms.every(t=>normalize(p.name+' '+p.id).includes(t)))return false;
    seen.add(p.id);return true;
  }).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,25).map(p=>({name:p.name.slice(0,100),value:String(p.id)}));
}
module.exports={choices};
