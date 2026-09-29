import { describe, expect, it } from 'vitest';
import { formatQuantity, parseAmountText, parseQuantityText, toBase } from './quantity';

describe('toBase', () => {
  it('converts every dropdown unit to its base unit', () => {
    expect(toBase(5, 'kg')).toEqual({ value: 5000, dim: 'mass' });
    expect(toBase(250, 'g')).toEqual({ value: 250, dim: 'mass' });
    expect(toBase(1.5, 'L')).toEqual({ value: 1500, dim: 'volume' });
    expect(toBase(200, 'ml')).toEqual({ value: 200, dim: 'volume' });
    expect(toBase(2, 'dozen')).toEqual({ value: 24, dim: 'count' });
    expect(toBase(6, 'pcs')).toEqual({ value: 6, dim: 'count' });
    expect(toBase(3, 'pack')).toEqual({ value: 3, dim: 'pack' });
  });
});

describe('parseQuantityText (a listing’s own net-quantity text)', () => {
  it.each([
    ['500 g', 500],
    ['1 kg', 1000],
    ['1.5 kg', 1500],
    ['5 Kg', 5000],
    ['250gm', 250],
    ['1 kg - Pouch', 1000],
    ['500 g Pouch', 500],
  ])('reads mass "%s" as %d g', (text, grams) => {
    expect(parseQuantityText(text)).toMatchObject({ dim: 'mass', value: grams });
  });

  it.each([
    ['1 L', 1000],
    ['1 ltr', 1000],
    ['1 litre', 1000],
    ['500 ML', 500],
    ['200 ml', 200],
  ])('reads volume "%s" as %d ml', (text, ml) => {
    expect(parseQuantityText(text)).toMatchObject({ dim: 'volume', value: ml });
  });

  it.each([
    ['2 x 500 g', 1000],
    ['2x500g', 1000],
    ['500 g x 2', 1000],
    ['3 x 100 g', 300],
    ['Pack of 3 (100 g each)', 300],
    ['Pack of 2 x 1 kg', 2000],
    ['(2 x 1 L)', 2000],
  ])('multiplies explicit multipacks: "%s" = %d', (text, total) => {
    expect(parseQuantityText(text)?.value).toBe(total);
  });

  it.each([
    ['6 pcs', 6],
    ['6 pieces', 6],
    ['12 units', 12],
    ['1 dozen', 12],
    ['1 pc', 1],
    ['Pack of 6', 6],
  ])('reads count "%s" as %d', (text, n) => {
    expect(parseQuantityText(text)).toMatchObject({ dim: 'count', value: n });
  });

  it('keeps a count range stated beside a mass', () => {
    expect(parseQuantityText('1 kg (4-6 pcs)')).toEqual({ dim: 'mass', value: 1000, countRange: [4, 6] });
    expect(parseQuantityText('500 g (approx. 3 - 4 pieces)')).toEqual({ dim: 'mass', value: 500, countRange: [3, 4] });
  });

  it('keeps a mass range stated beside a count', () => {
    expect(parseQuantityText('1 pc (1.8 - 2.5 kg)')).toEqual({ dim: 'count', value: 1, massRange: [1800, 2500] });
  });

  it('reads an approximate weight range as its midpoint', () => {
    expect(parseQuantityText('900 g - 1000 g')).toMatchObject({ dim: 'mass', value: 950 });
    expect(parseQuantityText('Approx. 900 g - 1 kg')).toMatchObject({ dim: 'mass', value: 950 });
    expect(parseQuantityText('1 kg - 1.2 kg')).toMatchObject({ dim: 'mass', value: 1100 });
  });

  it('reads "U" as units, the way DMart writes counts', () => {
    expect(parseQuantityText('5 U')).toMatchObject({ dim: 'count', value: 5 });
  });

  it('refuses ambiguous or empty text instead of guessing', () => {
    expect(parseQuantityText('')).toBeNull();
    expect(parseQuantityText('Combo')).toBeNull();
    // "500 g, pack of 2" could mean 2 × 500 g or 2 × 250 g: a wrong size is worse than none.
    expect(parseQuantityText('500 g - Pack of 2')).toBeNull();
  });
});

describe('parseAmountText (what a user typed)', () => {
  it.each([
    ['atta 5kg', 'atta', 5, 'kg'],
    ['5 kg atta', 'atta', 5, 'kg'],
    ['Aashirvaad atta 10 kg', 'Aashirvaad atta', 10, 'kg'],
    ['1/2 kg paneer', 'paneer', 0.5, 'kg'],
    ['½ kg paneer', 'paneer', 0.5, 'kg'],
    ['paneer 250gm', 'paneer', 250, 'g'],
    ['2 litre milk', 'milk', 2, 'L'],
    ['milk 500ml', 'milk', 500, 'ml'],
    ['eggs 12 pcs', 'eggs', 12, 'pcs'],
    ['2 dozen eggs', 'eggs', 2, 'dozen'],
    ['bread 2 packets', 'bread', 2, 'pack'],
  ])('"%s" → name "%s", %d %s', (text, name, amount, unit) => {
    expect(parseAmountText(text)).toEqual({ name, amount, unit });
  });

  it('multiplies "1L x 2" style entries', () => {
    expect(parseAmountText('Milk 1L x 2')).toEqual({ name: 'Milk', amount: 2, unit: 'L' });
    expect(parseAmountText('amul butter 100 g × 3')).toEqual({ name: 'amul butter', amount: 300, unit: 'g' });
  });

  it('treats a bare count as a count with no unit yet', () => {
    expect(parseAmountText('eggs 12')).toEqual({ name: 'eggs', amount: 12, unit: null });
    expect(parseAmountText('Maggi x 4')).toEqual({ name: 'Maggi', amount: 4, unit: null });
  });

  it('returns the name alone when no amount was typed', () => {
    expect(parseAmountText('toor dal')).toEqual({ name: 'toor dal', amount: null, unit: null });
  });
});

describe('formatQuantity', () => {
  it('prints base quantities the way a shopper says them', () => {
    expect(formatQuantity({ value: 5000, dim: 'mass' })).toBe('5 kg');
    expect(formatQuantity({ value: 500, dim: 'mass' })).toBe('500 g');
    expect(formatQuantity({ value: 1500, dim: 'volume' })).toBe('1.5 L');
    expect(formatQuantity({ value: 12, dim: 'count' })).toBe('12 pcs');
    expect(formatQuantity({ value: 1, dim: 'pack' })).toBe('1 pack');
    expect(formatQuantity({ value: 3, dim: 'pack' })).toBe('3 packs');
  });
});
