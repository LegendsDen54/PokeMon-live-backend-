require("dotenv").config();

const webpush = require("web-push");
const crypto = require("crypto");
const { Pool } = require("pg");

const VAPID_PUBLIC_KEY =
  (process.env.VAPID_PUBLIC_KEY || "").trim();

const VAPID_PRIVATE_KEY =
  (process.env.VAPID_PRIVATE_KEY || "").trim();

const VAPID_SUBJECT =
  (
    process.env.VAPID_SUBJECT ||
    "https://pokemon-live-monitor.onrender.com"
  ).trim();

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  }
});

/*
  FAST IN-MEMORY CACHE

  PostgreSQL is the permanent source.
*/
const subscriptions =
  new Map();

let databaseReady = false;


/* ========================================
   SAFE VAPID HELPERS
======================================== */

function isBase64Url(value) {
  return /^[A-Za-z0-9_-]+$/.test(
    value
  );
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
   STARTUP DIAGNOSTICS
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
   INITIALIZE PUSH DATABASE
======================================== */

async function initializePushDatabase() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL missing. Push persistence unavailable."
    );

    return {
      ok: false,
      loaded: 0
    };
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result =
    await pool.query(`
      SELECT
        endpoint,
        subscription
      FROM push_subscriptions
    `);

  subscriptions.clear();

  for (const row of result.rows) {
    if (
      row.endpoint &&
      row.subscription
    ) {
      subscriptions.set(
        row.endpoint,
        row.subscription
      );
    }
  }

  databaseReady = true;

  console.log(
    `Push database initialized. Loaded ${subscriptions.size} subscription(s).`
  );

  return {
    ok: true,
    loaded:
      subscriptions.size
  };
}


/* ========================================
   PUBLIC KEY
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

async function addSubscription(
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

  await pool.query(
    `
    INSERT INTO push_subscriptions (
      endpoint,
      subscription,
      created_at,
      updated_at
    )

    VALUES (
      $1,
      $2::jsonb,
      NOW(),
      NOW()
    )

    ON CONFLICT (endpoint)

    DO UPDATE SET
      subscription =
        EXCLUDED.subscription,
      updated_at =
        NOW()
    `,
    [
      subscription.endpoint,
      JSON.stringify(
        subscription
      )
    ]
  );

  databaseReady = true;

  return {
    ok: true,
    persisted: true,
    subscriptions:
      subscriptions.size
  };
}


/* ========================================
   REMOVE SUBSCRIPTION
======================================== */

async function removeSubscription(
  endpoint
) {
  if (!endpoint) {
    return {
      ok: false,
      subscriptions:
        subscriptions.size
    };
  }

  const existed =
    subscriptions.delete(
      endpoint
    );

  await pool.query(
    `
    DELETE FROM push_subscriptions
    WHERE endpoint = $1
    `,
    [endpoint]
  );

  return {
    ok: existed,
    persisted: true,
    subscriptions:
      subscriptions.size
  };
}


/* ========================================
   REMOVE EXPIRED SUBSCRIPTION
======================================== */

async function removeExpiredSubscription(
  endpoint
) {
  subscriptions.delete(
    endpoint
  );

  try {
    await pool.query(
      `
      DELETE FROM push_subscriptions
      WHERE endpoint = $1
      `,
      [endpoint]
    );

  } catch (error) {
    console.error(
      "Could not remove expired push subscription from database:",
      error.message
    );
  }
}


/* ========================================
   SAFE PUSH ERROR
======================================== */

function getSafePushError(error) {
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

let lastBroadcast=null;
async function broadcast(payload) {
  const startedAt=Date.now();
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
        await removeExpiredSubscription(
          endpoint
        );

        removed += 1;
      }
    }
  }

  lastBroadcast={startedAt:new Date(startedAt).toISOString(),completedAt:new Date().toISOString(),durationMs:Date.now()-startedAt,accepted:sent,failed,removed,phoneDisplayConfirmed:false};
  return {
    durationMs:lastBroadcast.durationMs,
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

   ALLOWED:
   - Walmart Direct
   - Approved GT Collectibles offer

   GT is allowed regardless of MSRP when
   discovery explicitly marks it eligible.
======================================== */

async function sendRestockAlert(
  item
) {
  const walmartDirect =
    item?.directSeller === true;

  const approvedGT =
    item?.approvedMarketplace === true &&
    item?.alertEligible === true;

  if (
    !item ||
    item.retailer !== "walmart" ||
    item.inStock !== true ||
    (!walmartDirect && !approvedGT)
  ) {
    return {
      ok: false,
      skipped: true,

      reason:
        "Product is not an eligible Walmart-direct or approved GT Collectibles in-stock offer"
    };
  }

  const sellerLabel =
    approvedGT
      ? "GT Collectibles"
      : "Walmart-direct";

  return broadcast({
    title:
      "🔥 Pokémon Restock Detected!",

    body:
      `${item.name} is showing ${sellerLabel} availability.`,

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
   POKEMON CENTER QUEUE PUSH TEST
======================================== */

async function sendPokemonCenterQueueTestAlert() {
  return broadcast({
    title:
      "Pokémon Center — Queue Detected (Test)",

    body:
      "A Pokémon Center queue alert would appear here. This is only a notification test.",

    url:
      "https://pokemon-live-backend.onrender.com/",

    icon:
      "https://pokemon-live-backend.onrender.com/restock_background.png",

    badge:
      "https://pokemon-live-backend.onrender.com/restock_background.png",

    tag:
      "pokemon-center-queue-test"
  });
}


/* ========================================
   STATUS
======================================== */

function getPushStatus() {
  return {
    lastBroadcast,
    configured,

    subscriptions:
      subscriptions.size,

    persistentStorage:
      databaseReady,

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
  initializePushDatabase,

  getPublicKey,

  addSubscription,

  removeSubscription,

  broadcast,

  sendRestockAlert,

  sendTestAlert,

  sendPokemonCenterQueueTestAlert,

  getPushStatus
};
