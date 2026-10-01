const webpush = require("web-push");

const publicKey =
  process.env.VAPID_PUBLIC_KEY;

const privateKey =
  process.env.VAPID_PRIVATE_KEY;

const subject =
  process.env.VAPID_SUBJECT ||
  "https://pokemon-live-monitor.onrender.com";

const subscriptions = new Map();

let pushConfigured = false;

function configurePush() {
  if (!publicKey || !privateKey) {
    console.log(
      "Web Push disabled: VAPID keys not configured."
    );

    return false;
  }

  try {
    webpush.setVapidDetails(
      subject,
      publicKey,
      privateKey
    );

    console.log(
      "Web Push configured."
    );

    return true;

  } catch (error) {
    console.error(
      "Web Push configuration failed:",
      error.message
    );

    return false;
  }
}

pushConfigured =
  configurePush();

function getPublicKey() {
  return publicKey || null;
}

function addSubscription(
  subscription
) {
  if (
    !subscription ||
    !subscription.endpoint
  ) {
    throw new Error(
      "Invalid push subscription"
    );
  }

  subscriptions.set(
    subscription.endpoint,
    subscription
  );

  console.log(
    `Push subscription saved. Total: ${subscriptions.size}`
  );

  return {
    ok: true,
    subscriptions:
      subscriptions.size
  };
}

function removeSubscription(
  endpoint
) {
  if (!endpoint) {
    return false;
  }

  return subscriptions.delete(
    endpoint
  );
}

async function sendToSubscription(
  subscription,
  payload
) {
  if (!pushConfigured) {
    throw new Error(
      "Web Push is not configured"
    );
  }

  return webpush.sendNotification(
    subscription,
    JSON.stringify(payload)
  );
}

async function broadcast(
  payload
) {
  if (!pushConfigured) {
    console.log(
      "Push skipped: Web Push not configured."
    );

    return {
      ok: false,
      sent: 0,
      reason:
        "Web Push not configured"
    };
  }

  let sent = 0;
  let failed = 0;
  let removed = 0;

  const entries =
    Array.from(
      subscriptions.entries()
    );

  for (
    const [
      endpoint,
      subscription
    ] of entries
  ) {
    try {
      await sendToSubscription(
        subscription,
        payload
      );

      sent += 1;

    } catch (error) {
      if (
        error.statusCode === 404 ||
        error.statusCode === 410
      ) {
        subscriptions.delete(
          endpoint
        );

        removed += 1;

      } else {
        failed += 1;

        console.error(
          "Push delivery failed:",
          error.message
        );
      }
    }
  }

  return {
    ok: true,
    sent,
    failed,
    removed,
    subscriptions:
      subscriptions.size
  };
}

async function sendRestockAlert(
  item
) {
  if (
    !item ||
    item.retailer !== "walmart" ||
    item.directSeller !== true ||
    item.inStock !== true
  ) {
    return {
      ok: false,
      sent: 0,
      reason:
        "Not a Walmart-direct in-stock item"
    };
  }

  const price =
    item.price != null
      ? `$${Number(
          item.price
        ).toFixed(2)}`
      : "Price available";

  const payload = {
    title:
      "🔥 Pokémon Walmart Restock!",
    body:
      `${item.name} • ${price}`,
    icon:
      item.image || undefined,
    badge:
      item.image || undefined,
    url:
      item.url ||
      "https://pokemon-live-monitor.onrender.com/",
    productId:
      item.productId,
    retailer:
      "walmart",
    tag:
      `walmart-${item.productId}`,
    timestamp:
      Date.now()
  };

  return broadcast(
    payload
  );
}

async function sendTestAlert() {
  return broadcast({
    title:
      "⚡ Pokémon Restock Monitor",
    body:
      "Test successful! Background push notifications are working.",
    url:
      "https://pokemon-live-monitor.onrender.com/",
    tag:
      "pokemon-monitor-test",
    timestamp:
      Date.now()
  });
}

function getPushStatus() {
  return {
    configured:
      pushConfigured,
    subscriptions:
      subscriptions.size,
    publicKeyAvailable:
      Boolean(publicKey)
  };
}

module.exports = {
  getPublicKey,
  addSubscription,
  removeSubscription,
  broadcast,
  sendRestockAlert,
  sendTestAlert,
  getPushStatus
};