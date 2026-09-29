import { describe, expect, it } from 'vitest';
import { matchListing } from './match';
import { parseRow } from './rows';
import type { ListRow, Listing } from './types';

const row = (text: string, amount: number, unit: ListRow['unit'], anyBrand = false) =>
  parseRow({ id: 'r', text, amount, unit, anyBrand });

let n = 0;
const listing = (title: string, quantityText: string, extra: Partial<Listing> = {}): Listing => ({
  platformId: 'zepto',
  listingId: `l${n++}`,
  title,
  brand: null,
  quantityText,
  price: 100,
  mrp: null,
  inStock: true,
  productUrl: 'https://example.com/p',
  imageUrl: null,
  category: null,
  fetchedAt: '2026-09-27T10:00:00Z',
  ...extra,
});

describe('matchListing: same kind of product', () => {
  it('accepts the product asked for, with its pack size in the row’s unit', () => {
    const m = matchListing(row('amul butter', 500, 'g'), listing('Amul Pasteurised Butter', '500 g', { brand: 'Amul' }));
    expect(m).toMatchObject({ confidence: 'confident', packQuantity: 500 });
  });

  it('rejects a different product that merely contains the word', () => {
    const milk = row('milk', 1, 'L');
    expect(matchListing(milk, listing('Cadbury Dairy Milk Chocolate Bar', '50 g'))).toBeNull();
    expect(matchListing(milk, listing('Amul Spray Milk Powder', '500 g'))).toBeNull();
    expect(matchListing(milk, listing('Amul Masti Spiced Butter Milk', '200 ml'))).toBeNull();
    expect(matchListing(row('butter', 500, 'g', true), listing('Britannia Butter Cookies', '200 g'))).toBeNull();
  });

  it('rejects kitchen tools and toys named after the food, but not real packs', () => {
    const eggs = row('eggs', 12, 'pcs');
    expect(matchListing(eggs, listing('Soros 24 Compartment Egg Tray - Transparent', '1 pc'))).toBeNull();
    expect(matchListing(eggs, listing('Little’s Nesting Eggs', '1 pc', { brand: 'Little’s' }))).toBeNull();
    expect(matchListing(eggs, listing('Egg Boiler with Egg Separator', '1 pc'))).toBeNull();
    expect(matchListing(eggs, listing('Farm Fresh Eggs - Tray of 30', '30 pcs'))).toMatchObject({ packQuantity: 30 });
    expect(matchListing(row('garlic', 250, 'g'), listing('Garlic Crusher', '1 pc'))).toBeNull();
    expect(matchListing(row('garlic', 250, 'g'), listing('Peeled Garlic', '200 g'))).toMatchObject({ packQuantity: 200 });
    expect(matchListing(row('sunflower oil', 5, 'L'), listing('Fortune Sunflower Oil Container', '5 L'))).toMatchObject({ packQuantity: 5000 });
  });

  it('accepts any child of a generic row', () => {
    const m = matchListing(row('dal', 1, 'kg'), listing('Tata Sampann Unpolished Toor Dal', '1 kg'));
    expect(m?.confidence).toBe('confident');
  });

  it('knows a dal by its other names', () => {
    const m = matchListing(row('toor dal', 1, 'kg'), listing('Tata Sampann Unpolished Arhar Dal', '1 kg'));
    expect(m?.confidence).toBe('confident');
    expect(matchListing(row('toor dal', 1, 'kg'), listing('Tata Sampann Moong Dal', '1 kg'))).toBeNull();
  });

  it('ignores translations in brackets when deciding the product type', () => {
    const pyaz = row('pyaz', 1, 'kg');
    expect(matchListing(pyaz, listing('Spring Onion (Eerulli Soppu)', '250 g'))).toBeNull();
    expect(matchListing(pyaz, listing('Onion (Eerulli)', '1 kg'))?.confidence).toBe('confident');
  });

  it('knows sambar onions are shallots, not onions', () => {
    expect(matchListing(row('onion', 1, 'kg'), listing('Sambar Onion 500 g', '500 g'))).toBeNull();
    expect(matchListing(row('sambar onion', 500, 'g'), listing('Sambar Onion 500 g', '500 g'))?.confidence).toBe('confident');
  });

  it('uses the midpoint of an approximate weight stated in the title', () => {
    const m = matchListing(row('onion', 1, 'kg'), listing('Onion (Approx. 900 g - 1000 g)', '900 g'));
    expect(m?.packQuantity).toBe(950);
  });

  it('matches a Hinglish row to an English title', () => {
    expect(matchListing(row('pyaz', 1, 'kg'), listing('Onion', '1 kg'))?.confidence).toBe('confident');
  });

  it('accepts a title that spells a compound name non-contiguously', () => {
    const m = matchListing(row('rice bran oil', 1, 'L'), listing('Fortune Rice Bran Health Oil', '1 L'));
    expect(m?.confidence).toBe('confident');
  });

  it('matches unknown items by their head word', () => {
    const r = row('Kellogg’s chocos', 1, 'pack');
    expect(matchListing(r, listing("Kellogg's Chocos Moons & Stars", '350 g', { brand: "Kellogg's" }))?.confidence).toBe('confident');
    expect(matchListing(r, listing("Kellogg's Corn Flakes", '475 g', { brand: "Kellogg's" }))).toBeNull();
  });
});

describe('matchListing: brand locks', () => {
  it('rejects another brand when the row names one', () => {
    expect(matchListing(row('amul butter', 500, 'g'), listing('Mother Dairy Butter', '500 g', { brand: 'Mother Dairy' }))).toBeNull();
  });

  it('accepts any brand when the row is switched to any brand', () => {
    const m = matchListing(row('amul butter', 500, 'g', true), listing('Mother Dairy Butter', '500 g', { brand: 'Mother Dairy' }));
    expect(m?.confidence).toBe('confident');
  });

  it('finds the brand in the title when the platform has no brand field', () => {
    expect(matchListing(row('aashirvaad atta', 5, 'kg'), listing('Aashirvaad Shudh Chakki Atta', '5 kg'))?.confidence).toBe('confident');
  });
});

describe('matchListing: possible matches', () => {
  it('flags a missing required word instead of silently comparing', () => {
    const m = matchListing(row('full cream milk', 1, 'L'), listing('Amul Taaza Toned Milk', '1 L'));
    expect(m).toMatchObject({ confidence: 'possible' });
    expect(m?.reason).toMatch(/full cream/);
    expect(matchListing(row('full cream milk', 1, 'L'), listing('Amul Gold Full Cream Milk', '1 L'))?.confidence).toBe('confident');
  });

  it('flags a multigrain atta for a plain atta row', () => {
    const m = matchListing(row('aashirvaad atta', 5, 'kg'), listing('Aashirvaad High Fibre Atta with Multigrains', '5 kg'));
    expect(m?.confidence).toBe('possible');
  });

  it('sees through a misspelt compound name (real JioMart data: "Penaut Butter")', () => {
    expect(matchListing(row('butter', 500, 'g', true), listing('MyFitness Natural Smooth Penaut Butter 510 g', '510 g'))).toBeNull();
  });

  it('keeps a lone lookalike word from matching ("Better" is not butter)', () => {
    expect(matchListing(row('butter', 500, 'g', true), listing('Better Choice Table Butter', '500 g'))?.confidence).toBe('confident');
  });

  it('does not sell quail eggs as eggs', () => {
    expect(matchListing(row('eggs', 12, 'pcs'), listing('fresho! Farm Quail Eggs', '12 pcs'))).toBeNull();
  });

  it('does not mistake butter murukku for butter', () => {
    expect(matchListing(row('butter', 500, 'g', true), listing('GRB Town Bus Butter Murukku', '170 g'))).toBeNull();
  });

  it('flags a flavour variant the user did not ask for', () => {
    const m = matchListing(row('amul butter', 100, 'g'), listing('Amul Garlic & Herbs Butter', '100 g', { brand: 'Amul' }));
    expect(m).toMatchObject({ confidence: 'possible' });
    expect(m?.reason).toMatch(/garlic/i);
  });
});

describe('matchListing: pack quantity', () => {
  it('reads counts, and a count range beside a mass as its lower bound', () => {
    expect(matchListing(row('eggs', 12, 'pcs'), listing('Farm Fresh White Eggs', '6 pcs'))?.packQuantity).toBe(6);
    expect(matchListing(row('banana', 6, 'pcs'), listing('Robusta Banana', '1 kg (5-7 pcs)'))?.packQuantity).toBe(5);
  });

  it('converts ghee litres to grams by density', () => {
    expect(matchListing(row('ghee', 1, 'kg'), listing('Amul Pure Ghee', '1 L', { brand: 'Amul' }))?.packQuantity).toBe(910);
  });

  it('counts a bar of soap as one piece, and a multipack as its count', () => {
    const soap = row('soap', 4, 'pcs');
    expect(matchListing(soap, listing('Dove Cream Beauty Bathing Soap', '125 g'))?.packQuantity).toBe(1);
    expect(matchListing(soap, listing('Lux Soap Bar', '4 x 150 g'))?.packQuantity).toBe(4);
  });

  it('counts any listing as one pack for pack rows', () => {
    expect(matchListing(row('maggi', 4, 'pack'), listing('Maggi 2-Minute Masala Noodles', '70 g', { brand: 'Maggi' }))?.packQuantity).toBe(1);
  });

  it('keeps the product but no quantity when the size cannot be read', () => {
    const m = matchListing(row('onion', 1, 'kg'), listing('Onion', 'Combo'));
    expect(m).toMatchObject({ packQuantity: null });
  });
});
