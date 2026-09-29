import { describe, expect, it } from 'vitest';
import { buildFills, dropPriceOutliers, lineLabel } from './fills';
import { matchListing } from './match';
import { parseRow } from './rows';
import type { Fill, ListRow, Listing, Match } from './types';

const row = (text: string, amount: number, unit: ListRow['unit']) => parseRow({ id: 'r', text, amount, unit, anyBrand: true });

let n = 0;
const listing = (title: string, quantityText: string, price: number, extra: Partial<Listing> = {}): Listing => ({
  platformId: 'blinkit',
  listingId: `l${n++}`,
  title,
  brand: null,
  quantityText,
  price,
  mrp: null,
  inStock: true,
  productUrl: `https://example.com/${n}`,
  imageUrl: null,
  category: null,
  fetchedAt: '2026-09-27T10:00:00Z',
  ...extra,
});

function matches(r: ReturnType<typeof row>, ls: Listing[]): Match[] {
  return ls.map((l) => matchListing(r, l)).filter((m): m is Match => m !== null);
}

describe('buildFills', () => {
  const atta = row('aashirvaad atta', 5, 'kg');
  const one = listing('Aashirvaad Shudh Chakki Atta', '1 kg', 60);
  const five = listing('Aashirvaad Shudh Chakki Atta', '5 kg', 262);
  const ten = listing('Aashirvaad Shudh Chakki Atta', '10 kg', 510);

  it('picks the cheapest pack combination that covers the quantity', () => {
    const [best] = buildFills(atta, matches(atta, [one, five, ten]));
    expect(best).toMatchObject({ cost: 262, quantity: 5000, overBuy: false, packLabel: '5 kg' });
  });

  it('combines smaller packs when the right size is out of stock', () => {
    const oos = { ...five, inStock: false };
    const [best] = buildFills(atta, matches(atta, [one, oos, ten]));
    expect(best).toMatchObject({ cost: 300, quantity: 5000, packLabel: '5 × 1 kg' });
  });

  it('offers one fill per product line, cheapest first, at most three', () => {
    const onion = row('onion', 1, 'kg');
    const fills = buildFills(
      onion,
      matches(onion, [
        listing('Onion (Pyaz)', '500 g', 30),
        listing('Organic Onion', '1 kg', 80),
        listing('Fresho Onion', '1 kg', 55),
        listing('Onion - Big', '1 kg', 70),
      ]),
    );
    expect(fills.map((f) => f.cost)).toEqual([55, 60, 70]);
    expect(fills[1]?.packLabel).toBe('2 × 500 g');
  });

  it('accepts a nominal pack a little under the amount (975 ml for 1 L)', () => {
    const r = row('floor cleaner', 1, 'L');
    const [best] = buildFills(r, matches(r, [listing('Lizol Disinfectant Floor Cleaner', '975 ml', 199)]));
    expect(best).toMatchObject({ quantity: 975, overBuy: false });
  });

  it('marks a fill that has to over-buy beyond the cap', () => {
    const r = row('paneer', 300, 'g');
    const [best] = buildFills(r, matches(r, [listing('Amul Malai Paneer', '500 g', 180)]));
    expect(best).toMatchObject({ quantity: 500, overBuy: true });
  });

  it('prices pack rows as N of the cheapest pack in the line', () => {
    const r = row('maggi', 4, 'pack');
    const [best] = buildFills(r, matches(r, [listing('Maggi 2-Minute Masala Noodles', '70 g', 14, { brand: 'Maggi' })]));
    expect(best).toMatchObject({ cost: 56, quantity: 4, packLabel: '4 × 70 g' });
  });

  it('prefers fewer packs when costs tie', () => {
    const r = row('sugar', 2, 'kg');
    const [best] = buildFills(r, matches(r, [listing('Madhur Sugar', '1 kg', 50), listing('Madhur Sugar', '2 kg', 100)]));
    expect(best?.packs).toHaveLength(1);
    expect(best?.packLabel).toBe('2 kg');
  });

  it('uses only the pinned product line when the user pinned one', () => {
    const r = row('onion', 1, 'kg');
    const pinned = listing('Organic Onion', '1 kg', 80);
    const fills = buildFills(r, matches(r, [listing('Fresho Onion', '1 kg', 55), pinned]), { pinnedListingId: pinned.listingId });
    expect(fills.map((f) => f.cost)).toEqual([80]);
  });

  it('never fills from possible matches or unreadable sizes', () => {
    const r = row('full cream milk', 1, 'L');
    const fills = buildFills(r, matches(r, [listing('Amul Taaza Toned Milk', '1 L', 70), listing('Amul Gold Full Cream Milk', 'Combo', 80)]));
    expect(fills).toEqual([]);
  });
});

describe('lineLabel', () => {
  it('drops sizes and the empty brackets they leave behind', () => {
    expect(lineLabel(listing('Onion (Approx. 900 g - 1000 g)', '900 g', 35))).toBe('Onion');
    expect(lineLabel(listing('Aashirvaad Shudh Chakki Atta 5 kg', '5 kg', 262))).toBe('Aashirvaad Shudh Chakki Atta');
  });
});

describe('dropPriceOutliers', () => {
  const fill = (cost: number, quantity: number): Fill => ({
    itemId: 'r',
    platformId: 'zepto',
    packs: [],
    quantity,
    cost,
    overBuy: false,
    label: 'x',
    packLabel: 'x',
    brand: null,
    imageUrl: null,
    productUrl: '',
  });

  it('drops per-unit prices more than 10× or under a tenth of the median', () => {
    const kept = dropPriceOutliers([fill(50, 1000), fill(55, 1000), fill(60, 1000), fill(900, 1000), fill(2, 1000)]);
    expect(kept.map((f) => f.cost)).toEqual([50, 55, 60]);
  });
});

describe('buildFills: step-up packs', () => {
  it('offers the next size up within +25% as an alternative, marked as a step-up', () => {
    const atta = row('aashirvaad atta', 5, 'kg');
    const one = listing('Aashirvaad Shudh Chakki Atta', '1 kg', 55);
    const five = listing('Aashirvaad Shudh Chakki Atta', '5 kg', 250);
    const fills = buildFills(atta, matches(atta, [one, five]));
    expect(fills[0]).toMatchObject({ cost: 250, quantity: 5000 });
    expect(fills.find((f) => f.stepUp)).toMatchObject({ cost: 305, quantity: 6000, packLabel: '5 kg + 1 kg', overBuy: false });
  });

  it('offers no step-up when the next size would be more than +25%', () => {
    const milk = row('amul taaza milk', 1, 'L');
    const fills = buildFills(milk, matches(milk, [listing('Amul Taaza Toned Milk', '1 L', 68), listing('Amul Taaza Toned Milk', '500 ml', 36)]));
    expect(fills.some((f) => f.stepUp)).toBe(false);
  });
});
