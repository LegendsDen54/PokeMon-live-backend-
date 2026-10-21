'use strict';
const catalog=require('./retail-catalog.json');
function unavailableReason(retailer,id){
  const product=(catalog[retailer] || []).find(p=>String(p.itemNumber)===String(id));
  return product?.checkerSupported===false ? product.checkerUnavailableReason || 'This exact product is not currently supported by the checker. Stock is unknown.' : null;
}
function assertSupported(retailer,id){const reason=unavailableReason(retailer,id);if(reason){const error=new Error(reason);error.code='EXACT_PRODUCT_UNSUPPORTED';throw error;}}
module.exports={unavailableReason,assertSupported};
