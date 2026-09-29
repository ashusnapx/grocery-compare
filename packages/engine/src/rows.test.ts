import { describe, expect, it } from 'vitest';
import { parsePastedList, parseRow, suggest } from './rows';
import type { ListRow } from './types';

const row = (text: string, amount: number, unit: ListRow['unit'], anyBrand = false): ListRow => ({
  id: 'r1',
  text,
  amount,
  unit,
  anyBrand,
});

describe('parseRow', () => {
  it('locks a named brand and searches with it', () => {
    const p = parseRow(row('Aashirvaad atta', 5, 'kg'));
    expect(p.brand).toBe('Aashirvaad');
    expect(p.brandLocked).toBe(true);
    expect(p.itemKey).toBe('atta');
    expect(p.required).toEqual([]);
    expect(p.searchText).toBe('aashirvaad atta');
    expect(p.quantity).toEqual({ value: 5000, dim: 'mass' });
  });

  it('drops the brand from the search when the row is switched to any brand', () => {
    const p = parseRow(row('Aashirvaad atta', 5, 'kg', true));
    expect(p.brand).toBe('Aashirvaad');
    expect(p.brandLocked).toBe(false);
    expect(p.searchText).toBe('atta');
  });

  it('makes every extra typed word a requirement', () => {
    const p = parseRow(row('full cream milk', 1, 'L'));
    expect(p.itemKey).toBe('milk');
    expect(p.required).toEqual(['full', 'cream']);
    expect(p.searchText).toBe('full cream milk');
  });

  it('keeps variety words for rice', () => {
    const p = parseRow(row('sona masoori rice', 5, 'kg'));
    expect(p.itemKey).toBe('rice');
    expect(p.required).toEqual(['sona', 'masoori']);
  });

  it('translates Hinglish names to what platforms call them', () => {
    const p = parseRow(row('pyaz', 1, 'kg'));
    expect(p.itemKey).toBe('onion');
    expect(p.searchText).toBe('onion');
    expect(p.fallbackSearchText).toBe('pyaz');
    expect(p.headForms).toContain('pyaz');
  });

  it('knows a dal by any of its names', () => {
    const p = parseRow(row('arhar dal', 1, 'kg'));
    expect(p.itemKey).toBe('toor dal');
    expect(p.headForms).toEqual(expect.arrayContaining(['toor dal', 'arhar dal', 'tur dal']));
  });

  it('treats a brand-only row as that brand’s product', () => {
    const p = parseRow(row('maggi', 4, 'pack'));
    expect(p.brand).toBe('Maggi');
    expect(p.itemKey).toBe('noodles');
    expect(p.searchText).toBe('maggi noodles');
  });

  it('ignores filler words such as "fresh"', () => {
    const p = parseRow(row('fresh paneer', 200, 'g'));
    expect(p.itemKey).toBe('paneer');
    expect(p.required).toEqual([]);
  });

  it('falls back to the last word as the product for unknown items', () => {
    const p = parseRow(row('Kellogg’s chocos', 1, 'pack'));
    expect(p.brand).toBe("Kellogg's");
    expect(p.itemKey).toBeNull();
    expect(p.head).toBe('chocos');
    expect(p.required).toEqual([]);
  });
});

describe('parsePastedList', () => {
  it('turns a WhatsApp-style list into rows with sensible defaults', () => {
    const rows = parsePastedList(`1. Atta - 5 kg
- toor dal 1kg
• pyaz 2 kg
eggs 12, amul butter 500g
milk 1L x 2
maggi`);
    expect(rows.map((r) => [r.text, r.amount, r.unit])).toEqual([
      ['Atta', 5, 'kg'],
      ['toor dal', 1, 'kg'],
      ['pyaz', 2, 'kg'],
      ['eggs', 12, 'pcs'],
      ['amul butter', 500, 'g'],
      ['milk', 2, 'L'],
      ['maggi', 1, 'pack'],
    ]);
  });

  it('skips blank lines and headings', () => {
    expect(parsePastedList('\n\nGrocery list:\n\nsugar 1 kg\n')).toHaveLength(1);
  });
});

describe('suggest', () => {
  it('finds items by English or Hinglish prefix', () => {
    expect(suggest('pya').map((s) => s.key)).toContain('onion');
    expect(suggest('toor').map((s) => s.key)).toContain('toor dal');
    expect(suggest('atta')[0]?.key).toBe('atta');
  });

  it('offers the item’s usual amount', () => {
    const eggs = suggest('eggs').find((s) => s.key === 'eggs');
    expect(eggs).toMatchObject({ amount: 12, unit: 'pcs' });
  });
});
