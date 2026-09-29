import {
  buildFills,
  catalogSchedule,
  dropPriceOutliers,
  matchListing,
  resolveSchedule,
  type FeeHints,
  type Fill,
  type Listing,
  type Match,
  type ParsedRow,
  type PlanSettings,
  type PlatformId,
} from '@gc/engine';
import type { PlatformSpec } from '@gc/engine/optimize';
import type { PossibleMatch, RowResult } from '@/lib/compare-types';

function dedupe(listings: Listing[]): Listing[] {
  const seen = new Set<string>();
  return listings.filter((l) => !seen.has(l.listingId) && seen.add(l.listingId));
}

function matchAll(row: ParsedRow, listings: Listing[]): Match[] {
  return listings.map((l) => matchListing(row, l)).filter((m): m is Match => m !== null);
}

/**
 * Everything one platform can offer for one row: fills that respect the
 * brand lock and pins, fills if any brand were allowed (for nudges), and the
 * borderline listings the user may want to accept.
 */
export function rowResult(
  row: ParsedRow,
  unlocked: ParsedRow,
  platformId: PlatformId,
  listings: Listing[],
  unlockedListings: Listing[],
  pinnedListingId: string | undefined,
  status: RowResult['status'],
): RowResult {
  const all = dedupe([...listings, ...unlockedListings]);
  const matches = matchAll(row, all);
  const fills = buildFills(row, matches, { pinnedListingId });

  const unlockedFills = row.brandLocked ? buildFills(unlocked, matchAll(unlocked, all)) : [];

  const possible: PossibleMatch[] = matches
    .filter((m) => m.confidence === 'possible' && m.listing.inStock)
    .sort((a, b) => a.listing.price - b.listing.price)
    .slice(0, 6)
    .map((m) => ({
      listingId: m.listing.listingId,
      title: m.listing.title,
      quantityText: m.listing.quantityText,
      price: m.listing.price,
      imageUrl: m.listing.imageUrl,
      productUrl: m.listing.productUrl,
      reason: m.reason,
    }));

  return { status: fills.length ? 'ok' : status === 'ok' ? 'no_results' : status, fills, unlockedFills, possible, seen: all.length };
}

/** Drops per-unit price outliers per row across every platform (spec, "Failure handling"). */
export function sanitize(fills: Fill[]): Fill[] {
  const byRow = new Map<string, Fill[]>();
  for (const f of fills) byRow.set(f.itemId, [...(byRow.get(f.itemId) ?? []), f]);
  return [...byRow.values()].flatMap(dropPriceOutliers);
}

export function platformSpecs(
  platforms: { platformId: PlatformId; eta: string | null; feeHints?: FeeHints }[],
  settings: PlanSettings,
  now = new Date(),
): PlatformSpec[] {
  return platforms
    .filter((p) => !settings.excluded.includes(p.platformId))
    .map((p) => ({
      id: p.platformId,
      eta: p.eta,
      schedule: resolveSchedule(catalogSchedule(p.platformId), {
        memberships: settings.memberships,
        hints: p.feeHints,
        overrides: settings.overrides,
        now,
      }),
    }));
}
