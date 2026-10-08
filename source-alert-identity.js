'use strict';
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
function normalizedSummary(report){
  return String(report.summary || '').toLowerCase().normalize('NFKD')
    .replace(/https?:\/\/\S+/g,'').replace(/<@[^>]+>/g,'')
    .replace(/^(?:ccn|rippin packz|the poke gang|pokemon restocks & news)(?: source report)?\s*:\s*/,'')
    .replace(/[^a-z0-9]+/g,' ').trim();
}
function identity(report){
  const scope=(report.game || 'pokemon')+':'+report.retailer;
  const at=report.editedAt || report.publishedAt;
  const day=new Date(report.publishedAt).toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
  const text=normalizedSummary(report);
  // Drawing outcomes are one event even when another source names the winning sets.
  // Opening, closing, queues and new inventory use different identities.
  const drawingResults=report.retailer==='walmart' && /draw(?:ing)?s?/.test(text) &&
    /(?:orders?|results?|confirmations?)(?: are| is)? (?:rolling|going|coming) out|(?:orders?|results?|confirmations?)(?: are| is)? (?:being sent|now sending)|(?:rolling|sending) out (?:orders?|results?|confirmations?)/.test(text);
  const event=drawingResults?scope+':drawing-results:'+day:scope+':content:'+hash(text);
  const revision=scope+':source:'+report.sourceUrl+':'+at;
  return {revision,event,id:hash(event+'|'+revision),at};
}
function pokemonCenterEvidenceEligible(report){
  if(report.retailer!=='pokemoncenter' || report.game==='onepiece')return false;
  const text=String(report.summary || '');
  // A sponsor/giveaway mention in a different retailer's report is not PC movement.
  if(/best\s*buy/i.test(text) && /giveaway/i.test(text))return false;
  if(/giveaway/i.test(text) && !/invitation|invite|queue|restock|pre.?order|drop|loaded/i.test(text))return false;
  return /tcg|etb|elite trainer|booster|premium collection|invitation|invite|drop|restock|queue/i.test(text);
}
module.exports={identity,normalizedSummary,pokemonCenterEvidenceEligible};
