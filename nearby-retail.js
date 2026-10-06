"use strict";
const cache=new Map();let pending=null;let nextRequest=0;let daily={day:"",count:0};
const headers={"User-Agent":"LegendsDen-PrivateMonitor/1.0 (+https://pokemon-live-backend.onrender.com)"};
function distance(a,b,c,d){const rad=Math.PI/180;const v=Math.sin((c-a)*rad/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin((d-b)*rad/2)**2;return 3958.8*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));}
async function nearby(retailer,zip){
  if(!["sams","costco"].includes(retailer) || !/^\d{5}$/.test(zip)) throw new Error("Choose a retailer and valid five-digit ZIP");
  const hit=cache.get(zip);
  if(hit?.until>Date.now())return {...hit.data,locations:hit.data.locations.filter(i=>i.retailer===retailer),cached:true};
  if(pending) {await pending;return nearby(retailer,zip);}
  if(Date.now()<nextRequest) throw new Error("Location service is cooling down. Use the retailer's official locator.");
  const day=new Date().toISOString().slice(0,10);if(daily.day!==day)daily={day,count:0};
  if(daily.count>=25)throw new Error("Daily location lookup limit reached. Use the official retailer locator.");
  pending=(async()=>{
    daily.count++;nextRequest=Date.now()+60000;
    const geo=await fetch("https://api.zippopotam.us/us/"+zip,{headers,signal:AbortSignal.timeout(10000)});
    if(!geo.ok)throw new Error("ZIP location could not be found");
    const place=(await geo.json()).places?.[0];
    const lat=Number(place?.latitude),lon=Number(place?.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error("ZIP location is unavailable");
    const query=`[out:json][timeout:25];(nwr(around:120701,${lat},${lon})[shop][brand="Costco"];nwr(around:120701,${lat},${lon})[shop][brand="Sam's Club"];nwr(around:120701,${lat},${lon})[shop][name="Costco"];nwr(around:120701,${lat},${lon})[shop][name="Sam's Club"];);out center tags;`;
    const endpoint=new URL(process.env.RETAIL_LOCATION_API_URL || "https://overpass.private.coffee/api/interpreter");
    endpoint.searchParams.set("data",query);
    const response=await fetch(endpoint,{headers,signal:AbortSignal.timeout(30000)});
    if(!response.ok){nextRequest=Date.now()+3600000;throw new Error("Location service is temporarily unavailable");}
    const data=await response.json();if(data.remark)throw new Error("Location service returned an incomplete result");
    const locations=[];
    for(const el of data.elements || []){
      const tags=el.tags || {};const store= /costco/i.test(tags.name)?"costco":"sams";
      const a=Number(el.lat ?? el.center?.lat),b=Number(el.lon ?? el.center?.lon);
      if(!Number.isFinite(a)||!Number.isFinite(b) || /gas|fuel|distribution|depot/i.test(tags.name))continue;
      const miles=distance(lat,lon,a,b);if(miles>75)continue;
      if(locations.some(i=>i.retailer===store && distance(i.latitude,i.longitude,a,b)<0.1))continue;
      locations.push({retailer:store,name:tags.name,storeId:tags.ref || null,address:[tags["addr:housenumber"],tags["addr:street"],tags["addr:city"],tags["addr:state"],tags["addr:postcode"]].filter(Boolean).join(" "),phone:tags.phone || tags["contact:phone"] || null,latitude:a,longitude:b,distanceMiles:Number(miles.toFixed(1)),mapUrl:`https://www.openstreetmap.org/?mlat=${a}&mlon=${b}#map=16/${a}/${b}`,stockStatus:"unknown",quantity:null});
    }
    locations.sort((a,b)=>a.distanceMiles-b.distanceMiles);
    cache.set(zip,{until:Date.now()+86400000,data:{locations,source:"OpenStreetMap contributors",sourceUrl:"https://www.openstreetmap.org/copyright",observedAt:new Date().toISOString(),postalCode:zip,radiusMiles:75,distanceType:"Approximate straight-line distance from ZIP center"}});
    while(cache.size>100)cache.delete(cache.keys().next().value);
  })();
  try{await pending;}catch(error){nextRequest=Math.max(nextRequest,Date.now()+300000);throw error;}finally{pending=null;}
  return nearby(retailer,zip);
}
module.exports={nearby,distance};
