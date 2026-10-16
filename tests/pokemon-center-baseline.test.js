"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const pc = require("../pokemon-center");
test("visible existing card products seed tracking without creating readiness events", async () => {
  const before = pc.getState();
  const input = {type:"PRODUCT_BASELINE",source:"browser-sensor",sensorId:"baseline-test-cold-sensor",observedOnly:true,tcgRelevant:true,name:"Pokémon TCG: Delta Reign Booster Bundle",url:"https://www.pokemoncenter.com/product/test-baseline/bundle",availability:"in_stock",live:true};
  const result = await pc.ingestSignal(input);
  assert.equal(result.baseline,true);
  const product = pc.getProducts().find(p=>p.url===input.url);
  assert.equal(product.availability,"unknown");
  assert.equal(product.live,false);
  assert.equal(pc.getState().eventCount,before.eventCount);
  assert.equal(result.notificationReceipt,undefined);
  const accessory = await pc.ingestSignal({...input,url:"https://www.pokemoncenter.com/product/test-accessory/binder",name:"Pokémon TCG Zip Binder"});
  assert.equal(accessory.ignored,true);
});
