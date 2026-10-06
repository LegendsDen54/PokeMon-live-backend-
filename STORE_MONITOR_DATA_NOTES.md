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

## Provider research: CCN and Zephyr (2026-10-06)

Read-only inspection of the user's accessible CCN channels identified alert
footers naming `CCN x Zephyr Monitors`. This attribution was visible on several
retailer alerts, including Pokemon Center; it does not establish that every CCN
service uses the same provider.

The CCN Retail Stock Checker instructions list Bestbuy, Costco, and Samsclub
among supported retailers. Its documented inputs are retailer, ZIP code, and
product identifier. These instructions establish advertised coverage, not a
verified response for a Chicago warehouse. Exact quantities and the three
warehouse phases (on order, in transit, on hand) remain unverified for those
retailers. No bot command was submitted during this inspection.

Zephyr's public website advertises a customer dashboard with configurable
webhooks: https://zephyrmonitorsllc.com/ . This is a concrete provider lead,
but no documented ingestion API, credentials, pricing, redistribution permission,
or feed subscription was obtained. A CCN membership alone must not be treated
as a configured application feed.

Useful Pokemon Center event distinctions observed in alert presentation:

- Product identifier and official product URL should remain attached to evidence.
- `invite_only` must be separate from stock status and public purchase eligibility.
- An unavailable price must remain unknown; a market-value estimate is not the
  retailer's purchase price.
- Editorial warnings about a possible drop window are attributed external
  expectations. They do not prove a queue, inventory change, or calibrated
  30-60 minute prediction.

Next connection requirements: confirm a supported provider feed and its license,
retailer coverage, location identifiers, timestamps, status semantics, quantity
coverage, authentication, and webhook signature/replay handling before adapting
it to the existing server-side inventory model. Keep missing fields unknown and
deduplicate updates by product, location, and event identity. No runtime provider
connection was added by this research.
