async function checkProduct(product, retailer) {
  return {
    productId: product.id,
    name: product.name,
    set: product.set,
    retailer,
    inStock: false,
    price: null,
    msrp: product.msrp ?? null,
    url: retailer === "target" ? product.targetUrl : product.walmartUrl,
    seller: retailer === "target" ? "Target" : "Walmart",
    checkedAt: new Date().toISOString(),
    source: "mock"
  };
}
module.exports = { checkProduct };
