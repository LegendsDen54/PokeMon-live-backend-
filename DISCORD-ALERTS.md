# Discord alert delivery

Set `DISCORD_ALERT_WEBHOOK_URL` as a secret environment variable on the backend service to enable public monitor alerts in the chosen Discord channel. Create the incoming webhook from that channel’s Integrations settings. Do not paste its URL into chat, commit it, or expose it in browser code.

The integration mirrors public push broadcasts, with source/product links and the original source time when supplied. Private stock-request completions and test pushes are excluded. Discord mentions are disabled. It works independently of Web Push configuration.

Delivery uses Discord’s `wait=true` confirmation and an eight-second timeout. Results appear under `discord` in broadcast receipts, separately from phone push delivery. Failures expose no webhook URL. Duplicate events are suppressed for ten minutes in memory; this cache resets on a service restart. Rate limits report the actual Retry-After value; there are no automatic retries or replay of historical alerts. Unknown delivery outcomes are retained in the duplicate cache to avoid immediate duplicate sends.

Alert delivery does not read Discord channels. No user account token is used.

## Stock-check commands

The separate signed HTTP interaction endpoint supports `/monitor`, `/stock retailer product zip` and `/stockstatus retailer product zip`. `/stock` enters the existing manual queue with existing cooldowns; it does not bypass the authorized checker. `/stockstatus` returns only the invoking Discord member’s requested results as an ephemeral reply, including unknown quantities and an explicit truncation notice when all rows do not fit. The full checker source remains linked. Discord requests and browser requests have separate private viewer identities; Discord results are read with `/stockstatus`. Completion is not automatically posted to a public channel.

Create an official Discord application and install it in the Legends Den server with application commands. Configure `DISCORD_APPLICATION_ID`, `DISCORD_APPLICATION_PUBLIC_KEY` and `DISCORD_GUILD_ID` on the backend; optionally restrict commands with `DISCORD_COMMAND_CHANNEL_ID`. Set its Interactions Endpoint URL to `https://pokemon-live-backend.onrender.com/api/discord/interactions` after deploying. Requests require a valid Ed25519 signature and recent timestamp; other servers and DMs are rejected. No Message Content intent or personal-account automation is needed.

Register the three guild commands once using `node scripts/register-discord-commands.js` in a secure environment with the application ID, guild ID and official application’s `DISCORD_BOT_TOKEN`. The script upserts only these names. Never print or paste tokens into chat. The running HTTP command endpoint needs the public key, not that bot token. The existing CCN read-only bot integration is separate and is not enabled by this setup.

Validate locally: `node tests/discord-alerts.test.js`. A real delivery check requires configuring the selected channel, deploying the change, and verifying the resulting Discord message. No live message has been sent by the local test.

Product autocomplete uses the monitor's known product identifiers and dated structured source reports. It includes source-reported drops today in America/Chicago, retailer-confirmed upcoming products with an explicit future ISO date, and Costco drops within the trailing 14 days. Catalog verification dates, imported timestamps and unverified predictions do not qualify. Empty lists are valid when no eligible evidence exists. Suggestions never initiate stock searches. The report cache lasts 30 seconds and fails closed if storage is unavailable. Re-register guild command definitions after changing autocomplete options.

The owner-authorized Rip Radar catalog in `rip-radar-products.json` also supplies product choices. Exact names and source observations come from the normal Radar UI under the owner's source account and map to existing monitor identifiers. This is trusted tracked inventory, not a claim of a retailer-announced release or shelf availability. Costco entries use the actual inventory-added date and expire after 14 days; other retailers use the observation's Chicago date. Keep the source permalink and refresh these observations when the normal assisted checker provides new evidence. No private Discord account token is used by the backend.
