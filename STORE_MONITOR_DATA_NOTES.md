# Store monitor data notes

## Best Buy

The official Best Buy Products API and Store Availability endpoint can provide
product details, nearby stores, distance, availability, and a low-stock flag.
The monitor limits nearby results to 75 miles from `BESTBUY_POSTAL_CODE`.
The public store response does not provide an exact on-hand unit count, so the
dashboard says that plainly instead of estimating one.

The monitor also records a restock observation only after a store was previously
observed unavailable and later returns as available. These observations can show
local day and time patterns over time; they are evidence from the monitored
availability feed, not a claimed delivery or stocking schedule.

Required server settings for local Best Buy checks:

- `BESTBUY_API_KEY`
- `BESTBUY_POSTAL_CODE`
- Optional: `BESTBUY_RADIUS_MILES` (capped at 75; defaults to 75)

## Sam's Club and Costco

The dashboard is ready for an authorized JSON provider feed that supplies
warehouse data. No warehouse quantity, allocation, or status is inferred when
the source does not publish it. A feed item can include:

- `name`, `sku` or `productId`, `image`, `url`
- `channel: "store"`, `storeName`, `storeAddress`, `storeCity`, `storeState`,
  `storePostalCode`, and `distanceMiles`
- `status` such as `on_hand`, `in_transit`, or `on_order`
- `quantity` only when the source returns an actual count

This keeps location, status, SKU, official image, and confirmed quantity
separate from unavailable or estimated inventory.
