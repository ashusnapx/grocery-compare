import { describe, expect, it } from 'vitest';
import { FEE_CATALOG, MEMBERSHIPS, catalogSchedule } from './catalog';
import { feeLines, feeTiers, feeTotal, isMonotone, resolveSchedule, withVariant } from './fees';
import type { FeeSchedule } from './types';

const blinkitLike: FeeSchedule = {
  platformId: 'blinkit',
  cities: 'default',
  minOrder: null,
  rules: [
    { kind: 'flat', label: 'Handling', amount: 4 },
    { kind: 'below', label: 'Delivery', amount: 30, threshold: 199 },
    { kind: 'below', label: 'Small cart', amount: 20, threshold: 99 },
  ],
  variants: [{ id: 'peak', label: 'Peak hours', rules: [{ kind: 'below', label: 'Delivery', amount: 30, threshold: 299 }] }],
  notes: [],
  sources: [],
  checkedAt: '2026-09-27',
};

describe('fee evaluation', () => {
  it('charges each rule by its own condition', () => {
    expect(feeTotal(blinkitLike, 250)).toBe(4);
    expect(feeTotal(blinkitLike, 150)).toBe(34);
    expect(feeTotal(blinkitLike, 50)).toBe(54);
    // exactly at the threshold, the fee is gone
    expect(feeTotal(blinkitLike, 199)).toBe(4);
  });

  it('itemises the fees actually charged', () => {
    expect(feeLines(blinkitLike, 150)).toEqual([
      { label: 'Handling', amount: 4, approximate: false },
      { label: 'Delivery', amount: 30, approximate: false },
    ]);
  });

  it('reads tiered tables', () => {
    const tiered: FeeSchedule = {
      ...blinkitLike,
      rules: [{ kind: 'tiered', label: 'Delivery', tiers: [{ from: 0, amount: 50 }, { from: 600, amount: 10 }, { from: 1000, amount: 0 }] }],
    };
    expect(feeTotal(tiered, 500)).toBe(50);
    expect(feeTotal(tiered, 700)).toBe(10);
    expect(feeTotal(tiered, 1200)).toBe(0);
  });

  it('turns a schedule into subtotal tiers for the optimizer', () => {
    expect(feeTiers(blinkitLike)).toEqual([
      { from: 0, fee: 54 },
      { from: 99, fee: 34 },
      { from: 199, fee: 4 },
    ]);
  });

  it('detects a schedule whose fee rises with the subtotal', () => {
    expect(isMonotone(blinkitLike)).toBe(true);
    const bad: FeeSchedule = { ...blinkitLike, rules: [{ kind: 'tiered', label: 'Odd', tiers: [{ from: 0, amount: 10 }, { from: 500, amount: 20 }] }] };
    expect(isMonotone(bad)).toBe(false);
  });

  it('applies a variant by replacing rules of the same label', () => {
    const peak = withVariant(blinkitLike, 'peak');
    expect(feeTotal(peak, 250)).toBe(34);
    expect(feeTotal(peak, 300)).toBe(4);
  });
});

describe('resolveSchedule', () => {
  it('applies a membership to the named rule', () => {
    const zepto = catalogSchedule('zepto');
    const withClub = resolveSchedule(zepto, { memberships: ['zepto_club'] });
    expect(feeTotal(withClub, 120)).toBeLessThan(feeTotal(zepto, 120));
  });

  it('lets a live hint override only the fields it carries', () => {
    const r = resolveSchedule(blinkitLike, { hints: { minOrder: 99 } });
    expect(r.minOrder).toBe(99);
    expect(feeTotal(r, 150)).toBe(34);
    expect(r.provenance).toEqual(['live', 'catalog']);
  });

  it('uses every fee a platform states live: handling, small cart, and a surge in force now', () => {
    const r = resolveSchedule(blinkitLike, {
      hints: { handlingFee: 9, smallCartFee: 15, smallCartBelow: 149, surgeFee: 20, freeDeliveryAbove: 249 },
    });
    // 120 < 149 small-cart line, < 249 delivery line: 9 handling + 30 delivery + 15 small cart + 20 surge
    expect(feeTotal(r, 120)).toBe(74);
    // 300: only handling and the surge
    expect(feeTotal(r, 300)).toBe(29);
    expect(feeLines(r, 300).map((f) => f.label)).toEqual(['Handling', 'Surge (right now)']);
  });

  it('puts the user’s own numbers above everything', () => {
    const r = resolveSchedule(blinkitLike, {
      hints: { freeDeliveryAbove: 199 },
      overrides: [{ platformId: 'blinkit', freeDeliveryAbove: 149, deliveryFee: 25, handlingFee: 0 }],
    });
    expect(feeTotal(r, 160)).toBe(0);
    // below the user's ₹149 threshold, above the ₹99 small-cart line: delivery only
    expect(feeTotal(r, 140)).toBe(25);
    expect(r.provenance[0]).toBe('override');
  });

  it('adds a late-night variant only inside its window', () => {
    const s: FeeSchedule = {
      ...blinkitLike,
      variants: [{ id: 'late_night', label: 'Late night', window: { from: '23:00', to: '05:00' }, rules: [{ kind: 'flat', label: 'Late night', amount: 10 }] }],
    };
    expect(feeTotal(resolveSchedule(s, { now: new Date('2026-09-27T18:00:00Z') }), 250)).toBe(14); // 23:30 IST
    expect(feeTotal(resolveSchedule(s, { now: new Date('2026-09-27T06:00:00Z') }), 250)).toBe(4); // 11:30 IST
  });
});

describe('the fee catalog', () => {
  it('has an entry for every platform, each with sources and a check date', () => {
    for (const s of FEE_CATALOG) {
      expect(s.sources.length, s.platformId).toBeGreaterThan(0);
      expect(s.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('never has a fee that rises with the subtotal', () => {
    for (const s of FEE_CATALOG) {
      expect(isMonotone(s), s.platformId).toBe(true);
      for (const v of s.variants) expect(isMonotone(withVariant(s, v.id)), `${s.platformId}:${v.id}`).toBe(true);
    }
  });

  it('only references rules that exist in memberships', () => {
    for (const m of MEMBERSHIPS) {
      const s = catalogSchedule(m.platformId);
      for (const c of m.changes) expect(s.rules.some((r) => r.label === c.rule), `${m.membershipId}:${c.rule}`).toBe(true);
    }
  });
});

describe('resolveSchedule: per-order fees from an account', () => {
  it('adds packaging and platform fees as flat rules, and drops them at zero', () => {
    const s = resolveSchedule(catalogSchedule('instamart'), { hints: { packagingFee: 11, platformFee: 5 } });
    expect(s.rules).toEqual(expect.arrayContaining([
      { kind: 'flat', label: 'Packaging', amount: 11 },
      { kind: 'flat', label: 'Platform', amount: 5 },
    ]));
    const none = resolveSchedule(catalogSchedule('instamart'), { hints: { packagingFee: 0 } });
    expect(none.rules.some((r) => r.label === 'Packaging')).toBe(false);
  });
});
