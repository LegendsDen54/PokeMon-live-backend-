'use strict';
// Reuse the monitor's known identifiers; catalog inclusion is not stock evidence.
const retail=require('./retail-catalog.json');
const catalogs={
  bestbuy:require('./bestbuy-catalog.json').products.map(p=>({name:p.name,id:p.sku})),
  dollargeneral:require('./dollar-general.json').products.map(p=>({name:p.name,id:p.upc})),
  barnes:require('./barnes-catalog.json').products.map(p=>({name:p.name,id:p.ean})),
  costco:(retail.costco||[]).map(p=>({name:p.label,id:p.itemNumber})),
  sams:(retail.sams||[]).map(p=>({name:p.label,id:p.itemNumber}))
};
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\betb\b/g,'elite trainer box').replace(/[^a-z0-9]+/g,' ').trim();
function choices(retailer,query=''){
  const terms=normalize(query).split(' ').filter(Boolean),seen=new Set();
  return (catalogs[retailer]||[]).filter(p=>{
    if(!p.id||seen.has(p.id)||!terms.every(t=>normalize(p.name+' '+p.id).includes(t)))return false;
    seen.add(p.id);return true;
  }).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,25).map(p=>({name:p.name.slice(0,100),value:String(p.id)}));
}
module.exports={choices};
