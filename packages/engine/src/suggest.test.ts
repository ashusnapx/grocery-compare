import { describe, expect, it } from 'vitest';
import { parseRow } from './rows';
import { groupProducts, productToRow } from './suggest';
import type { Listing, PlatformId } from './types';

let n = 0;
const l = (platformId: PlatformId, title: string, quantityText: string, price: number, brand: string | null = null, imageUrl: string | null = null): Listing => ({
  platformId,
  listingId: `${platformId}-${n++}`,
  title,
  brand,
  quantityText,
  price,
  mrp: null,
  inStock: true,
  productUrl: `https://example.com/${n}`,
  imageUrl,
  category: null,
  fetchedAt: '2026-09-29T10:00:00Z',
});

describe('groupProducts', () => {
  it('merges the same brand, product and size across apps, cheapest offer first', () => {
    const groups = groupProducts([
      l('blinkit', 'Amul Pasteurised Butter', '500 g', 285, 'Amul', 'https://img/b.jpg'),
      l('jiomart', 'Amul Butter 500 g', '500 g', 279, 'amul'),
      l('bigbasket', 'Amul Butter - Pasteurised', '500 g', 290, 'Amul'),
      l('blinkit', 'Amul Pasteurised Butter', '100 g', 58, 'Amul'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.offers.map((o) => [o.platformId, o.price])).toEqual([
      ['jiomart', 279],
      ['blinkit', 285],
      ['bigbasket', 290],
    ]);
    expect(groups[0]).toMatchObject({ brand: 'Amul', size: '500 g', imageUrl: 'https://img/b.jpg' });
    expect(groups[1]).toMatchObject({ size: '100 g' });
  });

  it('puts what was typed first: the named brand’s product before other brands and other products', () => {
    const listings = [
      l('blinkit', 'Country Delight Salted Butter (Cow Milk)', '80 g', 69, 'Country Delight'),
      l('blinkit', 'Amul Fresh Butter Cookies', '200 g', 85, 'Amul'),
      l('blinkit', 'Amul Salted Butter', '100 g', 63, 'Amul'),
      l('blinkit', 'Amul Salted Butter', '500 g', 285, 'Amul'),
    ];
    const row = parseRow({ id: 't', text: 'amul butter', amount: 100, unit: 'g', anyBrand: false });
    const titles = groupProducts(listings, 10, { row, sized: false }).map((g) => `${g.title} ${g.size}`);
    expect(titles.slice(0, 2)).toEqual(['Amul Salted Butter 100 g', 'Amul Salted Butter 500 g']);
    expect(titles.slice(2)).toEqual(expect.arrayContaining(['Country Delight Salted Butter (Cow Milk) 80 g', 'Amul Fresh Butter Cookies 200 g']));
  });

  it('ranks a typed size first among the right products', () => {
    const listings = [
      l('blinkit', 'Onion Pakoda Namkeen', '140 g', 43, 'Garden'),
      l('blinkit', 'Onion', '1 kg', 67),
      l('blinkit', 'Onion', '2 kg', 120),
    ];
    const row = parseRow({ id: 't', text: 'pyaz', amount: 2, unit: 'kg', anyBrand: false });
    const titles = groupProducts(listings, 10, { row, sized: true }).map((g) => `${g.title} ${g.size}`);
    expect(titles).toEqual(['Onion 2 kg', 'Onion 1 kg', 'Onion Pakoda Namkeen 140 g']);
  });

  it('keeps different brands apart', () => {
    const groups = groupProducts([l('blinkit', 'Amul Butter', '500 g', 285, 'Amul'), l('blinkit', 'Mother Dairy Butter', '500 g', 280, 'Mother Dairy')]);
    expect(groups).toHaveLength(2);
  });
});

describe('unit prices', () => {
  it('spreads the price over the pack: ₹300 for 3 pcs is ₹100 a piece', () => {
    const [g] = groupProducts([l('blinkit', 'Hass Avocado', '3 pcs', 300)]);
    expect(g!.unitPrice).toEqual({ amount: 100, per: 'pc' });
  });

  it('uses one unit for the whole list: per kg once any pack is 1 kg or more', () => {
    const groups = groupProducts([l('blinkit', 'Aashirvaad Atta', '5 kg', 244, 'Aashirvaad'), l('blinkit', 'Aashirvaad Atta', '500 g', 30, 'Aashirvaad')]);
    expect(groups.map((g) => g.unitPrice)).toEqual([
      { amount: 48.8, per: 'kg' },
      { amount: 60, per: 'kg' },
    ]);
  });

  it('uses per 100 g / 100 ml when every pack is small', () => {
    const groups = groupProducts([l('blinkit', 'Amul Butter', '100 g', 61, 'Amul'), l('jiomart', 'Coca-Cola', '750 ml', 40, 'Coca-Cola')]);
    expect(groups.map((g) => g.unitPrice)).toEqual([
      { amount: 61, per: '100 g' },
      { amount: 5.33, per: '100 ml' },
    ]);
  });

  it('marks the best value among the products that are what was typed', () => {
    const listings = [
      l('blinkit', 'Amul Salted Butter', '100 g', 61, 'Amul'),
      l('blinkit', 'Amul Salted Butter', '500 g', 285, 'Amul'),
      l('blinkit', 'Amul Butter Cookies', '200 g', 40, 'Amul'),
    ];
    const row = parseRow({ id: 't', text: 'amul butter', amount: 100, unit: 'g', anyBrand: false });
    const groups = groupProducts(listings, 10, { row, sized: false });
    expect(groups.filter((g) => g.bestValue).map((g) => g.size)).toEqual(['500 g']);
    // Cookies are cheaper per 100 g but are not butter.
    expect(groups.find((g) => g.title.includes('Cookies'))!.bestValue).toBe(false);
  });

  it('marks nothing without a typed item or when every unit price is the same', () => {
    const same = [l('blinkit', 'Milk', '500 ml', 30), l('blinkit', 'Milk', '1 L', 60)];
    expect(groupProducts(same).some((g) => g.bestValue)).toBe(false);
    const row = parseRow({ id: 't', text: 'milk', amount: 1, unit: 'L', anyBrand: false });
    expect(groupProducts(same, 10, { row, sized: false }).some((g) => g.bestValue)).toBe(false);
  });
});

describe('productToRow', () => {
  it('turns a picked product into a brand-locked row of that exact size, pinned per app', () => {
    const [g] = groupProducts([l('blinkit', 'Amul Pasteurised Butter', '500 g', 285, 'Amul'), l('jiomart', 'Amul Butter 500 g', '500 g', 279, 'amul')]);
    const row = productToRow(g!);
    expect(row).toMatchObject({ text: 'Amul butter', amount: 500, unit: 'g', anyBrand: false });
    expect(Object.keys(row.pins ?? {}).sort()).toEqual(['blinkit', 'jiomart']);
  });

  it('uses kg and L for round big packs', () => {
    const [g] = groupProducts([l('blinkit', 'Aashirvaad Shudh Chakki Atta', '5 kg', 262, 'Aashirvaad')]);
    expect(productToRow(g!)).toMatchObject({ text: 'Aashirvaad atta', amount: 5, unit: 'kg' });
  });
});
