(function(root,factory){
  const policy=factory();
  if(typeof module==='object'&&module.exports)module.exports=policy;
  else root.RafflePolicy=policy;
})(typeof self!=='undefined'?self:globalThis,function(){
  function isPokemon(item){
    const name=String(item?.name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    return /\bpokemon\b/.test(name)&&/\b(tcg|trading card|booster|elite trainer|etb|collection|tin|blister)\b/.test(name)&&! /\b(mystery|repack|custom|graded|psa|plush|squeeze|fidget)\b/.test(name);
  }
  function isOnePiece(item){
    const name=String(item?.name||'').toLowerCase();
    return /\bone[ -]piece\b/.test(name)&&/\b(tcg|card|cards|booster|deck|collection|display|premium)\b/.test(name)&&! /\b(mystery|repack|custom|graded|psa|plush|figure)\b/.test(name);
  }
  function isCurrent(item,now=Date.now()){
    if(!(isPokemon(item)||isOnePiece(item))||/closed|ended|completed|cancel/i.test(String(item?.raffleStatus||item?.status||'')))return false;
    const end=Date.parse(item.endsAt||item.closesAt),start=Date.parse(item.startsAt);
    if(Number.isFinite(end))return end>now;
    // Unknown closing time is not permission to show an old drawing forever.
    // Keep it only on its opening day; never invent a closing timestamp.
    const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
    if(Number.isFinite(start))return start>now||day(start)===day(now);
    const checked=Date.parse(item.checkedAt);
    return Number.isFinite(checked)&&checked<=now&&now-checked<86400000;
  }
  function isPastAnnouncement(item,now=Date.now()){
    const text=String(item?.expectedWindow||'');
    if(!/drawing/i.test(text))return false;
    const date=text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
    if(!date)return false;
    const announcedDay=Date.parse(`${date[1]} ${date[2]}, ${date[3]} 00:00:00 GMT`);
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
    const part=type=>parts.find(p=>p.type===type).value;
    return announcedDay<Date.UTC(Number(part('year')),Number(part('month'))-1,Number(part('day')));
  }
  return {isPokemon,isOnePiece,isCurrent,isPastAnnouncement};
});
