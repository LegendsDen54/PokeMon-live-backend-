'use strict';
// A TCG-branded accessory is not necessarily a product containing cards.
module.exports = function pokemonCenterCardProduct(name) {
  const text = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!/pokemon/.test(text)) return false;
  const cards = /\bknock out collection\b|\bpokemon tcg classic\b|\bworld championships deck\b|\bbooster\b|\belite trainer box\b|\betb\b|\b(?:ultra|super)[- ]premium collection\b|\b(?:ex|v|vmax|gx)\s+(?:box|collection)\b|\b(?:mini\s+)?tins?\b|\bblister\b|\b(?:battle|theme) deck\b|\bbuild\s*(?:&|and)\s*battle\b|\b(?:binder|poster|sticker|figure|illustration|premium) collection\b|\bpromo cards?\b/.test(text);
  return cards && !/\blego\b|\bplush\b|\bsitting cuties\b/.test(text);
};
