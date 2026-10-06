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

### Additional provider screening (2026-10-06)

- Moonitor's own stock-checker documentation lists Bestbuy, Costco, and Samsclub
  in-store support, with named groups of product links and interactive scan
  buttons. It is a second concrete provider candidate. The reviewed documentation
  does not establish exact quantities, shipment phases, an external REST API, or
  app redistribution rights. Source:
  https://docs.moonitor.tools/other-tools-and-features/preset-stock-checkers-for-members
- Parse's Sam's Club service documents product search, item details/images,
  identifiers, and nearby club lookup. Its FAQ explicitly excludes per-club stock
  levels. This may help catalog maintenance and location lookup, but must not be
  presented as local inventory. No credentials or live response were tested.
  https://parse.bot/marketplace/aa618459-55b6-412c-8fe9-759c208337aa/samsclub-com-api
- Parse's Costco service documents catalog search, product details and warehouse
  locations. None of its eight listed endpoints documents per-warehouse quantity
  or on-order/in-transit/on-hand transitions. Product availability plus a nearby
  warehouse list is not evidence of stock at that warehouse. Source:
  https://parse.bot/marketplace/8fb92be2-2257-46fb-a922-8ea4015f1bb2/costco-com-api
- Zephyr's indexed client usage terms restrict public access and redistribution.
  Obtain written permission for this app's intended use before connecting their
  commercial feed. Contact listed in those terms: monitors@zephyrmonitors.com.
  https://www.zephyrmonitors.com/terms

Screening outcome: Zephyr and Moonitor are relevant inventory-provider leads;
Parse is a catalog/location lead. No reviewed source supplies a verified usable
shipment-status feed for the monitor yet. Do not purchase a catalog service on
the assumption that it includes warehouse stock.

### Alternative route review and live checker test (2026-10-06)

An authorized CCN `/instore bestbuy_exact` test returned a disabled/API-glitch
notice, not inventory. The command description advertises a 50-mile radius and
one use per six hours. Those limits do not meet the requested 75-mile nightly
coverage by themselves. A provider-access inquiry was sent to CCN asking about
supported feeds, exact quantities, shipment phases, coverage, and pricing.

Costco's official customer guidance documents warehouse inventory checks through
its app and customer service, with up to 30 minutes of delay. Eligible product
pages may show availability after selecting My Warehouse; warehouse-only items
are not necessarily listed online. Sources:
https://customerservice.costco.com/app/answers/detail/a_id/11031
https://customerservice.costco.com/app/answers/answer_view/a_id/1015066/~/how-do-i-check-warehouse-inventory-and-prices%253F

Source review of the openweb Costco adapter found that `checkWarehouseStock`
uses `buyable` and `programTypes` and exposes `maxItemOrderQty` as `maxQuantity`.
The latter is an order limit, not a stock count; the WH program classification
alone does not verify local on-hand stock. Do not copy this interpretation into
our inventory model without independent location-specific validation.
https://github.com/imoonkey/openweb/blob/main/src/sites/costco/adapters/costco-api.ts

Moonitor retail documentation describes Discord-channel webhooks for delivering
alerts. That does not document arbitrary app webhook delivery or an external
inventory API. `moonitor.dev` search results describe uptime/incident monitoring;
no relationship to the retailer bot at `moonitor.tools` was verified. Do not use
the uptime service's API as a retail inventory provider.
https://docs.moonitor.tools/monitoring-commands/customizing-moonitor

Buildable fallback: capture explicit location-specific availability from retailer
pages, attach product/location/source timestamps, retain unknown quantities, and
notify only confirmed state transitions. Incoming shipments remain unknown
until the source explicitly publishes them. This review added no runtime feed.

### Additional inventory source leads (2026-10-06)

RestockR's existing Discord news channel contains historical September Costco
reports with warehouse identifiers and on-order, in-transit, and on-hand counts.
This verifies that the community publishes such reports, not their accuracy or
current availability. Regional distribution centers must not be presented as
customer warehouses. No historical counts were imported into live inventory.
A private support inquiry was sent and visibly verified in ticket 1251 asking
about API/webhook/export access, permission, coverage, timestamps, quantities,
75-mile ZIP searches, and current Sam's product identifier compatibility.
The ticket is awaiting a response. Channel reference:
https://discord.com/channels/1348719595619614743/1349023087265452055

Hermai documents a Costco `warehouse_inventory_batch` schema for checking SKUs
at a specified warehouse. Hosted execution is not enabled; a schema/data package
requires an account API key. It is therefore not a ready cloud inventory feed.
No exact quantities or incoming shipment phases were documented. Catalog search
and warehouse locator schemas may help with a future public availability proof.
https://hermai.ai/schemas/costco.com

Unwrangle's Sam's product API documents distinct product_id, sku_id, and item_no
fields. These could resolve legacy identifiers required by Discord checkers,
but compatibility with current /ip/ product URLs is unverified. Its documented
legacy URL examples are not evidence of current support. An API key is required;
the documentation lists ten credits per successful request. No location-specific
quantities or shipment phases were documented. Do not purchase it as a warehouse
quantity feed without confirming coverage first.
https://docs.unwrangle.com/samsclub-product-data-api/

An authorized CCN Costco checker test returned an item/checker eligibility error,
not stock. A Sam's test was not submitted because the required legacy product
and SKU identifiers were not verified. No newly working live feed was obtained.
