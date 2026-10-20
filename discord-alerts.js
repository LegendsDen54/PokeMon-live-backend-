'use strict';

const crypto = require('node:crypto');

function webhookUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password ||
        !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)) return null;
    url.search = '?wait=true';
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function publicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function create({env = process.env, fetchImpl = globalThis.fetch, now = Date.now} = {}) {
  const recent = new Map();
  let lastDelivery = null;
  async function send(payload = {}) {
    const raw = env.DISCORD_ALERT_WEBHOOK_URL;
    if (!raw) return {ok:true, skipped:true, reason:'not_configured'};
    const url = webhookUrl(raw);
    if (!url) return {ok:false, reason:'invalid_webhook_configuration'};
    // This module receives public broadcasts only. Defense in depth for accidental callers.
    if (payload.private || payload.zip || payload.viewerId || /^(?:private|inventory-completion)/i.test(payload.tag || '')) {
      return {ok:true, skipped:true, reason:'private_result'};
    }
    if (/test/i.test(payload.tag || '') && payload.tag !== 'discord-connection-test') return {ok:true, skipped:true, reason:'test_alert'};
    const key = crypto.createHash('sha256').update(JSON.stringify([
      payload.eventId || '', payload.title || '', payload.body || '', payload.url || '', payload.publishedAt || ''
    ])).digest('hex');
    for (const [id, row] of recent) if (row.expires <= now()) recent.delete(id);
    if (recent.has(key)) return recent.get(key).promise;
    const work = (async () => {
      const fields = [];
      const product = publicUrl(payload.url);
      const source = publicUrl(payload.sourceUrl);
      if (product) fields.push({name:'Open', value:product});
      if (source && source !== product) fields.push({name:'Source', value:source});
      const embed = {title:String(payload.title || 'Pokémon monitor alert').slice(0,256),
        description:String(payload.body || 'New monitor update').slice(0,4096), fields,
        footer:{text:'Legends Den monitor · Source reports are not checkout confirmation'}};
      if (product) embed.url = product;
      if (payload.publishedAt && Number.isFinite(Date.parse(payload.publishedAt))) embed.timestamp = new Date(payload.publishedAt).toISOString();
      try {
        const response = await fetchImpl(url, {method:'POST', redirect:'error',
          headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(8000),
          body:JSON.stringify({allowed_mentions:{parse:[]}, embeds:[embed]})});
        if (!response.ok) {
          const retryAfter = Number(response.headers.get('retry-after'));
          return {ok:false, reason:response.status === 429 ? 'rate_limited' : 'discord_rejected',
            status:response.status, ...(response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0 ? {retryAfterSeconds:retryAfter} : {})};
        }
        const message = await response.json();
        return {ok:true, messageId:String(message.id || ''), acceptedAt:new Date(now()).toISOString()};
      } catch { return {ok:false, reason:'delivery_unknown'}; }
    })();
    recent.set(key, {expires:now()+10*60*1000, promise:work});
    while (recent.size > 500) recent.delete(recent.keys().next().value);
    lastDelivery = await work;
    // Unknown outcomes are held to avoid duplicate messages after a transport timeout.
    return lastDelivery;
  }
  return {send, status:() => ({configured:Boolean(webhookUrl(env.DISCORD_ALERT_WEBHOOK_URL)), lastDelivery})};
}

module.exports = {...create(), create};
