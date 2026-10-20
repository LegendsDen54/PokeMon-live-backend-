'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const eligible = require('../pokemon-center-card-product');
test('excludes observed TCG accessories and the Sitting Cuties substring trap', () => {
  for (const name of ['Pokémon TCG Deck Buddies: Pikachu Deck Box', 'Pokémon TCG: Celestial Premium Binder', 'Pokémon TCG: Groundwater Gathering Playmat', 'Pokémon TCG: Card Sleeves (65 Sleeves)', 'Pokémon TCG: Celestial Backpack', 'Pokémon TCG: Convertible Shoulder Bag', 'Pokémon TCG: Bag Tag', 'Gengar LEGO Pokémon SMART Play & Sitting Cuties Plush Bundle']) assert.equal(eligible(name), false, name);
});
test('preserves card-containing products including accessory collections with packs', () => {
  for (const name of ['Pokemon TCG: 30th Celebration Mini Tin – Mew', 'Pokémon TCG: Ascended Heroes Pokémon Center Elite Trainer Box', 'Pokémon TCG: Prismatic Evolutions Booster Bundle', 'Pokémon TCG: 30th Celebration Binder Collection', 'Pokémon TCG: Tech Sticker Collection', 'Pokémon TCG: Greninja ex Box', 'Pokémon TCG: First Partner Illustration Collection']) assert.equal(eligible(name), true, name);
});
