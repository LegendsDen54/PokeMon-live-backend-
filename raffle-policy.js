(function(root,factory){
  const policy=factory();
  if(typeof module==='object'&&module.exports)module.exports=policy;
  else root.RafflePolicy=policy;
})(typeof self!=='undefined'?self:globalThis,function(){
  function isPokemon(item){
    const name=String(item?.name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    return /\bpokemon\b/.test(name)&&/\b(tcg|trading card|booster|elite trainer|etb|collection|tin|blister)\b/.test(name)&&! /\b(mystery|repack|custom|graded|psa|plush|squeeze|fidget)\b/.test(name);
  }
  function isCurrent(item,now=Date.now()){
    if(!isPokemon(item)||/closed|ended|completed|cancel/i.test(String(item?.raffleStatus||item?.status||'')))return false;
    const end=Date.parse(item.endsAt||item.closesAt),start=Date.parse(item.startsAt);
    if(Number.isFinite(end))return end>now;
    // Unknown closing time is not permission to show an old drawing forever.
    // Keep it only on its opening day; never invent a closing timestamp.
    const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
    if(Number.isFinite(start))return start>now||day(start)===day(now);
    const checked=Date.parse(item.checkedAt);
    return Number.isFinite(checked)&&checked<=now&&now-checked<86400000;
  }
  return {isPokemon,isCurrent};
});
