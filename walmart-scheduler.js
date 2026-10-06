/*
  ========================================
  WALMART CONTINUOUS SCANNER
  ========================================

  Runs throughout the entire week instead of
  only during the old Wednesday drop window.

  Default:
  - enabled
  - every 5 minutes
  - America/Chicago

  Can be changed in Render with:
  WALMART_SCAN_EVERY_MINUTES
*/

function createWalmartScheduler({
  runScan
}) {
  if (
    typeof runScan !==
    "function"
  ) {
    throw new Error(
      "Walmart scheduler requires runScan()"
    );
  }

  const enabled =
    String(
      process.env
        .WALMART_SCHEDULE_ENABLED ||
      "true"
    ).toLowerCase() ===
    "true";

  const timeZone =
    process.env
      .WALMART_TIMEZONE ||
    "America/Chicago";

  const everyMinutes =
    Math.max(
      5,
      Number(
        process.env
          .WALMART_SCAN_EVERY_MINUTES ||
      5
      )
    );

  const manualCooldownSeconds =
    Math.max(
      30,
      Number(
        process.env
          .WALMART_MANUAL_COOLDOWN_SECONDS ||
        60
      )
    );

  let timer =
    null;

  let schedulerRunning =
    false;

  let lastScheduledSlot =
    null;

  let lastScheduledRun =
    null;

  let lastManualRun =
    null;

  let lastWakeRun =
    null;

  let lastResult =
    null;

  let lastError =
    null;


  /* ========================================
     LOCAL TIME
  ======================================== */

  function localTimeString() {
    try {
      return new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone,

          weekday:
            "short",

          year:
            "numeric",

          month:
            "2-digit",

          day:
            "2-digit",

          hour:
            "2-digit",

          minute:
            "2-digit",

          second:
            "2-digit",

          hour12:
            false
        }
      ).format(
        new Date()
      );

    } catch {
      return new Date()
        .toISOString();
    }
  }


  /* ========================================
     NEXT SCAN
  ======================================== */

  function nextScanDate() {
    const now =
      Date.now();

    const intervalMs =
      everyMinutes *
      60 *
      1000;

    const next =
      Math.ceil(
        now /
        intervalMs
      ) *
      intervalMs;

    return new Date(
      next
    );
  }


  /* ========================================
     STATUS
  ======================================== */

  function computeStatus() {
    const next =
      nextScanDate();

    return {
      enabled,

      mode:
        "continuous",

      timeZone,

      /*
        Keep the old fields so existing UI /
        status code does not break.
      */
      day:
        "ALL",

      start:
        "00:00",

      end:
        "23:59",

      everyMinutes,

      activeWindow:
        enabled,

      running:
        schedulerRunning,

      localNow:
        localTimeString(),

      scheduleLabel:
        `Every ${everyMinutes} minutes, 7 days/week`,

      nextScanLabel:
        enabled
          ? `${next.toISOString()}`
          : null,

      lastScheduledRun,

      lastManualRun,

      lastWakeRun,

      lastResult,

      lastError
    };
  }


  /* ========================================
     EXECUTE
  ======================================== */

  async function execute(kind) {
    if (
      schedulerRunning
    ) {
      return {
        ok:
          false,

        skipped:
          true,

        reason:
          "Walmart scan already running"
      };
    }

    schedulerRunning =
      true;

    lastError =
      null;

    try {
      const result =
        await runScan();

      lastResult =
        result;

      const now =
        new Date()
          .toISOString();

      if (
        kind ===
        "scheduled"
      ) {
        lastScheduledRun =
          now;
      }

      if (
        kind ===
        "manual"
      ) {
        lastManualRun =
          now;
      }

      if (
        kind ===
        "wake"
      ) {
        lastWakeRun =
          now;
      }

      return result;

    } catch (error) {
      lastError =
        error?.message ||
        String(error);

      throw error;

    } finally {
      schedulerRunning =
        false;
    }
  }


  /* ========================================
     AUTOMATIC TICK
  ======================================== */

  async function tick(
    kind = "scheduled"
  ) {
    if (!enabled) {
      return {
        ok:
          false,

        skipped:
          true,

        reason:
          "Walmart schedule disabled"
      };
    }

    if (
      schedulerRunning
    ) {
      return {
        ok:
          false,

        skipped:
          true,

        reason:
          "Walmart scan already running"
      };
    }

    const intervalMs =
      everyMinutes *
      60 *
      1000;

    const slot =
      Math.floor(
        Date.now() /
        intervalMs
      );

    const slotKey =
      String(slot);

    if (
      kind ===
        "scheduled" &&
      slotKey ===
        lastScheduledSlot
    ) {
      return {
        ok:
          false,

        skipped:
          true,

        reason:
          "Scheduled slot already scanned"
      };
    }

    if (
      kind ===
      "scheduled"
    ) {
      lastScheduledSlot =
        slotKey;
    }

    console.log(
      "Walmart continuous scan triggered:",
      {
        trigger:
          kind,

        everyMinutes,

        timeZone,

        localTime:
          localTimeString()
      }
    );

    try {
      return await execute(
        kind ===
          "wake"
          ? "wake"
          : "scheduled"
      );

    } catch (error) {
      console.error(
        "Walmart continuous scan failed:",
        error
      );

      return {
        ok:
          false,

        error:
          error?.message ||
          String(error)
      };
    }
  }


  /* ========================================
     MANUAL SCAN
  ======================================== */

  async function manualScan() {
    if (
      lastManualRun
    ) {
      const elapsed =
        Date.now() -
        new Date(
          lastManualRun
        ).getTime();

      const cooldownMs =
        manualCooldownSeconds *
        1000;

      if (
        elapsed <
        cooldownMs
      ) {
        return {
          ok:
            false,

          skipped:
            true,

          reason:
            "Manual scan cooldown active",

          retryAfterSeconds:
            Math.ceil(
              (
                cooldownMs -
                elapsed
              ) /
              1000
            )
        };
      }
    }

    return execute(
      "manual"
    );
  }


  /* ========================================
     WAKE SCAN

     Unlike the old scheduler, a wake request
     is no longer restricted to Wednesday.
  ======================================== */

  async function wakeScan() {
    if (!enabled) {
      return {
        ok:
          false,

        skipped:
          true,

        reason:
          "Walmart schedule disabled"
      };
    }

    return execute(
      "wake"
    );
  }


  /* ========================================
     START
  ======================================== */

  function startScheduler() {
    if (
      timer ||
      !enabled
    ) {
      return computeStatus();
    }

    /*
      Check every 20 seconds for a new scan
      slot. Only one run is allowed per slot.
    */
    timer =
      setInterval(
        () => {
          tick(
            "scheduled"
          ).catch(
            error => {
              console.error(
                "Walmart scheduler tick failed:",
                error
              );
            }
          );
        },

        20000
      );

    /*
      Start one scan shortly after Render boots
      instead of waiting up to 5 minutes.
    */
    setTimeout(
      () => {
        tick(
          "scheduled"
        ).catch(
          error => {
            console.error(
              "Initial Walmart scheduler tick failed:",
              error
            );
          }
        );
      },

      3000
    );

    return computeStatus();
  }


  return {
    start:
      startScheduler,

    tick,

    wakeScan,

    manualScan,

    getStatus:
      computeStatus
  };
}


module.exports = {
  createWalmartScheduler
};
