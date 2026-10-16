"use strict";

// Missing expiry must not make relative source predictions evergreen.
function currentDropReport(report, now = Date.now()) {
  const expiry = Date.parse(report.expiresAt);
  const reported = Date.parse(report.editedAt || report.reportedAt);
  const relative = /\btonight\b|\btomorrow\b|\btoday\b|\bthis (?:morning|afternoon|evening|weekend)\b/i.test(report.expectedWindow || "");
  const expired = Number.isFinite(expiry) ? expiry <= now : relative && now - reported >= 48 * 3600000;
  if (!expired) return report;
  const note = report.watchNote || "";
  return {...report, expectedWindow: !relative && note ? note : "Watch item · previous reported window passed. Next drop date and availability unconfirmed."};
}

module.exports = {currentDropReport};
