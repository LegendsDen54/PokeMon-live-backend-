"use strict";
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'../pokemon-center-sensor');
const shared=fs.readFileSync(path.join(root,'discord-sources.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'ccn-discord.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
const {DISCORD_SOURCES}=require(path.join(root,'discord-sources.js'));
const background=fs.readFileSync(path.join(root,'background.js'),'utf8');
const validator=background.slice(background.indexOf('function ccnSenderAllowed'),background.indexOf('// React only'));
async function exercise(guild,channel,expected){
  const delivered=[];
  const publishedAt=new Date().toISOString();
  const message={id:'chat-messages-'+channel+'-123456789',innerText:'Pokemon TCG Target Prismatic Evolutions restock update',querySelectorAll(selector){
    if(selector==='time[datetime]')return [{getAttribute:()=>publishedAt}];
    if(selector==='a[href]')return [{textContent:'Pokemon TCG Prismatic Evolutions',href:'https://www.target.com/p/-/A-123456789'}];
    return [];
  }};
  const context=vm.createContext({URL,Date,Map,Set,Promise,window:{},location:{pathname:'/channels/'+guild+'/'+channel},document:{documentElement:{},querySelectorAll:()=>[message]},MutationObserver:class{observe(){}},setInterval(){},setTimeout(){},clearTimeout(){},chrome:{runtime:{sendMessage:async value=>{delivered.push(value);return {ok:true};}}}});
  vm.runInContext(shared,context);
  vm.runInContext(shared,context); // Safe when startup injection meets an existing content script.
  vm.runInContext(validator,context);
  const sourceUrl='https://discord.com/channels/'+guild+'/'+channel+'/123456789';
  assert.equal(Boolean(vm.runInContext('ccnSenderAllowed',context)({url:'https://discord.com/channels/'+guild+'/'+channel},{sourceUrl})),expected);
  assert.equal(Boolean(vm.runInContext('ccnSenderAllowed',context)({url:'https://evil.example/channels/'+guild+'/'+channel},{sourceUrl})),false);
  vm.runInContext(bridge,context);
  await Promise.resolve();
  assert.equal(delivered.length,expected?1:0);
  if(expected){
    const report=delivered[0].payload;
    assert.equal(report.sourceUrl,sourceUrl);
    assert.ok(report.summary.startsWith(DISCORD_SOURCES[guild].name+' source report:'));
    assert.equal(report.products[0].status,'upcoming');
    assert.equal(report.products[0].price,null);
    assert.equal(report.products[0].seller,'');
    const match='https://discord.com/channels/'+guild+'/*';
    assert.ok(manifest.host_permissions.includes(match));
    assert.ok(manifest.content_scripts.some(c=>c.matches.includes(match)&&c.js.indexOf('discord-sources.js')<c.js.indexOf('ccn-discord.js')));
  }
}
(async()=>{
  assert.equal(Object.keys(DISCORD_SOURCES).length,4);
  let count=0;
  for(const [guild,source] of Object.entries(DISCORD_SOURCES))for(const channel of source.channels){await exercise(guild,channel,true);count++;}
  assert.equal(count,9);
  await exercise('1410547930250612828','999999',false);
  await exercise('999999','1424776504767680722',false);
  console.log('All nine saved browser channels accepted; unapproved channels/origins rejected; unknown stock stays unconfirmed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
