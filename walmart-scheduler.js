/*
  ========================================
  WALMART CONTINUOUS SCANNER
  ========================================

  Runs during the configured local drop window.

  Default:
  - enabled
  - Wednesdays, 8 AM–11 PM
  - America/Chicago

  Can be changed in Render with:
  WALMART_SCAN_EVERY_MINUTES
  WALMART_SCHEDULE_DAY
  WALMART_SCHEDULE_START
  WALMART_SCHEDULE_END
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

  const scheduleDay =
    String(
      process.env.WALMART_SCHEDULE_DAY ||
      "WED"
    )
      .trim()
      .toUpperCase();

  const scheduleStart =
    String(
      process.env.WALMART_SCHEDULE_START ||
      "08:00"
    ).trim();

  const scheduleEnd =
    String(
      process.env.WALMART_SCHEDULE_END ||
      "23:00"
    ).trim();

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

  function localParts() {
    const parts = new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }
    ).formatToParts(new Date());

    return Object.fromEntries(
      parts
        .filter(part => part.type !== "literal")
        .map(part => [part.type, part.value])
    );
  }

  function minutesFromTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function activeWindow() {
    const parts = localParts();
    const allowedDays = scheduleDay === "ALL"
      ? null
      : scheduleDay.split(",").map(day => day.trim()).filter(Boolean);
    const current = Number(parts.hour) * 60 + Number(parts.minute);
    const start = minutesFromTime(scheduleStart);
    const end = minutesFromTime(scheduleEnd);

    if (start == null || end == null || current < start || current > end) {
      return false;
    }

    return !allowedDays || allowedDays.includes(String(parts.weekday || "").toUpperCase());
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
        "scheduled_window",

      timeZone,

      /*
        Keep the old fields so existing UI /
        status code does not break.
      */
      day:
        scheduleDay,

      start:
        scheduleStart,

      end:
        scheduleEnd,

      everyMinutes,

      activeWindow:
        enabled && activeWindow(),

      running:
        schedulerRunning,

      localNow:
        localTimeString(),

      scheduleLabel:
        `${scheduleDay === "WED" ? "Wednesday" : scheduleDay} ${scheduleStart}–${scheduleEnd}, every ${everyMinutes} minutes`,

      nextScanLabel:
        enabled && activeWindow()
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

    if (kind === "scheduled" && !activeWindow()) {
      return {
        ok: false,
        skipped: true,
        reason: "Outside the Walmart scheduled scan window"
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
      "Walmart scheduled scan triggered:",
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
