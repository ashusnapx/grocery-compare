# Probe captures — 2026-09-27

Raw responses from the reachability probe described in
[`../2026-09-27-platform-probe.md`](../2026-09-27-platform-probe.md). They are the
evidence behind that report and the starting fixtures for adapter parser tests.

- JSON bodies are minified. The BigBasket files are trimmed to the fields the adapter
  reads (id, desc, brand, `w`, pricing, availability, visibility, pack-size children);
  everything else, including `session_data`, was dropped.
- `requests.log` lists every request with status, size, timing, URL and tell-tale edge
  headers (`cf-mitigated`, `x-amzn-waf-action`, …). Cookie values are redacted.
- `req.sh` is the curl wrapper that made the requests. Its `ROOT` pointed at a scratch
  directory.
- Not kept: response headers, cookie jars, HTML pages and JS bundles.

| File | Request |
|---|---|
| `jiomart-delivery-promise-{560034,400053,110001}.json` | pincode → stores (`api.jiomartjcp.com/.../delivery-promise`) |
| `jiomart-search-toor-dal-store-{13845,3}.json` | search filtered to the Bengaluru / Mumbai grocery store |
| `dmart-pincode-560034.json` | pincode → `storeId` |
| `dmart-search-*-store-10744.json` | search with `storeId: 10744` |
| `dmart-search-toor-dal-no-store-header.json` | same search without `storeId` (default store — different prices) |
| `bigbasket-search-toor-dal.json` | guest-session search |
| `bigbasket-search-toor-dal-pincode-cookie-110001.json` | same, with `_bb_pin_code=110001` — identical prices |
| `bigbasket-search-amul-butter.json` | guest-session search |
| `zepto-store-by-latlng.json` | `api.zepto.co.in` layout → store id for 12.9352, 77.6245 |
| `instamart-select-location.json` | `select-location/v2` for 12.9797, 77.5947 |
