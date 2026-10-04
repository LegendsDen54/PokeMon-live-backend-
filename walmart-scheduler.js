const DAY_MAP = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6
};

function parseTime(value, fallback) {
  const match = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return parseTime(fallback, "19:50");
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return { hour, minute, total: hour * 60 + minute };
}

function getDayNumber(value) {
  const text = String(value || "WED").trim().toUpperCase().slice(0, 3);
  return DAY_MAP[text] ?? DAY_MAP.WED;
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(part => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: getDayNumber(parts.weekday),
    weekdayLabel: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function formatClock(totalMinutes) {
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function minutesUntilNextWindow(local, targetDay, startMinutes) {
  const currentMinutes = local.hour * 60 + local.minute;
  let daysAhead = (targetDay - local.weekday + 7) % 7;

  if (daysAhead === 0 && currentMinutes >= startMinutes) {
    daysAhead = 7;
  }

  return daysAhead * 24 * 60 + (startMinutes - currentMinutes);
}

function createWalmartScheduler({ runScan }) {
  if (typeof runScan !== "function") {
    throw new Error("Walmart scheduler requires runScan()");
  }

  const enabled =
    String(process.env.WALMART_SCHEDULE_ENABLED || "true").toLowerCase() === "true";

  const timeZone = process.env.WALMART_TIMEZONE || "America/Chicago";
  const dayText = String(process.env.WALMART_DROP_DAY || "WED").trim().toUpperCase();
  const dayNumber = getDayNumber(dayText);
  const start = parseTime(process.env.WALMART_DROP_START, "19:50");
  const end = parseTime(process.env.WALMART_DROP_END, "20:20");

  const everyMinutes = Math.max(
    5,
    Number(process.env.WALMART_DROP_EVERY_MINUTES || 10)
  );

  const manualCooldownSeconds = Math.max(
    30,
    Number(process.env.WALMART_MANUAL_COOLDOWN_SECONDS || 60)
  );

  let timer = null;
  let schedulerRunning = false;
  let lastScheduledSlot = null;
  let lastScheduledRun = null;
  let lastManualRun = null;
  let lastWakeRun = null;
  let lastResult = null;
  let lastError = null;

  function computeStatus() {
    const now = new Date();
    const local = zonedParts(now, timeZone);
    const minuteOfDay = local.hour * 60 + local.minute;
    const activeWindow =
      enabled &&
      local.weekday === dayNumber &&
      minuteOfDay >= start.total &&
      minuteOfDay <= end.total;

    let nextScanLabel = null;

    if (enabled) {
      if (activeWindow) {
        const elapsed = minuteOfDay - start.total;
        const nextSlot = Math.ceil(elapsed / everyMinutes);
        const nextMinutes = start.total + nextSlot * everyMinutes;
        nextScanLabel = nextMinutes <= end.total
          ? `Today ${formatClock(nextMinutes)} ${timeZone}`
          : `Next ${dayText} ${formatClock(start.total)} ${timeZone}`;
      } else {
        const mins = minutesUntilNextWindow(local, dayNumber, start.total);
        if (mins >= 0 && mins < 24 * 60) {
          nextScanLabel = `Today ${formatClock(start.total)} ${timeZone}`;
        } else {
          nextScanLabel = `Next ${dayText} ${formatClock(start.total)} ${timeZone}`;
        }
      }
    }

    return {
      enabled,
      timeZone,
      day: dayText,
      start: `${String(start.hour).padStart(2, "0")}:${String(start.minute).padStart(2, "0")}`,
      end: `${String(end.hour).padStart(2, "0")}:${String(end.minute).padStart(2, "0")}`,
      everyMinutes,
      activeWindow,
      running: schedulerRunning,
      localNow: `${local.weekdayLabel} ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}:${String(local.second).padStart(2, "0")}`,
      scheduleLabel: `${dayText} ${formatClock(start.total)}-${formatClock(end.total)} ${timeZone}`,
      nextScanLabel,
      lastScheduledRun,
      lastManualRun,
      lastWakeRun,
      lastResult,
      lastError
    };
  }

  async function execute(kind) {
    if (schedulerRunning) {
      return {
        ok: false,
        skipped: true,
        reason: "Walmart scan already running"
      };
    }

    schedulerRunning = true;
    lastError = null;

    try {
      const result = await runScan();
      lastResult = result;

      if (kind === "scheduled") lastScheduledRun = new Date().toISOString();
      if (kind === "manual") lastManualRun = new Date().toISOString();
      if (kind === "wake") lastWakeRun = new Date().toISOString();

      return result;
    } catch (error) {
      lastError = error.message;
      throw error;
    } finally {
      schedulerRunning = false;
    }
  }

  async function tick(kind = "scheduled") {
    if (!enabled) {
      return { ok: false, skipped: true, reason: "Walmart schedule disabled" };
    }

    const now = new Date();
    const local = zonedParts(now, timeZone);
    const minuteOfDay = local.hour * 60 + local.minute;

    if (
      local.weekday !== dayNumber ||
      minuteOfDay < start.total ||
      minuteOfDay > end.total
    ) {
      return { ok: false, skipped: true, reason: "Outside Walmart drop window" };
    }

    const slot = Math.floor((minuteOfDay - start.total) / everyMinutes);
    const slotKey = `${local.dateKey}:${slot}`;

    if (slotKey === lastScheduledSlot) {
      return { ok: false, skipped: true, reason: "Scheduled slot already scanned" };
    }

    if (schedulerRunning) {
      return { ok: false, skipped: true, reason: "Walmart scan already running" };
    }

    lastScheduledSlot = slotKey;

    console.log("Walmart drop-window scan triggered:", {
      trigger: kind,
      timeZone,
      localTime: `${local.hour}:${String(local.minute).padStart(2, "0")}`,
      slot
    });

    try {
      return await execute(kind === "wake" ? "wake" : "scheduled");
    } catch (error) {
      console.error("Walmart drop-window scan failed:", error);
      return { ok: false, error: error.message };
    }
  }

  async function manualScan() {
    if (lastManualRun) {
      const elapsed = Date.now() - new Date(lastManualRun).getTime();
      const cooldownMs = manualCooldownSeconds * 1000;

      if (elapsed < cooldownMs) {
        return {
          ok: false,
          skipped: true,
          reason: "Manual scan cooldown active",
          retryAfterSeconds: Math.ceil((cooldownMs - elapsed) / 1000)
        };
      }
    }

    return execute("manual");
  }

  async function wakeScan() {
    return tick("wake");
  }

  function startScheduler() {
    if (timer || !enabled) return computeStatus();

    timer = setInterval(() => {
      tick("scheduled").catch(error => {
        console.error("Walmart scheduler tick failed:", error);
      });
    }, 20000);

    setTimeout(() => {
      tick("scheduled").catch(error => {
        console.error("Initial Walmart scheduler tick failed:", error);
      });
    }, 3000);

    return computeStatus();
  }

  return {
    start: startScheduler,
    tick,
    wakeScan,
    manualScan,
    getStatus: computeStatus
  };
}

module.exports = {
  createWalmartScheduler
};
