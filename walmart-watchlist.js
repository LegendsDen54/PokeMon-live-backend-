const products =
  require(
    "./products.json"
  );

/*
  Keep the existing module filename for
  compatibility. Its discovery state now
  contains ALL qualifying sealed Pokemon.
*/
const pokemonDiscovery =
  require(
    "./walmart-30th-discovery"
  );


/* ========================================
   WALMART SEARCH LINK
======================================== */

function walmartSearchUrl(
  term
) {

  return (
    "https://www.walmart.com/search?q=" +
    encodeURIComponent(
      term ||
      "Pokemon TCG"
    )
  );
}


/* ========================================
   ORIGINAL CONFIGURED WATCHLIST
======================================== */

function getConfiguredWatchlist() {

  return products

    .filter(
      product =>

        product.enabled !==
          false &&

        Array.isArray(
          product.retailers
        ) &&

        product
          .retailers
          .includes(
            "walmart"
          )
    )

    .map(
      product => ({

        retailer:
          "walmart",

        retailerLabel:
          "Walmart",

        productId:
          product.id,

        name:
          product.name,

        set:
          product.set ||
          null,

        productType:
          product.productType ||
          null,

        status:
          "watching",

        rawStatus:
          "Configured watchlist item",

        dropType:
          null,

        inStock:
          false,

        directSeller:
          false,

        approvedMarketplace:
          false,

        price:
          null,

        msrp:
          product.msrp ??
          null,

        seller:
          null,

        walmartItemId:
          product
            .walmartItemId ||
          null,

        image:
          null,

        url:
          product
            .walmartItemId

            ? `https://www.walmart.com/ip/${product.walmartItemId}`

            : walmartSearchUrl(
                product.searchTerm ||
                product.name
              ),

        checkedAt:
          null,

        source:
          "configured-watchlist",

        watchOnly:
          true,

        alertEligible:
          false
      })
    );
}


/* ========================================
   AUTO-DISCOVERED WATCHLIST
======================================== */

function getDynamicWatchlist() {

  const discoveryState =
    pokemonDiscovery
      .getState();

  const items =
    Array.isArray(
      discoveryState?.items
    )
      ? discoveryState.items
      : [];

  return items

    /*
      Safety check.

      Dynamic watchlist contains only:
      Walmart direct OR GT Collectibles.
    */
    .filter(
      item =>
        item
          .directSeller ===
          true ||

        item
          .approvedMarketplace ===
          true
    )

    .map(
      item => ({

        ...item,

        retailer:
          "walmart",

        retailerLabel:
          "Walmart",

        watchOnly:
          true,

        /*
          Auto-discovered MSRP is unknown
          until verified, therefore these
          remain non-alerting here.
        */
        alertEligible:
          false
      })
    );
}


/* ========================================
   DEDUPE WATCHLIST
======================================== */

function mergeWatchlistItems(
  configured,
  dynamic
) {

  const unique =
    new Map();

  const all = [
    ...configured,
    ...dynamic
  ];

  for (
    const item
    of all
  ) {

    /*
      Prefer Walmart item ID whenever
      available because titles can vary.
    */
    const key =
      item.walmartItemId

        ? `id:${String(
            item.walmartItemId
          )}`

        : `name:${String(
            item.name ||
            ""
          )
            .toLowerCase()
            .trim()}`;

    const existing =
      unique.get(
        key
      );

    if (
      !existing
    ) {

      unique.set(
        key,
        item
      );

      continue;
    }


    /*
      Merge useful configured metadata
      such as MSRP with live discovery
      metadata such as seller, price
      and image.
    */
    const existingConfigured =
      existing.source ===
      "configured-watchlist";

    const incomingConfigured =
      item.source ===
      "configured-watchlist";


    if (
      existingConfigured &&
      !incomingConfigured
    ) {

      unique.set(
        key,
        {
          ...existing,
          ...item,

          productId:
            existing.productId ||
            item.productId,

          msrp:
            existing.msrp ??
            item.msrp ??
            null
        }
      );

      continue;
    }


    if (
      !existingConfigured &&
      incomingConfigured
    ) {

      unique.set(
        key,
        {
          ...item,
          ...existing,

          productId:
            item.productId ||
            existing.productId,

          msrp:
            item.msrp ??
            existing.msrp ??
            null
        }
      );

      continue;
    }


    /*
      Same category: prefer Walmart-direct,
      then GT, then lower-priced duplicate.
    */
    if (
      item.directSeller ===
        true &&
      existing.directSeller !==
        true
    ) {

      unique.set(
        key,
        item
      );

      continue;
    }


    if (
      item
        .approvedMarketplace ===
        true &&

      existing.directSeller !==
        true &&

      existing
        .approvedMarketplace !==
        true
    ) {

      unique.set(
        key,
        item
      );

      continue;
    }


    if (
      item.price !==
        null &&
      item.price !==
        undefined &&
      (
        existing.price ===
          null ||
        existing.price ===
          undefined ||
        Number(
          item.price
        ) <
        Number(
          existing.price
        )
      )
    ) {

      unique.set(
        key,
        item
      );

    }

  }

  return Array.from(
    unique.values()
  );
}


/* ========================================
   UPCOMING + WATCHLIST
======================================== */

function mergeUpcomingWithWatchlist(
  upcoming = []
) {

  const detected =
    Array.isArray(
      upcoming
    )
      ? upcoming
      : [];


  const configured =
    getConfiguredWatchlist();


  const dynamic =
    getDynamicWatchlist();


  const watchlist =
    mergeWatchlistItems(
      configured,
      dynamic
    );


  const detectedIds =
    new Set(

      detected

        .flatMap(
          item => [
            item.productId,
            item.walmartItemId
          ]
        )

        .filter(
          Boolean
        )

        .map(
          String
        )
    );


  const detectedNames =
    new Set(

      detected

        .map(
          item =>
            String(
              item.name ||
              ""
            )
              .toLowerCase()
              .trim()
        )

        .filter(
          Boolean
        )
    );


  const watching =
    watchlist.filter(
      item => {

        if (
          item.productId &&
          detectedIds.has(
            String(
              item.productId
            )
          )
        ) {
          return false;
        }


        if (
          item.walmartItemId &&
          detectedIds.has(
            String(
              item.walmartItemId
            )
          )
        ) {
          return false;
        }


        if (
          detectedNames.has(
            String(
              item.name ||
              ""
            )
              .toLowerCase()
              .trim()
          )
        ) {
          return false;
        }


        return true;
      }
    );


  return {

    detected,

    watching,

    all: [
      ...detected,
      ...watching
    ],

    /*
      Useful diagnostics so we can verify
      that dynamic discovery is actually
      feeding the watchlist.
    */
    configuredCount:
      configured.length,

    dynamicCount:
      dynamic.length,

    walmartDirectDynamicCount:
      dynamic.filter(
        item =>
          item.directSeller ===
          true
      ).length,

    approvedMarketplaceDynamicCount:
      dynamic.filter(
        item =>
          item
            .approvedMarketplace ===
          true
      ).length
  };
}


/* ========================================
   EXPORTS
======================================== */

module.exports = {

  getConfiguredWatchlist,

  getDynamicWatchlist,

  mergeUpcomingWithWatchlist
};
