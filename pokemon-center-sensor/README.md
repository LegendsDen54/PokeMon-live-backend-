# Pokémon Center Signal Sensor

This optional Chrome extension observes changes that are visible on Pokémon Center pages already open in the owner's browser. It sends only the change summaries to the owner's monitor.

It detects public page changes, new product links that appear on an observed listing page, image changes, SKU changes, price changes, availability changes, and visible queue messages. It does not bypass queue, CAPTCHA, bot protection, or authentication.

## Setup

1. Set `POKEMON_CENTER_SENSOR_TOKEN` to a long random pairing key in the Render service environment.
2. In Chrome, open `chrome://extensions`, turn on Developer mode, select **Load unpacked**, and choose this `pokemon-center-sensor` folder.
3. Open the extension, enter `https://pokemon-live-backend.onrender.com` and the same pairing key, then choose **Save and test connection**.
4. Keep the Pokémon Center pages you want to watch open in Chrome. The extension reports page changes while those tabs are open.
5. **Refresh Pokémon Center automatically** starts enabled. It refreshes only already-open Pokémon Center tabs every minute Tuesday through Thursday from 9 AM to 2 PM Central, then stops outside those hours. You can turn it off in the extension popup.

Version 1.4.8 uses explicit structured product offers for Sam's Club and Costco.
Generic words such as delivery, shipping, pickup, or add-to-list do not imply
stock. These observations are online offers, not warehouse counts. An observation
heartbeat is sent every two minutes while an eligible page remains open; it does
not force a retailer reload or discover private changes on an idle page. After
reloading the extension, reload the Sam's/Costco product tabs to attach the new
script. Pokémon Center and X monitoring retain their existing scripts.

The pairing key is not stored in this repository and must not be shared with other people. It only authorizes observations sent to this monitor; it does not grant access to Pokémon Center, Discord, or any retailer account.

Version 1.4.11 adds optional Target product-page observations. Reload the unpacked extension and approve the Target site permission, then reload the Target product tabs once. It reports structured offers explicitly sold by Target and visible changes, without automatic Target reloads, queue actions or checkout. An idle tab cannot discover changes that Target never sends to it.

Version 1.4.12 adds five-minute automatic Target product-tab reloads. Enabled by default for the requested watch. Chrome and these tabs must remain open, but may stay in the background. Queues/security challenges latch a pause until the user resolves the page and toggles Target refresh off/on. No cart, checkout or account page is reloaded.

## 1.4.13: CCN browser bridge

Reload the unpacked extension and grant its new permission for the CCN Discord pages. The sensor reuses its existing saved backend connection: no key needs to be pasted into the report-transfer page. Open the configured CCN news, information, Pokémon and product-restocks channels in separate Discord tabs. New rendered messages and edits are queued after a 500 ms debounce and sent to the authenticated monitor endpoint. Failed transfers are retained locally with bounded backoff, jitter and Retry-After support. The popup shows last successful transfer, pending count and errors. Disable Transfer CCN alerts to pause.

This bridge observes the loaded messages in those four channels only. It does not read other Discord servers, DMs, account tokens or hidden APIs. It cannot monitor a closed tab or retrieve messages that Discord has not rendered. Browser sleep, disconnection or background throttling can delay transfers. The scheduled collector remains a fallback. Multi-retailer digests stay with that collector to avoid misattribution. Walmart products with unverified price eligibility remain watchlist candidates, not purchase alerts.
