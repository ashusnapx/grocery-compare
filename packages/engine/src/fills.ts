/**
 * Pack fills: the cheapest way to buy *at least* what a row asks for on one
 * platform, from packs of a single product line — med-compare's
 * pack-rounding rule ("you cannot buy half a strip") extended to combinations
 * of pack sizes.
 */
import { normalizeText, phonetic, tokenize } from './text';
import type { Fill, Listing, Match, ParsedRow } from './types';

export interface FillOptions {
  /** Buying more than asked is capped at this multiple, unless nothing smaller exists. */
  overBuyCap?: number;
  /** Nominal packs a little under the amount count as meeting it (975 ml for 1 L). */
  underTolerance?: number;
  maxPacks?: number;
  maxFills?: number;
  pinnedListingId?: string;
}

const DEFAULTS = { overBuyCap: 1.25, underTolerance: 0.95, maxPacks: 12, maxFills: 3 };

const QTY_IN_TITLE =
  /\b\d+(?:\.\d+)?\s*(?:x\s*\d+(?:\.\d+)?\s*)?(?:kg|kgs|g|gm|gms|gram|grams|ml|l|ltr|ltrs|litre|litres|liter|liters|pcs|pc|pieces|piece|dozen|units?|packs?|pouch|bottle|jar)\b/gi;

/** Container words say how a size is packed, not which product it is. */
const CONTAINER_WORDS = new Set(['pack', 'packs', 'packet', 'pouch', 'bottle', 'jar', 'box', 'tin', 'can', 'of', 'x', 'combo']);

/** The product line: brand + title without sizes, so 1 kg and 5 kg of one atta group together. */
export function lineKey(l: Listing): string {
  const title = normalizeText(l.title.replace(QTY_IN_TITLE, ' ').replace(/\bpack of \d+\b/gi, ' ').replace(/\(.*?\)/g, ' '));
  const words = tokenize(`${l.brand ?? ''} ${title}`).filter((w) => !CONTAINER_WORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words.map(phonetic))].join(' ');
}

export function lineLabel(l: Listing): string {
  return l.title
    .replace(QTY_IN_TITLE, ' ')
    .replace(/\(\s*(?:approx(?:imately)?\.?|about|~)?[\s\-–—.,/]*\)/gi, ' ')
    .replace(/\s*[-|,:]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Pack {
  listing: Listing;
  size: number;
}

interface Combo {
  counts: number[];
  total: number;
  cost: number;
  packs: number;
}

function better(a: Combo, b: Combo | null): boolean {
  if (!b) return true;
  if (Math.abs(a.cost - b.cost) > 1e-9) return a.cost < b.cost;
  if (a.total !== b.total) return a.total < b.total;
  return a.packs < b.packs;
}

/** Cheapest combination with total in [lo, hi] and at most maxPacks packs. */
function searchCombos(packs: Pack[], lo: number, hi: number, maxPacks: number, rank: (a: Combo, b: Combo | null) => boolean): Combo | null {
  let best: Combo | null = null;
  const counts = new Array<number>(packs.length).fill(0);
  const rec = (i: number, total: number, cost: number, used: number) => {
    if (total >= lo && total <= hi) {
      const c = { counts: [...counts], total, cost, packs: used };
      if (rank(c, best)) best = c;
    }
    if (i === packs.length || used === maxPacks) return;
    const p = packs[i]!;
    for (let c = 0; used + c <= maxPacks; c++) {
      const t = total + c * p.size;
      if (c > 0 && t > hi) break;
      counts[i] = c;
      rec(i + 1, t, cost + c * p.listing.price, used + c);
    }
    counts[i] = 0;
  };
  rec(0, 0, 0, 0);
  return best;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toFill(row: ParsedRow, packs: Pack[], counts: number[], overBuy: boolean): Fill {
  const used = packs.map((p, i) => ({ p, count: counts[i]! })).filter((x) => x.count > 0);
  const first = used[0]!.p.listing;
  const quantity = used.reduce((s, x) => s + x.count * x.p.size, 0);
  return {
    itemId: row.id,
    platformId: first.platformId,
    packs: used.map((x) => ({
      listingId: x.p.listing.listingId,
      count: x.count,
      size: x.p.size,
      price: x.p.listing.price,
      title: x.p.listing.title,
    })),
    quantity: Math.round(quantity * 1000) / 1000,
    cost: round2(used.reduce((s, x) => s + x.count * x.p.listing.price, 0)),
    overBuy,
    label: lineLabel(first),
    packLabel: used.map((x) => (x.count > 1 ? `${x.count} × ${x.p.listing.quantityText.trim()}` : x.p.listing.quantityText.trim())).join(' + '),
    brand: first.brand,
    imageUrl: used.find((x) => x.p.listing.imageUrl)?.p.listing.imageUrl ?? null,
    productUrl: first.productUrl,
  };
}

/**
 * Best fill of one product line (null when the line cannot cover the row),
 * and its step-up: the cheapest bigger combination still within the over-buy
 * cap. A bigger pack can be the cheaper plan when it lifts an order past a
 * free-delivery or small-cart threshold; the optimizer decides.
 */
function fillLine(row: ParsedRow, packs: Pack[], o: Required<Omit<FillOptions, 'pinnedListingId'>>): { fill: Fill; stepUp: Fill | null } | null {
  const best = bestFill(row, packs, o);
  if (!best || best.overBuy || row.quantity.dim === 'pack') return best ? { fill: best, stepUp: null } : null;
  const sizes = distinctSizes(packs);
  const up = searchCombos(sizes, best.quantity + 1e-6, row.quantity.value * o.overBuyCap, o.maxPacks, better);
  const stepUp = up && up.cost > best.cost + 0.009 ? { ...toFill(row, sizes, up.counts, false), stepUp: true } : null;
  return { fill: best, stepUp };
}

/** One entry per distinct size, keeping the cheapest listing of each, largest first. */
function distinctSizes(packs: Pack[]): Pack[] {
  const bySize = new Map<number, Pack>();
  for (const p of packs) {
    const prev = bySize.get(p.size);
    if (!prev || p.listing.price < prev.listing.price) bySize.set(p.size, p);
  }
  return [...bySize.values()].sort((a, b) => b.size - a.size);
}

function bestFill(row: ParsedRow, packs: Pack[], o: Required<Omit<FillOptions, 'pinnedListingId'>>): Fill | null {
  const q = row.quantity.value;
  if (row.quantity.dim === 'pack') {
    // N packs of one listing: the cheapest pack in the line, N times.
    const cheapest = [...packs].sort((a, b) => a.listing.price - b.listing.price)[0];
    if (!cheapest) return null;
    const n = Math.max(1, Math.round(q));
    return toFill(row, [{ ...cheapest, size: 1 }], [n], false);
  }

  const sizes = distinctSizes(packs);
  if (!sizes.length) return null;

  const lo = q * o.underTolerance;
  const within = searchCombos(sizes, lo, q * o.overBuyCap, o.maxPacks, better);
  if (within) return toFill(row, sizes, within.counts, false);

  // Nothing fits under the cap: the smallest quantity that still covers the row.
  const maxSize = sizes[0]!.size;
  const smallest = searchCombos(sizes, lo, lo + maxSize, o.maxPacks, (a, b) =>
    !b || a.total < b.total || (a.total === b.total && better(a, b)),
  );
  return smallest ? toFill(row, sizes, smallest.counts, true) : null;
}

/**
 * Candidate fills for one row on one platform: the cheapest fill of each
 * product line (at most three), plus the step-ups of the two cheapest lines.
 */
export function buildFills(row: ParsedRow, matches: Match[], options: FillOptions = {}): Fill[] {
  const o = { ...DEFAULTS, ...options };
  let usable = matches.filter((m) => m.listing.inStock && m.packQuantity !== null && m.packQuantity > 0 && m.listing.price > 0);

  if (o.pinnedListingId) {
    const pinned = usable.find((m) => m.listing.listingId === o.pinnedListingId);
    if (!pinned) return [];
    const key = lineKey(pinned.listing);
    usable = usable.filter((m) => lineKey(m.listing) === key);
  } else {
    usable = usable.filter((m) => m.confidence === 'confident');
  }

  const lines = new Map<string, Pack[]>();
  for (const m of usable) {
    const key = lineKey(m.listing);
    const list = lines.get(key) ?? [];
    list.push({ listing: m.listing, size: m.packQuantity! });
    lines.set(key, list);
  }

  const found: { fill: Fill; stepUp: Fill | null }[] = [];
  for (const packs of lines.values()) {
    const f = fillLine(row, packs, o);
    if (f) found.push(f);
  }
  const top = found.sort((a, b) => a.fill.cost - b.fill.cost || Number(a.fill.overBuy) - Number(b.fill.overBuy)).slice(0, o.maxFills);
  const stepUps = top.slice(0, 2).flatMap((f) => (f.stepUp ? [f.stepUp] : []));
  return [...top.map((f) => f.fill), ...stepUps];
}

/**
 * Drops fills whose per-unit price is more than 10× (or under a tenth of) the
 * median across all apps for the row — almost always a parse or data error,
 * and a wrong price is worse than a missing one.
 */
export function dropPriceOutliers(fills: Fill[]): Fill[] {
  if (fills.length < 3) return fills;
  const unit = (f: Fill) => f.cost / f.quantity;
  const sorted = fills.map(unit).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return fills.filter((f) => unit(f) <= median * 10 && unit(f) >= median / 10);
}
