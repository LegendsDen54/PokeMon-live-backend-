const BACKEND_URL = "YOUR_BACKEND_URL";

async function loadLiveProducts() {
  const response = await fetch(`${BACKEND_URL}/api/products`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Backend HTTP ${response.status}`);
  const data = await response.json();
  console.log("LIVE PRODUCT DATA:", data.items);
  return data.items;
}
loadLiveProducts().catch(console.error);
