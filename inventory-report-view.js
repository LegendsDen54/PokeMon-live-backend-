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
    return {
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
  function render(report){
    const rows=report.locations || [];
    const changes=row=>['onHand','onOrder','inTransit'].map(key=>{
      const c=row.quantityChanges?.[key];if(!c)return '';
      const label={onHand:'On hand',onOrder:'On order',inTransit:'In transit'}[key];
      return '<small>'+label+' change: '+esc(c.previous)+' → '+esc(c.current)+' ('+(c.delta>0?'+':'')+esc(c.delta)+')</small>';
    }).join('');
    const locations=rows.map(row=>'<li class="inventory-source-location"><strong>'+esc(row.name)+'</strong>'+
      (row.address?'<div>'+esc(row.address)+'</div>':'')+
      '<dl class="inventory-source-fields"><div><dt>Distance</dt><dd>'+esc(row.distanceMiles==null?'Not supplied':row.distanceMiles+' miles')+'</dd></div>'+
      ['onHand','onOrder','inTransit'].map(key=>'<div><dt>'+({onHand:'On hand',onOrder:'On order',inTransit:'In transit'}[key])+'</dt><dd>'+esc(row[key] ?? 'Not supplied')+'</dd></div>').join('')+
      '<div><dt>Status</dt><dd>'+esc(row.status || 'Not supplied')+'</dd></div>'+fieldMarkup(row.sourceFields)+'</dl>'+changes(row)+'</li>').join('');
    const sourceUrl=/^https:\/\/discord\.com\/channels\/\d+\/\d+(?:\/\d+)?$/.test(report.sourceUrl || '')?report.sourceUrl:null;
    return '<section class="inventory-source-result"><p><strong>'+esc(report.source || 'Rippin Packz stock checker')+'</strong></p>'+
      (report.detail?'<p class="inventory-source-text">'+esc(report.detail)+'</p>':'')+
      (report.sourceFields?.length?'<dl class="inventory-source-fields">'+fieldMarkup(report.sourceFields)+'</dl>':'')+
      (locations?'<h4>Reported locations ('+rows.length+')</h4><ol class="inventory-source-locations">'+locations+'</ol>':'')+
      (report.sourceText?'<details class="inventory-source-original" open><summary>Original checker response</summary><pre>'+esc(report.sourceText)+'</pre></details>':'<p><small>The original response text was not saved with this check. All available saved fields are shown above.</small></p>')+
      (sourceUrl?'<p><a href="'+esc(sourceUrl)+'" target="_blank" rel="noopener noreferrer">VIEW DISCORD RESULT ↗</a></p>':'')+'</section>';
  }
  const api={cleanDetails,render};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.InventoryReportView=api;
})(typeof globalThis!=='undefined'?globalThis:this);
