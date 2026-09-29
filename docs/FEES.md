# Fee catalog — monthly re-verification

Fees are the most volatile input in jhola: they change by city, dark store,
time of day, demand and even account. The catalog in
`packages/engine/src/catalog.ts` holds each platform's defaults with a source,
date and confidence for every number. Live hints from the platform's own
responses and the user's overrides sit on top of it.

## Monthly checklist

For each platform in `FEE_CATALOG`:

1. **Delivery fee and free-delivery threshold.** Check the app at a Bengaluru,
   Mumbai and Delhi location with a cart just under and just over the threshold.
2. **Small-cart fee** and the subtotal that triggers it.
3. **Handling / platform fee.**
4. **Minimum order** (can you check out below it?).
5. **Peak / late-night / rain variants** — amounts and windows if published.
6. **Memberships** in `MEMBERSHIPS` — price and exactly which fees they waive.
   Swiggy One is deliberately absent until its Instamart effect is confirmed.

Then:

- Update the rule, set `approximate` where the evidence is a user report, add
  the source (title, URL, date, `confirmed` | `uncertain`) and bump `checkedAt`.
- Run `npm test -w @gc/engine`: the catalog tests fail if any schedule's fee
  would rise with the order value (the optimizer relies on that never happening)
  or if a membership points at a rule that doesn't exist.

## Where the numbers came from

`docs/research/2026-09-27-fee-research.md` — the survey behind the first
catalog, with 37 dated sources.
