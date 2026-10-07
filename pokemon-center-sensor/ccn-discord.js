"use strict";

// Read only rendered messages in these owner-authorized CCN channels.
// No Discord API calls, account tokens, private endpoints or bot commands.
(() => {
  if (window.__ccnMonitorBridge) return;
  window.__ccnMonitorBridge = true;
  const guild = "1410547930250612828";
  const channels = new Set(["1424776504767680722", "1514248684575920160", "1460973469150875720", "1424776415286657136"]);
  const sent = new Map();
  let timer;
  const tidy = value => String(value || "").replace(/\s+/g, " ").trim();
  function collect() {
    const route = location.pathname.split("/");
    if (route[2] !== guild || !channels.has(route[3])) return;
    for (const node of document.querySelectorAll('[id^="chat-messages-"]')) {
      const ids = node.id.match(/^chat-messages-(\d+)-(\d+)$/);
      if (!ids || ids[1] !== route[3]) continue;
      const times = [...node.querySelectorAll("time[datetime]")];
      const publishedAt = times[0]?.getAttribute("datetime");
      const editedAt = times.length > 1 ? times[times.length-1].getAttribute("datetime") : null;
      const effective = Date.parse(editedAt || publishedAt);
      if (!Number.isFinite(effective) || effective > Date.now() + 60000 || Date.now() - effective > 48 * 3600000) continue;
      const body = tidy(node.innerText)+" "+[...node.querySelectorAll("img[alt]")].map(e=>e.alt).join(" ");
      if (!/pok[eé]mon|\btcg\b|\bupc\b|\bspc\b|prismatic|destined rivals|ascended heroes|30th.*(?:etb|collection|bundle)/i.test(body)) continue;
      const links = [...node.querySelectorAll("a[href]")].map(a => ({name:tidy(a.textContent),url:a.href}));
      const retailers = [
        ["walmart", /walmart(?:\.com)?/i],
        ["target", /\btarget(?:\.com)?\b/i],
        ["pokemoncenter", /pok[eé]mon\s*center|pokemoncenter\.com/i]
      ].filter(([,pattern]) => pattern.test(body + " " + links.map(a=>a.url).join(" ")));
      // Multi-retailer digests remain with the scheduled collector to avoid misattribution.
      if (retailers.length !== 1) continue;
      const retailer = retailers[0][0];
      const products = [];
      const seenProducts = new Set();
      for (const link of links) {
        let u; try {u = new URL(link.url);} catch {continue;}
        const allowed={walmart:["www.walmart.com","walmart.com"],target:["www.target.com","target.com"],pokemoncenter:["www.pokemoncenter.com","pokemoncenter.com"]};
        if (u.protocol !== "https:" || !allowed[retailer].includes(u.hostname)) continue;
        const id = retailer === "walmart" ? u.pathname.match(/\/ip\/(?:[^/]+\/)?(\d+)\/?$/)?.[1] : retailer === "target" ? u.pathname.match(/\/A-(\d+)/)?.[1] : u.pathname.match(/\/product\/([^/]+)/)?.[1];
        if (!id || !link.name || !/pok[eé]mon|tcg|prismatic|destined rivals|ascended heroes|30th/i.test(link.name)) continue;
        if(seenProducts.has(id))continue;
        seenProducts.add(id);
        const sellerMatch=body.match(/Seller\s+(GT Collectibles(?: and Toys)?|Walmart|Target)(?:\s|$)/i);
        const seller=sellerMatch?.[1] || (retailer==='pokemoncenter'?'Pokémon Center':'');
        const priceMatch=body.match(/(?:Price|Retail)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
        // Do not assign one embed's price to multiple different products.
        const price=priceMatch && links.filter(a=>/\/ip\/|\/A-|\/product\//.test(a.url)).length===1?Number(priceMatch[1]):null;
        const explicitStock=/Stock\s*(?:🟢|in stock|available)/i.test(body) || [...node.querySelectorAll("img[alt]")].some(e=>e.alt==="🟢");
        const out=/Stock\s*(?:🔴|out of stock|sold out|unavailable)/i.test(body) || [...node.querySelectorAll("img[alt]")].some(e=>e.alt==="🔴");
        const queue=retailer==='pokemoncenter' && /queue (?:is )?(?:active|live)|queue opened/i.test(body);
        const status=out?'reported_unavailable':explicitStock?'reported_available':queue?'queue':'upcoming';
        const image=[...node.querySelectorAll('a[href]')].map(a=>a.href).find(h=>/^https:\/\/(?:[^/]+\.)?(?:walmartimages\.com|scene7\.com|pokemoncenter\.com)\//i.test(h)) || null;
        products.push({name:link.name,url:u.href,productId:id,seller,price,msrp:null,image,status});
      }
      // CCN news may link through an affiliate redirect but explicitly publish a Target TCIN.
      // Keep those as candidates, never as verified Target-sold live offers.
      if(retailer==='target'){
        for(const code of node.querySelectorAll('code')){
          const id=tidy(code.textContent);
          if(!/^\d{9,10}$/.test(id) || seenProducts.has(id))continue;
          const anchor=[...node.querySelectorAll('a[href]')].filter(a=>(code.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_PRECEDING) && /30th|prismatic|ascended|destined|premium collection/i.test(a.textContent)).pop();
          const name=tidy(anchor?.textContent);
          if(name){seenProducts.add(id);products.push({name:'Pokemon TCG '+name,url:'https://www.target.com/p/-/A-'+id,productId:id,seller:'',price:null,msrp:null,image:null,status:'upcoming'});}
        }
      }
      const report={kind:'news',retailer,sourceUrl:`https://discord.com/channels/${guild}/${ids[1]}/${ids[2]}`,publishedAt,editedAt,summary:'CCN source report: '+body.slice(0,940),products};
      const revision=JSON.stringify(report);
      if(sent.get(report.sourceUrl)===revision) continue;
      chrome.runtime.sendMessage({kind:'ccnNewsReport',payload:report}).then(result=>{
        if(result?.ok) sent.set(report.sourceUrl,revision);
      }).catch(()=>{});
    }
    if(sent.size>500)for(const key of [...sent.keys()].slice(0,sent.size-500))sent.delete(key);
  }
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(collect,500);};
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['datetime','href']});
  collect();
  setInterval(collect,30000);
})();
