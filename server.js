/* ========================================
   WALMART MARKETPLACE / AVAILABLE OFFERS
   Shows Walmart + third-party listings.
   Sorted lowest price -> highest price.

   IMPORTANT:
   This endpoint is DISPLAY ONLY.
   It does NOT trigger push alerts.
======================================== */

app.get(
  "/api/marketplace",
  async (req, res) => {
    try {
      const requestedProductId =
        req.query.productId || null;

      /*
        If productId is supplied, search only
        that product. Otherwise search the
        entire curated Walmart catalog.
      */
      let catalog =
        products.filter(
          product =>
            product.enabled !== false &&
            Array.isArray(
              product.retailers
            ) &&
            product.retailers.includes(
              "walmart"
            )
        );

      if (requestedProductId) {
        catalog =
          catalog.filter(
            product =>
              product.id ===
              requestedProductId
          );

        if (!catalog.length) {
          return res
            .status(404)
            .json({
              ok: false,
              error:
                "Product not found",
              productId:
                requestedProductId
            });
        }
      }

      const offers = [];

      const errors = [];

      /*
        Search sequentially so we don't hammer
        the Walmart/RapidAPI endpoint with
        every product simultaneously.
      */
      for (const product of catalog) {
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

              /*
                Marketplace listings are NEVER
                made alert-eligible here.
                This is dashboard data only.
              */
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

      /*
        Remove duplicate offers.

        Walmart searches can return the same
        item for multiple related keywords.
      */
      const uniqueOffers =
        new Map();

      for (const offer of offers) {
        const key =
          offer.walmartItemId
            ? String(
                offer.walmartItemId
              )
            : [
                offer.name,
                offer.seller,
                offer.price
              ].join("|");

        const existing =
          uniqueOffers.get(key);

        /*
          If we somehow see the same Walmart
          item more than once, keep the
          cheapest version.
        */
        if (
          !existing ||
          Number(offer.price) <
            Number(existing.price)
        ) {
          uniqueOffers.set(
            key,
            offer
          );
        }
      }

      const sorted =
        Array.from(
          uniqueOffers.values()
        )
          .filter(
            offer =>
              offer.price !== null
          )
          .sort(
            (a, b) =>
              Number(a.price) -
              Number(b.price)
          );

      const available =
        sorted.filter(
          offer =>
            offer.offerAvailable === true
        );

      const walmartDirect =
        available.filter(
          offer =>
            offer.directSeller === true
        );

      const marketplace =
        available.filter(
          offer =>
            offer.directSeller !== true
        );

      return res.json({
        ok: true,

        generatedAt:
          new Date().toISOString(),

        sort:
          "price-low-to-high",

        searchedProducts:
          catalog.length,

        availableCount:
          available.length,

        walmartDirectCount:
          walmartDirect.length,

        marketplaceCount:
          marketplace.length,

        failedSearches:
          errors.length,

        /*
          Main dashboard list.
          Cheapest available product first.
        */
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

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);
