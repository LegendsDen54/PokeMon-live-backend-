(function(root){
  'use strict';
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function bounded(value,max,label){
    const text=String(value ?? '');
    if(text.length>max)throw Error(label+' is too long; split the actual response into smaller reports instead of truncating it');
    return text;
  }
  function fields(value){
    if(value==null)return [];
    if(!Array.isArray(value)||value.length>100)throw Error('Invalid source fields');
    return value.map(field=>({name:bounded(field.name,240,'Field name'),value:bounded(field.value,12000,'Field value')}));
  }
  function cleanDetails(input){
    const rows=input.locations ?? [];
    if(!Array.isArray(rows)||rows.length>1000)throw Error('Invalid location list');
    const quantity=value=>Number.isInteger(value)&&value>=0?value:null;
    const products=input.products;
    if(products!=null&&(!Array.isArray(products)||products.length>200))throw Error('Invalid product list');
    const seen=new Set();
    const cleanedProducts=products==null?undefined:products.map(product=>{
      const sku=String(product.sku||product.productId||'');
      if(!/^\d{7,8}$/.test(sku)||seen.has(sku)||!product.name)throw Error('Each product needs a unique actual SKU and name');seen.add(sku);
      if(product.products!=null)throw Error('Nested product lists are not supported');
      return {sku,name:bounded(product.name,500,'Product name'),lastScanned:bounded(product.lastScanned,240,'Last scanned'),...cleanDetails({...product,products:undefined})};
    });
    return {
      ...(cleanedProducts?{products:cleanedProducts}:{}),
      detail:bounded(input.detail,12000,'Check details'),
      sourceText:bounded(input.sourceText,60000,'Original checker response'),
      sourceFields:fields(input.sourceFields),
      locations:rows.map(row=>({
        name:bounded(row.name,300,'Location name'),address:bounded(row.address,600,'Address'),
        onOrder:quantity(row.onOrder),inTransit:quantity(row.inTransit),onHand:quantity(row.onHand),
        distanceMiles:Number.isFinite(row.distanceMiles)&&row.distanceMiles>=0?row.distanceMiles:null,
        status:bounded(row.status || 'Not published',2000,'Location status'),
        sourceFields:fields(row.sourceFields)
      }))
    };
  }
  const fieldMarkup=items=>(items || []).map(f=>'<div><dt>'+esc(f.name)+'</dt><dd>'+esc(f.value)+'</dd></div>').join('');
  function resultVisible(report,now=Date.now()){
    return Number.isFinite(Date.parse(report.checkedAt));
  }
  function render(report){
    if(report.retailer==='bestbuy'&&report.productId==='all-products')return renderBestBuy(report);
    let rows=report.locations || [];
    let unmatched=false;
    if(report.retailer==='costco' && !rows.length && report.result==='checker_error' && report.sourceText){
      const pattern=/(?:^|\n\n)([^\n]+)\nRetailer: Costco\nProduct: ([^\n]+)\nQty: (\d+) \| Status: ([^|\n]+) \| Added: ([^\n]+)\nZIP: (\d+) \| Miles: ([\d.]+) mi/g;
      rows=Array.from(report.sourceText.matchAll(pattern),m=>({name:m[1],distanceMiles:Number(m[7]),onHand:null,onOrder:null,inTransit:/^In Transit$/i.test(m[4])?Number(m[3]):null,status:m[4],sourceFields:[{name:'Returned product',value:m[2]},{name:'Reported quantity',value:m[3]},{name:'Added',value:m[5]},{name:'ZIP',value:m[6]}]}));
      unmatched=rows.length>0;
    }
    const changes=row=>['onHand','onOrder','inTransit'].map(key=>{
      const c=row.quantityChanges?.[key];if(!c || c.delta===0)return '';
      const label={onHand:'On hand',onOrder:'On order',inTransit:'In transit'}[key];
      return '<small>'+label+' change: '+esc(c.previous)+' → '+esc(c.current)+' ('+(c.delta>0?'+':'')+esc(c.delta)+')</small>';
    }).join('');
    const locations=rows.map(row=>'<li class="inventory-source-location"><strong>'+esc(row.name)+'</strong>'+
      (row.address?'<div>'+esc(row.address)+'</div>':'')+
      '<dl class="inventory-source-fields"><div><dt>Distance</dt><dd>'+esc(row.distanceMiles==null?'Not supplied':row.distanceMiles+' miles')+'</dd></div>'+
      ['onHand','onOrder','inTransit'].map(key=>'<div><dt>'+({onHand:'On hand',onOrder:'On order',inTransit:'In transit'}[key])+'</dt><dd>'+esc(row[key] ?? 'Not supplied')+'</dd></div>').join('')+
      '<div><dt>Status</dt><dd>'+esc(row.status || 'Not supplied')+'</dd></div>'+fieldMarkup(row.sourceFields)+'</dl>'+changes(row)+'</li>').join('');
    const sourceUrl=/^https:\/\/discord\.com\/channels\/(?:\d+|@me)\/\d+(?:\/\d+)?$/.test(report.sourceUrl || '')?report.sourceUrl:null;
    const warehouse=['costco','sams','bestbuy'].includes(report.retailer);
    const table=warehouse && rows.length?'<h4>Reported locations ('+rows.length+')</h4><div class="inventory-table-scroll"><table class="inventory-source-table"><thead><tr><th>Store</th><th>Distance</th><th>On hand</th><th>On order</th><th>In transit</th><th>Status</th><th>Source details</th></tr></thead><tbody>'+rows.map(row=>'<tr><th scope="row">'+esc(row.name)+(row.address?'<small>'+esc(row.address)+'</small>':'')+'</th><td>'+esc(row.distanceMiles==null?'—':row.distanceMiles+' mi')+'</td>'+['onHand','onOrder','inTransit'].map(key=>'<td>'+esc(row[key] ?? '—')+'</td>').join('')+'<td>'+esc(row.status || 'Not supplied')+'</td><td>'+(row.sourceFields?.length?'<details><summary>Details</summary><dl class="inventory-source-fields">'+fieldMarkup(row.sourceFields)+'</dl></details>':'—')+changes(row)+'</td></tr>').join('')+'</tbody></table></div><small>— means not supplied by the checker. In transit does not confirm shelf stock.</small>':'';
    return '<section class="inventory-source-result"><p><strong>'+esc(report.source || 'Rippin Packz stock checker')+'</strong></p>'+
      (report.detail?'<p class="inventory-source-text">'+esc(report.detail)+'</p>':'')+
      (report.sourceFields?.length?'<dl class="inventory-source-fields">'+fieldMarkup(report.sourceFields)+'</dl>':'')+
      (unmatched?'<p><strong>Returned product differs from your selection.</strong> These source rows are shown for reference; they do not confirm stock for the requested item.</p>':'')+
      ((unmatched && table?'<details><summary>Different product returned — reference only</summary>'+table+'</details>':table) || (locations?'<h4>Reported locations ('+rows.length+')</h4><ol class="inventory-source-locations">'+locations+'</ol>':''))+
      (report.sourceText?'<details class="inventory-source-original"><summary>Original checker response</summary><pre>'+esc(report.sourceText)+'</pre></details>':'<p><small>The original response text was not saved with this check. All available saved fields are shown above.</small></p>')+
      (sourceUrl?'<p><a href="'+esc(sourceUrl)+'" target="_blank" rel="noopener noreferrer">VIEW DISCORD RESULT ↗</a></p>':'')+'</section>';
  }
  function renderBestBuy(report){
 const products=report.products||[];
 const cards=products.map(p=>'<article class="bestbuy-stock-card"><h4>'+esc(p.name)+'</h4><p>SKU '+esc(p.sku)+' · Last scanned: '+esc(p.lastScanned||'Not supplied')+'</p>'+(p.detail?'<p>'+esc(p.detail)+'</p>':'')+'<dl class="inventory-source-fields">'+fieldMarkup(p.sourceFields)+'</dl><div class="inventory-table-scroll"><table class="inventory-source-table"><thead><tr><th>Store</th><th>Quantity</th><th>Details</th></tr></thead><tbody>'+p.locations.map(r=>'<tr><th scope="row">'+esc(r.name)+(r.address?'<small>'+esc(r.address)+'</small>':'')+'</th><td><strong class="'+(r.onHand>0?'bestbuy-positive':'')+'">'+esc(r.onHand??'Unknown')+'</strong></td><td>'+(r.distanceMiles!=null?esc(r.distanceMiles)+' mi · ':'')+esc(r.status)+(r.onOrder!=null?' · On order: '+esc(r.onOrder):'')+(r.inTransit!=null?' · In transit: '+esc(r.inTransit):'')+'<dl class="inventory-source-fields">'+fieldMarkup(r.sourceFields)+'</dl></td></tr>').join('')+'</tbody></table></div>'+(!p.locations.length?'<p>No stores supplied. Stock is unknown.</p>':'')+'</article>').join('');
 return '<section class="inventory-source-result"><p><strong>'+products.length+' products returned</strong> · Zephyr stock checker</p><p>Scan times are shown exactly as reported. Missing products or stores are unknown; stock may change.</p>'+(report.detail?'<p>'+esc(report.detail)+'</p>':'')+(report.result==='checker_error'?'<p>Checker error: stock could not be established.</p>':'')+'<div class="bestbuy-stock-grid">'+cards+'</div><dl class="inventory-source-fields">'+fieldMarkup(report.sourceFields)+'</dl>'+(report.sourceText?'<details class="inventory-source-original"><summary>Full original Zephyr response</summary><pre>'+esc(report.sourceText)+'</pre></details>':'')+'</section>';
 }
  function resultLabel(report){
    if(report.result==='checker_error'){
      return /different product|differs from|no exact requested/i.test(report.detail || '')
        ? 'Different product returned · requested-item stock unknown'
        : 'Checker could not establish stock · quantities unknown';
    }
    return report.result==='no_stock_reported'?'No stock reported · missing stores remain unknown':'Reported stock';
  }
  const api={cleanDetails,render,resultVisible,resultLabel};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.InventoryReportView=api;
})(typeof globalThis!=='undefined'?globalThis:this);
