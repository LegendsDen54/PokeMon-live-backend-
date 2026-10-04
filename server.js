require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");

const {
  runCheck,
  getLatest,
  saveResult,
  getScannerState
} = require("./monitor");

const walmart = require("./walmart");
const push = require("./push");
const discovery = require("./discovery");
const products = require("./products.json");
const multiStore = require("./multi-store");

const app =
  express();

const port =
  Number(
    process.env.PORT ||
    8080
  );

const allowedOrigin =
  process.env
    .ALLOWED_ORIGIN ||
  "*";

const runOnStartup =
  String(
    process.env
      .RUN_ON_STARTUP ||
    "false"
  )
    .toLowerCase() ===
  "true";

const enableFullPolling =
  String(
    process.env
      .ENABLE_FULL_POLLING ||
    "false"
  )
    .toLowerCase() ===
  "true";

const enableDiscovery =
  String(
    process.env
      .ENABLE_DISCOVERY ||
    "true"
  )
    .toLowerCase() ===
  "true";

const pollSeconds =
  Math.max(
    60,
    Number(
      process.env
        .POLL_SECONDS ||
      60
    )
  );

const discoveryMinutes =
  Math.max(
    5,
    Number(
      process.env
        .DISCOVERY_MINUTES ||
      5
    )
  );

app.use(
  cors({
    origin:
      allowedOrigin === "*"
        ? true
        : allowedOrigin
  })
);

app.use(
  express.json()
);

app.get(
  "/",
  (req, res) =>
    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    )
);

app.get(
  "/hero.jpg",
  (req, res) =>
    res.sendFile(
      path.join(
        __dirname,
        "hero.jpg"
      )
    )
);

app.get(
  "/api/backend",
  (req, res) => {
    res.json({
      name:
        "Pokemon Live Monitor Backend",

      ok:
        true,

      provider:
        process.env
          .DATA_PROVIDER ||
        "mock",

      automaticScanning:
        enableFullPolling,

      pollSeconds:
        enableFullPolling
          ? pollSeconds
          : null,

      automaticDiscovery:
        enableDiscovery,

      discoveryMinutes:
        enableDiscovery
          ? discoveryMinutes
          : null,

      marketplaceEndpoint:
        "/api/marketplace",

      providers:
        multiStore
          .getProviderStates(),

      push:
        push
          .getPushStatus()
    });
  }
);

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok:
        true,

      time:
        new Date()
          .toISOString(),

      automaticScanning:
        enableFullPolling,

      pollSeconds:
        enableFullPolling
          ? pollSeconds
          : null,

      automaticDiscovery:
        enableDiscovery,

      discoveryMinutes:
        enableDiscovery
          ? discoveryMinutes
          : null,

      providers:
        multiStore
          .getProviderStates(),

      push:
        push
          .getPushStatus()
    });
  }
);

app.get(
  "/api/push/public-key",
  (req, res) => {
    const publicKey =
      push.getPublicKey();

    if (
      !publicKey
    ) {
      return res
        .status(503)
        .json({
          ok:
            false,

          error:
            "Web Push is not configured"
        });
    }

    res.json({
      ok:
        true,

      publicKey
    });
  }
);

app.get(
  "/api/push/status",
  (req, res) =>
    res.json(
      push
        .getPushStatus()
    )
);

app.get(
  "/api/push/test",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await push
          .sendTestAlert();

      res.json({
        ok:
          true,

        test:
          "web-push",

        walmartApiCalled:
          false,

        ...result
      });

    } catch (error) {
      console.error(
        "Push test failed:",
        error
      );

      res
        .status(500)
        .json({
          ok:
            false,

          test:
            "web-push",

          walmartApiCalled:
            false,

          error:
            error.message
        });
    }
  }
);

app.post(
  "/api/push/subscribe",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await push
          .addSubscription(
            req.body
          );

      res.json({
        ...result,

        message:
          "Push subscription saved permanently"
      });

    } catch (error) {
      console.error(
        "Push subscription failed:",
        error
      );

      res
        .status(400)
        .json({
          ok:
            false,

          error:
            error.message
        });
    }
  }
);

app.post(
  "/api/push/unsubscribe",
  async (
    req,
    res
  ) => {
    try {
      const endpoint =
        req.body &&
        req.body
          .endpoint;

      if (
        !endpoint
      ) {
        return res
          .status(400)
          .json({
            ok:
              false,

            error:
              "Subscription endpoint required"
          });
      }

      res.json(
        await push
          .removeSubscription(
            endpoint
          )
      );

    } catch (error) {
      console.error(
        "Push unsubscribe failed:",
        error
      );

      res
        .status(500)
        .json({
          ok:
            false,

          error:
            error.message
        });
    }
  }
);

app.get(
  "/api/scanner",
  (req, res) => {
    res.json({
      ...getScannerState(),

      automaticPolling:
        enableFullPolling,

      pollSeconds:
        enableFullPolling
          ? pollSeconds
          : null,

      automaticDiscovery:
        enableDiscovery,

      discoveryMinutes:
        enableDiscovery
          ? discoveryMinutes
          : null
    });
  }
);

app.get(
  "/api/status",
  (req, res) => {
    const data =
      getLatest();

    res.json({
      ok:
        true,

      lastRun:
        data.lastRun,

      running:
        data.running,

      count:
        data.items.length,

      items:
        data.items,

      scanner:
        getScannerState(),

      providers:
        multiStore
          .getProviderStates(),

      automaticScanning:
        enableFullPolling,

      pollSeconds:
        enableFullPolling
          ? pollSeconds
          : null,

      automaticDiscovery:
        enableDiscovery,

      discoveryMinutes:
        enableDiscovery
          ? discoveryMinutes
          : null,

      push:
        push
          .getPushStatus()
    });
  }
);

app.get(
  "/api/providers",
  (req, res) => {
    const providers =
      multiStore
        .getProviderStates();

    res.json({
      ok:
        true,

      count:
        providers.length,

      providers
    });
  }
);

app.get(
  "/api/products",
  (req, res) => {
    const retailer =
      req.query.retailer
        ? String(
            req.query.retailer
          )
            .toLowerCase()
        : null;

    const allowed =
      new Set([
        "walmart",
        "target",
        "sams",
        "bestbuy",
        "costco"
      ]);

    if (
      retailer &&
      !allowed.has(
        retailer
      )
    ) {
      return res
        .status(400)
        .json({
          ok:
            false,

          error:
            "Unsupported retailer"
        });
    }

    const items =
      multiStore
        .getProducts(
          retailer
        );

    res.json({
      ok:
        true,

      retailer,

      count:
        items.length,

      items
    });
  }
);

app.get(
  "/api/stores",
  (req, res) => {
    const retailer =
      req.query.retailer
        ? String(
            req.query.retailer
          )
            .toLowerCase()
        : null;

    const items =
      multiStore
        .getStoreInventory(
          retailer
        );

    res.json({
      ok:
        true,

      retailer,

      count:
        items.length,

      items
    });
  }
);

app.get(
  "/api/marketplace",
  async (
    req,
    res
  ) => {
    try {
      const requestedProductId =
        req.query
          .productId ||
        null;

      let catalog =
        products.filter(
          product =>
            product.enabled !==
              false &&

            Array.isArray(
              product.retailers
            ) &&

            product.retailers
              .includes(
                "walmart"
              )
        );

      if (
        requestedProductId
      ) {
        catalog =
          catalog.filter(
            product =>
              product.id ===
              requestedProductId
          );

        if (
          !catalog.length
        ) {
          return res
            .status(404)
            .json({
              ok:
                false,

              error:
                "Product not found",

              productId:
                requestedProductId
            });
        }
      }

      const offers =
        [];

      const errors =
        [];

      for (
        const product
        of catalog
      ) {
        try {
          const productOffers =
            await walmart
              .searchMarketplaceOffers(
                product
              );

          for (
            const offer
            of productOffers
          ) {
            offers.push({
              ...offer,

              alertEligible:
                false
            });
          }

        } catch (error) {
          console.error(
            `Marketplace search failed for ${product.id}:`,
            error.message
          );

          errors.push({
            productId:
              product.id,

            error:
              error.message
          });
        }
      }

      const uniqueOffers =
        new Map();

      for (
        const offer
        of offers
      ) {
        const key =
          offer.walmartItemId
            ? String(
                offer
                  .walmartItemId
              )
            : [
                offer.name,
                offer.seller,
                offer.price
              ]
                .join("|");

        const existing =
          uniqueOffers
            .get(
              key
            );

        if (
          !existing ||
          Number(
            offer.price
          ) <
          Number(
            existing.price
          )
        ) {
          uniqueOffers.set(
            key,
            offer
          );
        }
      }

      const sorted =
        Array.from(
          uniqueOffers
            .values()
        )
          .filter(
            offer =>
              offer.price !==
              null
          )
          .sort(
            (
              a,
              b
            ) =>
              Number(
                a.price
              ) -
              Number(
                b.price
              )
          );

      const available =
        sorted.filter(
          offer =>
            offer
              .offerAvailable ===
            true
        );

      const walmartDirect =
        available.filter(
          offer =>
            offer
              .directSeller ===
            true
        );

      const marketplace =
        available.filter(
          offer =>
            offer
              .directSeller !==
            true
        );

      res.json({
        ok:
          true,

        generatedAt:
          new Date()
            .toISOString(),

        sort:
          "price-low-to-high",

        searchedProducts:
          catalog.length,

        totalOffersFound:
          sorted.length,

        availableCount:
          available.length,

        walmartDirectCount:
          walmartDirect.length,

        marketplaceCount:
          marketplace.length,

        failedSearches:
          errors.length,

        items:
          available,

        groups: {
          walmartDirect,
          marketplace
        },

        errors
      });

    } catch (error) {
      console.error(
        "Marketplace endpoint failed:",
        error
      );

      res
        .status(500)
        .json({
          ok:
            false,

          error:
            error.message
        });
    }
  }
);

app.get(
  "/api/test/product/:productId",
  async (
    req,
    res
  ) => {
    try {
      const product =
        products.find(
          item =>
            item.id ===
            req.params
              .productId
        );

      if (
        !product
      ) {
        return res
          .status(404)
          .json({
            ok:
              false,

            error:
              "Product not found",

            productId:
              req.params
                .productId
          });
      }

      if (
        !Array.isArray(
          product.retailers
        ) ||

        !product.retailers
          .includes(
            "walmart"
          )
      ) {
        return res
          .status(400)
          .json({
            ok:
              false,

            error:
              "Product is not configured for Walmart"
          });
      }

      const result =
        await walmart
          .checkProduct(
            product,
            "walmart"
          );

      const savedResult =
        saveResult(
          result
        );

      res.json({
        ok:
          true,

        test:
          "single-product",

        dashboardUpdated:
          true,

        requestedProductId:
          product.id,

        configuredItemId:
          product
            .walmartItemId ||
          null,

        result:
          savedResult
      });

    } catch (error) {
      console.error(
        "Controlled Walmart test failed:",
        error
      );

      res
        .status(500)
        .json({
          ok:
            false,

          error:
            error.message
        });
    }
  }
);

app.get(
  "/api/test/prismatic-etb",
  async (
    req,
    res
  ) => {
    try {
      const product =
        products.find(
          item =>
            item.id ===
            "prismatic-etb"
        );

      if (
        !product
      ) {
        return res
          .status(404)
          .json({
            ok:
              false,

            error:
              "prismatic-etb not found"
          });
      }

      const result =
        await walmart
          .checkProduct(
            product,
            "walmart"
          );

      const savedResult =
        saveResult(
          result
        );

      res.json({
        ok:
          true,

        test:
          "single-product",

        dashboardUpdated:
          true,

        configuredItemId:
          product
            .walmartItemId ||
          null,

        result:
          savedResult
      });

    } catch (error) {
      console.error(
        "Controlled Walmart test failed:",
        error
      );

      res
        .status(500)
        .json({
          ok:
            false,

          error:
            error.message
        });
    }
  }
);

app.get(
  "/api/discovery/run",
  async (
    req,
    res
  ) => {
    try {
      res.json({
        ok:
          true,

        discovery:
          await discovery
            .discoverWalmartProducts()
      });

    } catch (error) {
      console.error(
        "Manual discovery failed:",
        error
      );

      res
        .status(500)
        .json({
          ok:
            false,

          error:
            error.message
        });
    }
  }
);

app.get(
  "/api/discovery/products",
  async (
    req,
    res
  ) => {
    try {
      const items =
        await discovery
          .getDiscoveredProducts();

      res.json({
        ok:
          true,

        count:
          items.length,

        items
      });

    } catch (error) {
      console.error(
        "Get discovered products failed:",
        error
      );

      res
        .status(500)
        .json({
          ok:
            false,

          error:
            error.message
        });
    }
  }
);

app.get(
  "/api/debug/walmart-search",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await walmart
          .inspectSearchResponse(
            req.query
              .keyword ||
            "Pokemon TCG"
          );

      res.json({
        ok:
          true,

        ...result
      });

    } catch (error) {
      console.error(
        "Walmart search diagnostic failed:",
        error
      );

      res
        .status(500)
        .json({
          ok:
            false,

          error:
            error.message
        });
    }
  }
);

async function runScheduledScan() {
  try {
    console.log(
      "Starting scheduled catalog scan..."
    );

    const result =
      await runCheck();

    console.log(
      "Scheduled catalog scan finished:",
      result
    );

  } catch (error) {
    console.error(
      "Scheduled catalog scan failed:",
      error
    );
  }
}

let discoveryRunning =
  false;

async function runScheduledDiscovery() {
  if (
    discoveryRunning
  ) {
    console.log(
      "Discovery already running. Skipping duplicate run."
    );

    return;
  }

  discoveryRunning =
    true;

  try {
    console.log(
      "Starting Walmart product discovery..."
    );

    const result =
      await discovery
        .discoverWalmartProducts();

    console.log(
      "Walmart product discovery finished:",
      result
    );

  } catch (error) {
    console.error(
      "Walmart product discovery failed:",
      error
    );

  } finally {
    discoveryRunning =
      false;
  }
}

app.listen(
  port,
  async () => {
    console.log(
      `Pokemon monitor backend listening on ${port}`
    );

    console.log(
      "Web Push configuration:",
      push.getPushStatus()
    );

    try {
      await discovery
        .initializeDiscoveryDatabase();

      console.log(
        "Discovery storage ready."
      );

    } catch (error) {
      console.error(
        "Discovery database initialization failed:",
        error
      );
    }

    try {
      const pushDatabase =
        await push
          .initializePushDatabase();

      console.log(
        "Persistent push storage ready:",
        pushDatabase
      );

    } catch (error) {
      console.error(
        "Push database initialization failed:",
        error
      );
    }

    try {
      const results =
        await multiStore
          .start({
            getWalmartState:
              getLatest
          });

      console.log(
        "Multi-store provider engine started:",
        results
      );

    } catch (error) {
      console.error(
        "Multi-store provider engine startup failed:",
        error
      );
    }

    if (
      runOnStartup
    ) {
      console.log(
        "RUN_ON_STARTUP enabled."
      );

      await runScheduledScan();

    } else {
      console.log(
        "Startup scan disabled."
      );
    }

    if (
      enableFullPolling
    ) {
      console.log(
        `Automatic catalog polling ENABLED every ${pollSeconds} seconds.`
      );

      setInterval(
        runScheduledScan,
        pollSeconds *
          1000
      );

    } else {
      console.log(
        "Automatic catalog polling disabled."
      );
    }

    if (
      enableDiscovery
    ) {
      console.log(
        `Automatic Walmart discovery ENABLED every ${discoveryMinutes} minutes.`
      );

      setTimeout(
        runScheduledDiscovery,
        15000
      );

      setInterval(
        runScheduledDiscovery,
        discoveryMinutes *
          60 *
          1000
      );

    } else {
      console.log(
        "Automatic Walmart discovery disabled."
      );
    }
  }
);
