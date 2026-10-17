# Manual checker result fidelity

Save the actual matching Rip Radar / stock-checker response with the private inventory report. Preserve its original timestamp and message permalink. Do not replace an old report's date with the time it was read.

The existing `locations` array retains name, address, exact numeric onHand/onOrder/inTransit, distanceMiles and status. Unknown quantities remain null, never zero. Preserve all matching rows and source ordering.

Additional supported fields:

- `sourceText`: the complete visible checker response, including all result pages, headings, reported dates, quantities, member/uploaded-data notes and limitations. Copy actual response text only; do not include surrounding chat or credentials. Keep line breaks. Never reconstruct missing original text from a summary.
- `sourceFields`: an ordered array of `{name, value}` strings for additional report fields exactly as labeled by the checker (radius, filters, source date, prices, totals and notes).
- `locations[].sourceFields`: the same array for additional per-location fields (store number, reported time, phone, price, raw quantity text such as `100+`, etc.). Only include fields actually supplied.
- `detail`: collector explanation, separate from the verbatim source response.

When a response covers several products, retain its complete original response but normalize location rows only for the requested exact product. Read every result page before claiming complete coverage. Do not bypass checker cooldowns to fill missing data.

Limits reject an oversized report explicitly instead of silently truncating it: 1,000 locations, 60,000 source-text characters, 12,000 detail characters, 100 additional fields per report/location. Existing authentication and private requesting-device access still apply. Old saved reports show their retained fields and clearly say when original text was not captured.
