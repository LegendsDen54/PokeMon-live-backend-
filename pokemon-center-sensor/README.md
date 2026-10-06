# Pokémon Center Signal Sensor

This optional Chrome extension observes changes that are visible on Pokémon Center pages already open in the owner's browser. It sends only the change summaries to the owner's monitor.

It detects public page changes, new product links that appear on an observed listing page, image changes, SKU changes, price changes, availability changes, and visible queue messages. It does not bypass queue, CAPTCHA, bot protection, or authentication.

## Setup

1. Set `POKEMON_CENTER_SENSOR_TOKEN` to a long random pairing key in the Render service environment.
2. In Chrome, open `chrome://extensions`, turn on Developer mode, select **Load unpacked**, and choose this `pokemon-center-sensor` folder.
3. Open the extension, enter `https://pokemon-live-backend.onrender.com` and the same pairing key, then choose **Save and test connection**.
4. Keep the Pokémon Center pages you want to watch open in Chrome. The extension reports page changes while those tabs are open.

The pairing key is not stored in this repository and must not be shared with other people. It only authorizes observations sent to this monitor; it does not grant access to Pokémon Center, Discord, or any retailer account.
