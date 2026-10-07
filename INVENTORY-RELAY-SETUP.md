# Immediate private checker worker

Prepared adapter, inactive until a provider-approved relay is supplied. This is not a Discord slash-command API and cannot invoke another bot as a user.

Ask Rippin Packz/Zephyr for an approved HTTPS service implementing this contract. Configure INVENTORY_CHECKER_RELAY_URL and INVENTORY_CHECKER_RELAY_TOKEN privately on the backend, then deploy. Do not put credentials in the app or chat.

POST JSON: retailer, productId, zip, requestedAt, priority, idempotencyKey. Authorization: Bearer relay token. The provider must deduplicate idempotencyKey and use supported retailer identifiers exactly. Sam's matching internal identifiers must be supplied by the provider, never guessed.

Respond with an actual fresh inventory report accepted by ccn-inventory.save, including matching retailer/productId/zip, checkedAt, sourceUrl and actual locations. Or kind cooldown, retailer, availableAt, sourceUrl for an actual checker cooldown. Never convert provider errors into zero stock.

Manual requests wake the worker immediately. Recovery runs every five seconds. Local results retain existing private browser access and never send shared pushes. Transport failures leave requests available to the scheduled collector. Do not run both collectors against the same pending request during activation; switch collection ownership only after provider verification.

/api/inventory/worker-status exposes credential-free configuration and progress. configured means settings exist, not proof the provider works. Verify a real requested search before declaring the connection active.
