# Pokémon Live Monitor Backend — iPhone-friendly flat layout

All files intentionally live in the repository root so they can be uploaded from iPhone Safari without preserving folders.

This starts in mock mode. Real inventory requires an authorized retail inventory/API data source configured with environment variables on the hosting service.

## Online TCG checks and nearby locations

Sam's Club, Costco and Target now have public online product checks under
`/api/retail/online` and `/api/retail/product-check`. These use retailer-published
structured product offers, retain unknown quantities, and never treat a product
link or generic shipping text as proof of stock. Target offers require explicit
Target seller attribution before an available status is accepted.

The public monitor starts independently of Walmart and Pokémon Center. It checks
known URLs every 30 minutes (Target every 10 minutes during 02:00–05:00
America/Chicago), with ten-minute per-URL caching. Public catalog discovery is
attempted daily; inaccessible catalogs prevent automatic discovery. Each retailer
retains up to 100 discovered links and rotates through at most 12 URLs per cycle.
This is bounded coverage, not a claim that every retailer listing is accessible.
`SAMS_PUBLIC_WATCH_URLS`, `COSTCO_PUBLIC_WATCH_URLS`, and
`TARGET_PUBLIC_WATCH_URLS` accept comma/newline-separated official product URLs.
Set `RETAIL_PUBLIC_MONITOR_ENABLED=false` to disable this independent scheduler.
429/temporary failures back off exponentially with jitter and Retry-After;
401/403 pause that URL for six hours. No authentication or anti-bot bypass is used.

With DATABASE_URL configured, observed products/baselines are saved in the
`retail_online_observations` table. Without it they are session-only. The first
observation establishes a quiet baseline; subsequent stock/preorder transitions
use the existing push system. Push delivery still needs valid existing VAPID
configuration and device subscriptions. Cached observations retain their actual
fetch timestamp; old/failed checks are marked stale rather than current stock.

`/api/retail/locations?retailer=costco&zip=60634` (or `sams`) queries nearby mapped
locations within 75 straight-line miles of the ZIP center. Data is attributed to
OpenStreetMap contributors, cached 24 hours, serialized and bounded to 25 new ZIP
queries a day for this private monitor. ZIP centroids come from Zippopotam.us.
`RETAIL_LOCATION_API_URL` overrides the Overpass interpreter endpoint. Mapping
is not product stock; quantities and shipment phases remain unknown. The official
retailer locator is available when the mapping service fails. General mapping
services may omit or have outdated stores; verify locations with the retailer.

Online availability does not establish delivery eligibility at another ZIP.
Alerts and cards require users to confirm shipping to their real destination at
the retailer. Regional pickup stock is not labeled as shippable nationwide stock.
