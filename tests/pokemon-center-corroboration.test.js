const test=require('node:test'),assert=require('node:assert/strict');
const {withEvidence}=require('../pokemon-center-evidence');
const at=new Date().toISOString();
const report=(guild,msg)=>({retailer:'pokemoncenter',source:guild,sourceUrl:`https://discord.com/channels/${guild}/1/${msg}`,publishedAt:at,summary:'Pokemon TCG 30th Poster Collection drop expected today'});
test('independent communities corroborate; repeated posts do not inflate score',async()=>{
 const one=await withEvidence({confidence:0},[report('111','1')]);
 const repeated=await withEvidence({confidence:0},[report('111','1'),report('111','2')]);
 const corroborated=await withEvidence({confidence:0},[report('111','1'),report('222','3')]);
 assert.equal(one.confidence,repeated.confidence);assert.ok(corroborated.confidence>one.confidence);assert.equal(corroborated.confidence,36);assert.equal(corroborated.dayWatchlist.length,1);
});
