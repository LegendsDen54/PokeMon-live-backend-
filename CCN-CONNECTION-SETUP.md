# CCN connection

## Preferred: official Discord bot hosted with the monitor

The server supports an official bot connection via CCN_DISCORD_BOT_TOKEN. It stays disabled until a bot token is configured. An administrator of CCN guild 1410547930250612828 must invite that bot and give it View Channel and Read Message History in only the four configured channels. Enable Message Content Intent in the Discord developer application. No Administrator or Send Messages permission is needed. Do not use a personal account token. Add the bot token directly to Render's backend environment, never to frontend code, the sensor, or this repository. Restart/deploy after setup. The private /api/ccn/connection endpoint reports configured/connected/lastPublishedAt/errors without exposing credentials.

The official bot receives messageCreate/messageUpdate events, follows normal Discord rate limits, and uses a ten-minute history check for recovery. Fresh source reports go directly into the existing authenticated storage/push pipeline internally; there is no viewer pairing-key submission involved in ingestion. Walmart, Target and Pokémon Center are routed by retailer. Multi-retailer digests remain with the scheduled collector to avoid guesses. Official message event delivery, hosting failures and push services can delay notifications; phone display is not guaranteed.

## Available fallback: Chrome sensor 1.4.13

Reload the updated unpacked extension and approve its added Discord site access. It uses the already-saved sensor connection, not the report-import page. Keep each wanted configured CCN channel loaded in a separate Chrome tab. The content script only observes rendered messages and edits. Queued transfers retry with backoff. Chrome/computer must remain awake and online. Check the popup's CCN transfer status for actual success. The bridge is not verified active until a real post is transferred and the monitor card appears.

## Channels

- news: 1424776504767680722
- information: 1514248684575920160
- Pokémon: 1460973469150875720
- product-restocks: 1424776415286657136

## Qualification

Source reports remain distinct from retailer confirmation. Only approved Walmart/GT sellers and user price rules can send Walmart stock alerts; missing verified MSRP leaves a watchlist candidate. Target seller-unverified candidates can appear as upcoming, but cannot trigger a Target-sold availability alert. Pokémon Center warnings are dated third-party readiness evidence. An unchanged available state does not repeat an alert. A source out-of-stock report is needed before a later available state can trigger a new stock alert.
