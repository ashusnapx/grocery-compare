/**
 * Live suggestions while typing: real products from the apps, grouped so the
 * same brand + product + size from several apps is one card with every app's
 * price. Picking a card becomes a brand-locked row of that exact size.
 */
import { findItem, ITEM_BY_KEY } from './dictionary';
import { lineLabel } from './fills';
import { matchListing } from './match';
import { formatQuantity, parseQuantityText } from './quantity';
import { phonetic, tokenize } from './text';
import type { Dim, ListRow, Listing, ParsedRow, PlatformId, Unit } from './types';

export interface ProductOffer {
  platformId: PlatformId;
  listingId: string;
  price: number;
  mrp: number | null;
  productUrl: string;
}

/** The cheapest offer spread over the pack: "₹48.80 per kg", "₹100 per pc". */
export interface UnitPrice {
  amount: number;
  per: 'kg' | '100 g' | 'L' | '100 ml' | 'pc' | 'pack';
}

export interface ProductGroup {
  key: string;
  title: string;
  brand: string | null;
  itemKey: string | null;
  size: string | null;
  quantity: { value: number; dim: Dim } | null;
  imageUrl: string | null;
  /** Cheapest first. */
  offers: ProductOffer[];
  /** One unit per kind of quantity across the whole list, so rows compare at a glance. */
  unitPrice: UnitPrice | null;
  /** Lowest unit price among the products that are what was typed. */
  bestValue: boolean;
}

function brandKey(brand: string | null): string {
  return brand ? tokenize(brand).map(phonetic).join(' ') : '';
}

function displayBrand(brands: (string | null)[]): string | null {
  const named = brands.filter((b): b is string => !!b && b.trim().length > 0);
  const cased = named.find((b) => b !== b.toLowerCase());
  const pick = cased ?? named[0];
  return pick ? pick.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

/** What the user typed, to rank the products that really are it first. `sized` = a size was typed. */
export interface TypedRow {
  row: ParsedRow;
  sized: boolean;
}

/** The right kind of product (and the named brand) counts most, then the typed size. */
function fitOf(typed: TypedRow, l: Listing, quantity: ProductGroup['quantity']): number {
  const m = matchListing(typed.row, l);
  const kind = m ? (m.confidence === 'confident' ? 4 : 2) : 0;
  const want = typed.row.quantity;
  const size = typed.sized && quantity?.dim === want.dim && quantity.value === want.value ? 1 : 0;
  return kind + size;
}

/**
 * Groups listings into products. With `typed`, products that are what was
 * typed come first ("amul butter": Amul's butter before other brands and
 * before Amul butter cookies); otherwise, and within equal fit, the apps'
 * own order.
 */
export function groupProducts(listings: Listing[], limit = 10, typed?: TypedRow): ProductGroup[] {
  const rankInPlatform = new Map<Listing, number>();
  const seenPerPlatform = new Map<PlatformId, number>();
  for (const l of listings) {
    const r = seenPerPlatform.get(l.platformId) ?? 0;
    rankInPlatform.set(l, r);
    seenPerPlatform.set(l.platformId, r + 1);
  }

  const groups = new Map<string, { members: Listing[]; rank: number; fit: number; itemKey: string | null; quantity: ProductGroup['quantity'] }>();
  for (const l of listings) {
    if (!(l.price > 0)) continue;
    const outside = l.title.replace(/\([^)]*\)/g, ' ');
    const itemKey = findItem(tokenize(outside).map(phonetic))?.value.key ?? null;
    const pack = parseQuantityText(l.quantityText);
    const quantity = pack ? { value: Math.round(pack.value), dim: pack.dim } : null;
    const what = itemKey ?? tokenize(lineLabel(l)).map(phonetic).sort().join(' ');
    const size = quantity ? `${quantity.value}${quantity.dim}` : tokenize(l.quantityText).join(' ');
    const key = `${brandKey(l.brand)}|${what}|${size}`;
    const g = groups.get(key) ?? { members: [], rank: Number.POSITIVE_INFINITY, fit: 0, itemKey, quantity };
    g.members.push(l);
    g.rank = Math.min(g.rank, rankInPlatform.get(l) ?? 99);
    if (typed) g.fit = Math.max(g.fit, fitOf(typed, l, quantity));
    groups.set(key, g);
  }

  const ranked = [...groups.entries()]
    .sort(([, a], [, b]) => b.fit - a.fit || a.rank - b.rank || b.members.length - a.members.length)
    .slice(0, limit);
  const products = ranked.map(([key, g]): ProductGroup => {
      const offers = new Map<PlatformId, ProductOffer>();
      for (const m of g.members) {
        const prev = offers.get(m.platformId);
        if (!prev || m.price < prev.price) {
          offers.set(m.platformId, { platformId: m.platformId, listingId: m.listingId, price: m.price, mrp: m.mrp, productUrl: m.productUrl });
        }
      }
      const titles = g.members.map(lineLabel).filter(Boolean);
      return {
        key,
        title: titles.sort((a, b) => a.length - b.length)[0] ?? g.members[0]!.title,
        brand: displayBrand(g.members.map((m) => m.brand)),
        itemKey: g.itemKey,
        size: g.quantity ? formatQuantity(g.quantity) : g.members[0]!.quantityText || null,
        quantity: g.quantity,
        imageUrl: g.members.find((m) => m.imageUrl)?.imageUrl ?? null,
        offers: [...offers.values()].sort((a, b) => a.price - b.price),
        unitPrice: null,
        bestValue: false,
      };
    });
  priceUnits(products);
  if (typed) markBestValue(products.filter((_, i) => ranked[i]![1].fit >= 2));
  return products;
}

/**
 * Unit prices, one unit per kind of quantity for the whole list: per kg / L
 * once any pack reaches 1 kg / 1 L, else per 100 g / 100 ml; per piece; per
 * pack when there are several.
 */
function priceUnits(products: ProductGroup[]): void {
  const biggest = new Map<Dim, number>();
  for (const p of products) if (p.quantity) biggest.set(p.quantity.dim, Math.max(biggest.get(p.quantity.dim) ?? 0, p.quantity.value));
  for (const p of products) {
    const q = p.quantity;
    const price = p.offers[0]?.price;
    if (!q || !(q.value > 0) || !price || (q.dim === 'pack' && q.value === 1)) continue;
    const big = (biggest.get(q.dim) ?? 0) >= 1000;
    const [per, size]: [UnitPrice['per'], number] =
      q.dim === 'mass' ? (big ? ['kg', 1000] : ['100 g', 100])
      : q.dim === 'volume' ? (big ? ['L', 1000] : ['100 ml', 100])
      : q.dim === 'count' ? ['pc', 1]
      : ['pack', 1];
    p.unitPrice = { amount: Math.round((price / q.value) * size * 100) / 100, per };
  }
}

/** Among products of the typed item sharing a unit, the lowest unit price (the higher-ranked on a tie). */
function markBestValue(matches: ProductGroup[]): void {
  const byUnit = new Map<string, ProductGroup[]>();
  for (const p of matches) if (p.unitPrice) byUnit.set(p.unitPrice.per, [...(byUnit.get(p.unitPrice.per) ?? []), p]);
  for (const same of byUnit.values()) {
    if (same.length < 2) continue;
    const best = same.reduce((a, b) => (b.unitPrice!.amount < a.unitPrice!.amount ? b : a));
    if (same.some((p) => p !== best && p.unitPrice!.amount > best.unitPrice!.amount)) best.bestValue = true;
  }
}

function amountOf(q: ProductGroup['quantity']): { amount: number; unit: Unit } {
  if (!q) return { amount: 1, unit: 'pack' };
  switch (q.dim) {
    case 'mass':
      return q.value >= 1000 && q.value % 1000 === 0 ? { amount: q.value / 1000, unit: 'kg' } : { amount: q.value, unit: 'g' };
    case 'volume':
      return q.value >= 1000 && q.value % 1000 === 0 ? { amount: q.value / 1000, unit: 'L' } : { amount: q.value, unit: 'ml' };
    case 'count':
      return { amount: q.value, unit: 'pcs' };
    case 'pack':
      return { amount: q.value, unit: 'pack' };
  }
}

/** A picked product as a list row: its brand locked, its size, pinned to the exact listing on each app it came from. */
export function productToRow(g: ProductGroup): Omit<ListRow, 'id'> {
  const item = g.itemKey ? ITEM_BY_KEY[g.itemKey] : undefined;
  const text = item && g.brand ? `${g.brand} ${item.key}` : g.title;
  return {
    text,
    ...amountOf(g.quantity),
    anyBrand: false,
    pins: Object.fromEntries(g.offers.map((o) => [o.platformId, o.listingId])),
  };
}
