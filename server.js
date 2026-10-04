app.get("/api/products", (req, res) => {
  const retailer = req.query.retailer
    ? String(req.query.retailer).toLowerCase()
    : null;

  const allowed = new Set([
    "walmart",
    "target",
    "sams",
    "bestbuy",
    "costco"
  ]);

  if (
    retailer &&
    !allowed.has(retailer)
  ) {
    return res.status(400).json({
      ok: false,
      error: "Unsupported retailer"
    });
  }

  let items =
    multiStore.getProducts(retailer);

  /*
    Walmart discovery results now also feed
    the main product-card grid.

    This includes:
    - Walmart Direct
    - GT Collectibles and Toys

    Other marketplace sellers stay excluded.
  */
  if (
    retailer === "walmart" ||
    retailer === null
  ) {
    const discoveryState =
      walmart30thDiscovery.getState();

    const discovered =
      Array.isArray(
        discoveryState?.items
      )
        ? discoveryState.items
        : [];

    const qualifyingDiscoveryItems =
      discovered
        .filter(
          item =>
            item.directSeller === true ||
            item.approvedMarketplace === true
        )
        .map(
          item => ({
            ...item,

            retailer:
              "walmart",

            retailerLabel:
              "Walmart",

            channel:
              "online",

            storeName:
              null,

            storeId:
              null,

            quantity:
              null
          })
        );

    const combined =
      [
        ...items,
        ...qualifyingDiscoveryItems
      ];

    const unique =
      new Map();

    for (
      const item of combined
    ) {
      const key =
        item.walmartItemId
          ? `walmart:${String(item.walmartItemId)}`
          : item.productId
            ? `product:${String(item.productId)}`
            : item.url
              ? `url:${String(item.url)}`
              : `name:${String(item.name || "")
                  .toLowerCase()
                  .trim()}`;

      const existing =
        unique.get(key);

      if (!existing) {
        unique.set(
          key,
          item
        );

        continue;
      }

      /*
        Prefer the newer discovery version
        when it contains live seller/price/
        availability/image information.
      */
      const incomingHasLiveData =
        item.price != null ||
        item.image ||
        item.checkedAt ||
        item.directSeller === true ||
        item.approvedMarketplace === true;

      if (
        incomingHasLiveData
      ) {
        unique.set(
          key,
          {
            ...existing,
            ...item
          }
        );
      }
    }

    items =
      Array.from(
        unique.values()
      );
  }

  /*
    If a specific retailer was requested,
    keep the response retailer-isolated.
  */
  if (
    retailer
  ) {
    items =
      items.filter(
        item =>
          item.retailer === retailer
      );
  }

  res.json({
    ok: true,
    retailer,
    count: items.length,
    items
  });
});
