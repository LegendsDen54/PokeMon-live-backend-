async function checkProduct(product, retailer) {
  const baseUrl = process.env.RETAIL_DATA_API_URL;
  const apiKey = process.env.RETAIL_DATA_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("Missing RETAIL_DATA_API_URL or RETAIL_DATA_API_KEY");

  const url = new URL(baseUrl);
  url.searchParams.set("retailer", retailer);
  url.searchParams.set("productId", product.id);
  url.searchParams.set("name", product.name);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  const data = await response.json();

  return {
    productId: product.id,
    name: product.name,
    set: product.set,
    retailer,
    inStock: Boolean(data.inStock),
    price: data.price ?? null,
    msrp: product.msrp ?? data.msrp ?? null,
    url: data.url ?? (retailer === "target" ? product.targetUrl : product.walmartUrl),
    seller: data.seller ?? (retailer === "target" ? "Target" : "Walmart"),
    checkedAt: new Date().toISOString(),
    source: "custom"
  };
}
module.exports = { checkProduct };
