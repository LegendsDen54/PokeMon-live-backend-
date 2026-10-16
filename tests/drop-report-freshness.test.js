"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {currentDropReport} = require("../drop-report-freshness");
const now = Date.parse("2026-10-16T19:00:00Z");
test("old relative predictions without expiry become undated without changing source timing", () => {
  const report = {reportedAt:"2026-10-08T05:32:41Z", sourceUrl:"https://example.com/report", expectedWindow:"Tonight or tomorrow night", watchNote:"New report tonight", keepWatching:true};
  const result = currentDropReport(report, now);
  assert.match(result.expectedWindow, /previous reported window passed/);
  assert.equal(result.reportedAt, report.reportedAt);
  assert.equal(result.sourceUrl, report.sourceUrl);
  assert.equal(report.expectedWindow, "Tonight or tomorrow night");
});
test("fresh and explicitly future predictions remain intact", () => {
  for (const report of [{reportedAt:"2026-10-16T18:00:00Z",expectedWindow:"Tonight"},{reportedAt:"2026-10-08T05:00:00Z",expiresAt:"2026-10-17T05:00:00Z",expectedWindow:"Tomorrow"}]) assert.deepEqual(currentDropReport(report,now),report);
});
test("expired dated reports retain an undated watch note", () => {
  const report = {reportedAt:"2026-10-07T01:00:00Z",expiresAt:"2026-10-08T05:00:00Z",expectedWindow:"October 7",watchNote:"Future release · date unconfirmed"};
  assert.equal(currentDropReport(report,now).expectedWindow,report.watchNote);
});
