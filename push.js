const webpush = require("web-push");
const crypto = require("crypto");

const VAPID_PUBLIC_KEY =
  (process.env.VAPID_PUBLIC_KEY || "").trim();

const VAPID_PRIVATE_KEY =
  (process.env.VAPID_PRIVATE_KEY || "").trim();

const VAPID_SUBJECT =
  (
    process.env.VAPID_SUBJECT ||
    "https://pokemon-live-monitor.onrender.com"
  ).trim();

const subscriptions = new Map();


/* ========================================
   SAFE VAPID HELPERS
======================================== */

function isBase64Url(value) {
  return /^[A-Za-z0-9_-]+$/.test(value);
}


function base64UrlToBuffer(value) {

  const padding =
    "=".repeat(
      (4 - (value.length % 4)) % 4
    );

  const base64 =
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/") +
    padding;

  return Buffer.from(
    base64,
    "base64"
  );
}


/* ========================================
   VERIFY VAPID KEY PAIR

   Does NOT print or expose
   the private key.
======================================== */

function verifyVapidKeyPair() {

  try {

    if (
      !VAPID_PUBLIC_KEY ||
      !VAPID_PRIVATE_KEY
    ) {

      return {
        checked: false,
        match: false,
        reason:
          "Missing VAPID key"
      };
    }

    const privateBytes =
      base64UrlToBuffer(
        VAPID_PRIVATE_KEY
      );

    const expectedPublicBytes =
      base64UrlToBuffer(
        VAPID_PUBLIC_KEY
      );

    if (
      privateBytes.length !== 32
    ) {

      return {
        checked: true,
        match: false,
        reason:
          `Private key decoded to ${privateBytes.length} bytes instead of 32`
      };
    }

    if (
      expectedPublicBytes.length !== 65
    ) {

      return {
        checked: true,
        match: false,
        reason:
          `Public key decoded to ${expectedPublicBytes.length} bytes instead of 65`
      };
    }

    const ecdh =
      crypto.createECDH(
        "prime256v1"
      );

    ecdh.setPrivateKey(
      privateBytes
    );

    const derivedPublicBytes =
      ecdh.getPublicKey(
        null,
        "uncompressed"
      );

    return {
      checked: true,

      match:
        derivedPublicBytes.equals(
          expectedPublicBytes
        ),

      privateBytes:
        privateBytes.length,

      publicBytes:
        expectedPublicBytes.length,

      derivedPublicBytes:
        derivedPublicBytes.length
    };

  } catch (error) {

    return {
      checked: true,
      match: false,
      reason:
        error.message
    };
  }
}


const keyPairCheck =
  verifyVapidKeyPair();


/* ========================================
   SAFE STARTUP DIAGNOSTICS
======================================== */

console.log(
  "Web Push diagnostics:"
);

console.log({

  publicKeyLength:
    VAPID_PUBLIC_KEY.length,

  expectedPublicKeyLength:
    87,

  privateKeyLength:
    VAPID_PRIVATE_KEY.length,

  expectedPrivateKeyLength:
    43,

  publicKeyUrlSafe:
    isBase64Url(
      VAPID_PUBLIC_KEY
    ),

  privateKeyUrlSafe:
    isBase64Url(
      VAPID_PRIVATE_KEY
    ),

  subject:
    VAPID_SUBJECT,

  keyPairMatch:
    keyPairCheck.match,

  keyPairCheck
});


/* ========================================
   CONFIGURE WEB PUSH
======================================== */

let configured = false;
let configurationError = null;

try {

  if (
    !VAPID_PUBLIC_KEY ||
    !VAPID_PRIVATE_KEY
  ) {

    throw new Error(
      "VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is missing"
    );
  }

  if (!keyPairCheck.match) {

    throw new Error(
      "VAPID public/private keys do not form a matching cryptographic pair"
    );
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

  configured = true;

  console.log(
    "Web Push configured with verified matching VAPID key pair."
  );

} catch (error) {

  configurationError =
    error.message;

  console.error(
    "Web Push configuration failed:",
    error.message
  );
}


/* ========================================
   PUBLIC KEY

   SAFE TO SEND TO FRONTEND.

   This is the function server.js
   expects at /api/push/public-key.
======================================== */

function getPublicKey() {

  if (!configured) {
    return null;
  }

  return VAPID_PUBLIC_KEY;
}


/* ========================================
   ADD SUBSCRIPTION
======================================== */

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

  return {
    ok: true,
    subscriptions:
      subscriptions.size
  };
}


/* ========================================
   REMOVE SUBSCRIPTION
======================================== */

function removeSubscription(
  endpoint
) {

  if (!endpoint) {

    return {
      ok: false,
      subscriptions:
        subscriptions.size
    };
  }

  const removed =
    subscriptions.delete(
      endpoint
    );

  return {
    ok: removed,
    subscriptions:
      subscriptions.size
  };
}


/* ========================================
   SAFE PUSH ERROR
======================================== */

function getSafePushError(
  error
) {

  return {

    message:
      error?.message ||
      "Unknown push error",

    statusCode:
      error?.statusCode ||
      null,

    body:
      typeof error?.body ===
      "string"
        ? error.body.slice(
            0,
            1000
          )
        : null
  };
}


/* ========================================
   SEND TO ONE SUBSCRIPTION
======================================== */

async function sendToSubscription(
  subscription,
  payload
) {

  return webpush.sendNotification(
    subscription,
    JSON.stringify(
      payload
    )
  );
}


/* ========================================
   BROADCAST
======================================== */

async function broadcast(
  payload
) {

  if (!configured) {

    return {
      ok: false,
      sent: 0,
      failed: 0,
      removed: 0,

      subscriptions:
        subscriptions.size,

      errors: [
        {
          message:
            configurationError ||
            "Web Push is not configured"
        }
      ]
    };
  }

  let sent = 0;
  let failed = 0;
  let removed = 0;

  const errors = [];

  for (
    const [
      endpoint,
      subscription
    ]
    of subscriptions.entries()
  ) {

    try {

      await sendToSubscription(
        subscription,
        payload
      );

      sent += 1;

    } catch (error) {

      failed += 1;

      const safeError =
        getSafePushError(
          error
        );

      errors.push(
        safeError
      );

      console.error(
        "Push delivery failed:",
        safeError
      );

      if (
        error?.statusCode === 404 ||
        error?.statusCode === 410
      ) {

        subscriptions.delete(
          endpoint
        );

        removed += 1;
      }
    }
  }

  return {
    ok:
      failed === 0,

    sent,
    failed,
    removed,

    subscriptions:
      subscriptions.size,

    errors
  };
}


/* ========================================
   REAL RESTOCK ALERT
======================================== */

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
      skipped: true,
      reason:
        "Product is not Walmart-direct and in stock"
    };
  }

  return broadcast({

    title:
      "🔥 Pokémon Restock Detected!",

    body:
      `${item.name} is showing Walmart-direct availability.`,

    url:
      item.url ||
      "https://pokemon-live-monitor.onrender.com/",

    icon:
      "https://pokemon-live-monitor.onrender.com/restock_background.png",

    badge:
      "https://pokemon-live-monitor.onrender.com/restock_background.png",

    tag:
      `restock-${
        item.productId ||
        "pokemon"
      }`
  });
}


/* ========================================
   CONTROLLED PUSH TEST

   ZERO WALMART API CALLS
======================================== */

async function sendTestAlert() {

  return broadcast({

    title:
      "⚡ Pokémon Restock Monitor",

    body:
      "Test successful! Background push notifications are working.",

    url:
      "https://pokemon-live-monitor.onrender.com/",

    icon:
      "https://pokemon-live-monitor.onrender.com/restock_background.png",

    badge:
      "https://pokemon-live-monitor.onrender.com/restock_background.png",

    tag:
      "pokemon-monitor-test"
  });
}


/* ========================================
   SAFE STATUS
======================================== */

function getPushStatus() {

  return {

    configured,

    subscriptions:
      subscriptions.size,

    publicKeyAvailable:
      Boolean(
        VAPID_PUBLIC_KEY
      ),

    diagnostics: {

      publicKeyLength:
        VAPID_PUBLIC_KEY.length,

      privateKeyLength:
        VAPID_PRIVATE_KEY.length,

      subject:
        VAPID_SUBJECT,

      publicKeyUrlSafe:
        isBase64Url(
          VAPID_PUBLIC_KEY
        ),

      privateKeyUrlSafe:
        isBase64Url(
          VAPID_PRIVATE_KEY
        ),

      keyPairMatch:
        keyPairCheck.match,

      keyPairChecked:
        keyPairCheck.checked,

      configurationError
    }
  };
}


/* ========================================
   EXPORTS
======================================== */

module.exports = {

  getPublicKey,

  addSubscription,

  removeSubscription,

  broadcast,

  sendRestockAlert,

  sendTestAlert,

  getPushStatus
};
