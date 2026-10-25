'use strict';
const assert=require('node:assert/strict');
const support=require('../inventory-product-support');
const catalog=require('../retail-catalog.json');
assert.throws(()=>support.assertSupported('costco','2007494'),e=>e.code==='EXACT_PRODUCT_UNSUPPORTED' && /different product/.test(e.message));
assert.doesNotThrow(()=>support.assertSupported('costco','2007496'));
assert.doesNotThrow(()=>support.assertSupported('costco','2007495'));
assert.doesNotThrow(()=>support.assertSupported('sams','990518062'));
assert.equal(catalog.costco.find(p=>p.itemNumber==='2007496').query.includes('30th Anniversary'),true);
assert.equal(catalog.costco.find(p=>p.itemNumber==='2007494').itemNumber,'2007494');
console.log('Exact Costco identifiers stay distinct; unsupported checks reject and supported Costco/Sams remain available.');

const choices=require('../discord-product-choices').choices;
assert.equal(catalog.costco.find(p=>p.itemNumber==='2007496').stage,'current');
assert(choices('costco','30th',[],Date.parse('2026-10-24T18:00:00Z'),[]).some(p=>p.value==='2007496'));
assert.equal(choices('costco','30th',[],Date.parse('2026-10-23T18:00:00Z'),[]).length,0);
assert.equal(choices('costco','30th',[],Date.parse('2026-11-08T18:00:00Z'),[]).length,0);
