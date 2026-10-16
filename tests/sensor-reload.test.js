const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../pokemon-center-sensor', name), 'utf8');

test('reattaching an open Pokemon Center tab keeps one heartbeat and observer', () => {
  let observers = 0, intervals = 0, heartbeats = 0;
  const context = vm.createContext({
    URL, location: {href:'https://www.pokemoncenter.com/category/trading-card-game',pathname:'/category/trading-card-game'},
    document: {title:'Trading Card Game',body:{innerText:''},querySelector:()=>null,querySelectorAll:()=>[],documentElement:{}},
    chrome:{runtime:{sendMessage(message){if(message.kind==='heartbeat')heartbeats++;return Promise.resolve();}}},
    MutationObserver:class {constructor(){observers++;} observe(){}},
    setInterval(){intervals++;},setTimeout(){},clearTimeout(){}
  });
  vm.runInContext('const DEBOUNCE_MS = 2500', context);
  vm.runInContext(source('content.js'), context);
  vm.runInContext(source('content.js'), context);
  assert.equal(heartbeats,1);
  assert.equal(observers,1);
  assert.equal(intervals,1);
});

test('reinjecting the public timeline sensor creates only one observer and timer pair', () => {
  let observers = 0, intervals = 0;
  const context = vm.createContext({
    document: { querySelectorAll: () => [], documentElement: {} },
    MutationObserver: class { constructor() { observers++; } observe() {} },
    setInterval() { intervals++; }, setTimeout() {}, clearTimeout() {},
    location: { reload() {} }, Intl, Date, Set
  });
  // A pre-update injection can have left this lexical name in the same world.
  vm.runInContext('const seenPostIds = new Set()', context);
  vm.runInContext(source('pokemon-restocks.js'), context);
  vm.runInContext(source('pokemon-restocks.js'), context);
  assert.equal(observers, 1);
  assert.equal(intervals, 2);
});

test('Target reports survive a removed runtime or synchronously invalidated context', async () => {
  const product = { '@type': 'Product', name: 'Pokemon TCG Elite Trainer Box', offers: { seller: { name: 'Target' }, availability: 'https://schema.org/InStock', price: 49.99 } };
  for (const chrome of [{}, { runtime: { sendMessage() { throw new Error('Extension context invalidated.'); } } }]) {
    const context = vm.createContext({
      chrome, window: {}, URL, location: { href: 'https://www.target.com/p/-/A-12345678' },
      document: { querySelectorAll: () => [{ textContent: JSON.stringify(product) }], querySelector: () => null, documentElement: {} },
      MutationObserver: class { observe() {} }, setInterval() {}, setTimeout() {}, clearTimeout() {}
    });
    assert.doesNotThrow(() => vm.runInContext(source('target.js'), context));
    await new Promise(resolve => setImmediate(resolve));
  }
});
