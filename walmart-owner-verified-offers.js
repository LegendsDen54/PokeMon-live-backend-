const confirmation = require('./walmart-owner-verified-offers.json');

// An explicit owner verification applies only to the exact reported offer.
// Preserve unknown MSRP and never extend this to new sellers or prices.
module.exports = function applyOwnerOfferVerification(items) {
  return items.map(item => {
    const approved = confirmation.offers.find(offer =>
      offer.productId === String(item.productId) &&
      offer.seller === item.seller && offer.price === Number(item.price));
    if (!approved || item.status !== 'reported_available') return item;
    const msrp = Number(item.msrp);
    if (msrp > 0 && Number(item.price) > msrp * 1.5) return item;
    return {...item, stale:false, ownerVerifiedOffer:true,
      ownerVerifiedAt:approved.confirmedAt || confirmation.confirmedAt,
      ownerVerifiedAvailability:approved.availability || null};
  });
};
