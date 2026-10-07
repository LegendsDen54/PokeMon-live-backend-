const observations=require('./pokemon-center-observations.json');
async function withEvidence(state,news){
  const now=Date.now(),day=at=>new Date(at).toLocaleDateString('en-CA',{timeZone:'America/Chicago'}),fresh=at=>Number.isFinite(Date.parse(at)) && now-Date.parse(at)>=0 && day(at)===day(now);
  const clues=[],seen=new Set();
  for(const report of news || []){
    if(report.retailer!=='pokemoncenter' || !fresh(report.editedAt || report.publishedAt))continue;
    const summary=String(report.summary || '');
    if(!/tcg|etb|elite trainer|booster|premium collection|invitation|invite|drop|restock|queue/i.test(summary))continue;
    const topic=/ascended heroes/i.test(summary)?'Ascended Heroes Pokémon Center ETB':/30th|anniversary/i.test(summary)&&/upc|ultra.?premium/i.test(summary)?'30th anniversary Ultra-Premium Collection':null;
    const revision=[report.sourceUrl,report.editedAt || report.publishedAt].join('|');
    if(seen.has(revision))continue;seen.add(revision);
    const namedProducts=(report.products || []).filter(p=>/^https:\/\/(?:www\.)?pokemoncenter\.com\/product\//.test(p.url || ''));
    for(const product of namedProducts.length?namedProducts:[{name:topic}])clues.push({source:report.source || 'CCN',sourceUrl:report.sourceUrl,summary,product:product.name,url:product.url || null,image:product.image || null,at:report.publishedAt,editedAt:report.editedAt || null,thirdParty:true,availabilityConfirmed:false});
  }
  for(const item of observations)if(fresh(item.at))clues.push(item);
  // Repeated third-party posts share one contribution. Age reduces their weight.
  const thirdParty=clues.filter(c=>c.thirdParty && c.readinessEligible!==false);
  const sourceScore=thirdParty.length?Math.max(...thirdParty.map(c=>now-Date.parse(c.editedAt || c.at)<3*3600000?26:12)):0;
  const official=clues.some(c=>!c.thirdParty && c.invitationOnly);
  const score=Math.max(Number(state.confidence)||0,Math.min(34,sourceScore+(official?8:0)),official?18:0,clues.length?4:0);
  const watchlist=[...new Set(clues.map(c=>c.product).filter(Boolean))].map(name=>({name,url:clues.find(c=>c.product===name && c.url)?.url || (name==='Ascended Heroes Pokémon Center ETB'?'https://www.pokemoncenter.com/product/10-10315-108/pokemon-tcg-mega-evolution-ascended-heroes-pokemon-center-elite-trainer-box':null),image:clues.find(c=>c.product===name && c.image)?.image || (name==='Ascended Heroes Pokémon Center ETB'?'https://www.pokemoncenter.com/images/DAMRoot/High/10027/P11425_10-10315-108_01.jpg':null),reports:clues.filter(c=>c.product===name),status:'Availability unconfirmed'}));
  return {...state,confidence:score,level:score>0 && !state.queueActive && (Number(state.confidence)||0)<score?'watch':state.level,readinessWindow:score>0 && !state.queueActive && (Number(state.confidence)||0)<score?{label:'Watch today · drop time unconfirmed'}:state.readinessWindow,evidenceClues:clues,dayWatchlist:watchlist};
}
module.exports={withEvidence};
