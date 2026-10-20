'use strict';
function parseWindow(value,now=Date.now()){
  const text=String(value||'').replace(/<!--\s*-->/g,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
  const m=text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(?:(20\d{2})\s+)?(\d{1,2}:\d{2}\s*[ap]\.?m\.?)\s*(?:[-–—]\s*(\d{1,2}:\d{2}\s*[ap]\.?m\.?))?\s*(PDT|PST|EDT|EST|CDT|CST)\b/i);
  if(!m)return null;
  const year=m[3]||new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'America/Chicago'}).format(new Date(now));
  const at=time=>Date.parse(`${m[1]} ${m[2]}, ${year} ${time.replace(/([ap])\.?m\.?$/i,' $1M')} ${m[6].toUpperCase()}`);
  const start=at(m[4]),end=m[5]?at(m[5]):null;
  // An unchanged expired announcement must never roll into next year.
  if(!Number.isFinite(start)||start<now-7*86400000)return null;
  return {startsAt:new Date(start).toISOString(),endsAt:Number.isFinite(end)&&end>start?new Date(end).toISOString():null};
}
function extractWindows(html,now=Date.now()){
  const result=new Map(),parts=String(html||'').split(/data-item-id=["'](\d+)["']/i);
  for(let i=1;i<parts.length;i+=2){
    const block=parts[i+1]||'';
    const m=block.match(/Drawing\s+(?:starts|entry\s+window)([\s\S]{0,700}?)(?:<\/span>|<\/div>)/i);
    const window=m&&parseWindow(m[1],now);
    if(window)result.set(parts[i],window);
  }
  return result;
}
module.exports={parseWindow,extractWindows};
