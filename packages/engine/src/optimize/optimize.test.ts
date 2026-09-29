import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Fill, FeeRule, PlatformId, ResolvedSchedule } from '../types';
import { bruteForce } from './brute';
import { planBasket, type PlanInput } from './plan';
import { buildProblem } from './problem';
import { solveExact } from './solver';

const IDS: PlatformId[] = ['blinkit', 'zepto', 'instamart', 'jiomart', 'dmart', 'bigbasket'];

function platform(id: PlatformId, rules: FeeRule[], minOrder: number | null = null, variants: ResolvedSchedule['variants'] = []) {
  const schedule: ResolvedSchedule = { platformId: id, minOrder, rules, variants, notes: [], checkedAt: '2026-09-27', provenance: ['catalog'] };
  return { id, schedule, eta: '10 mins' };
}

function fill(itemId: string, platformId: PlatformId, cost: number, label = `${itemId} on ${platformId}`): Fill {
  return {
    itemId,
    platformId,
    packs: [{ listingId: `${itemId}-${platformId}-${cost}`, count: 1, size: 1, price: cost, title: label }],
    quantity: 1,
    cost,
    overBuy: false,
    label,
    packLabel: '1 pc',
    brand: null,
    imageUrl: null,
    productUrl: 'https://example.com',
  };
}

const QUICK: FeeRule[] = [
  { kind: 'flat', label: 'Handling', amount: 9 },
  { kind: 'below', label: 'Delivery', amount: 30, threshold: 199 },
];

describe('planBasket: scenarios', () => {
  it('takes a slightly bigger pack when it clears a fee for less than the fee', async () => {
    const step: Fill = { ...fill('atta', 'zepto', 195), quantity: 1.2, stepUp: true, packLabel: '5 kg + 1 kg' };
    const input: PlanInput = {
      rows: [{ id: 'atta', label: 'atta', brandLocked: false }],
      platforms: [platform('zepto', [{ kind: 'below', label: 'Delivery', amount: 30, threshold: 199 }])],
      fills: [fill('atta', 'zepto', 180), { ...step, cost: 199 }],
    };
    const r = await planBasket(input);
    // 5 kg alone: ₹180 + ₹30 delivery = ₹210. The step-up: ₹199, delivery free.
    expect(r.best?.total).toBe(199);
    expect(r.best?.orders[0]?.lines[0]?.fill.stepUp).toBe(true);
  });

  it('keeps the cheaper pack when the step-up costs more than the fee it avoids', async () => {
    const input: PlanInput = {
      rows: [{ id: 'atta', label: 'atta', brandLocked: false }],
      platforms: [platform('zepto', [{ kind: 'below', label: 'Delivery', amount: 30, threshold: 199 }])],
      fills: [fill('atta', 'zepto', 150), { ...fill('atta', 'zepto', 205), quantity: 1.2, stepUp: true }],
    };
    const r = await planBasket(input);
    expect(r.best?.total).toBe(180);
    expect(r.best?.orders[0]?.lines[0]?.fill.stepUp).toBeFalsy();
  });

  it('moves an item to a dearer app when that clears free delivery (the onion example)', async () => {
    const input: PlanInput = {
      rows: ['atta', 'butter', 'eggs', 'onion'].map((id) => ({ id, label: id, brandLocked: false })),
      platforms: [platform('zepto', QUICK), platform('blinkit', QUICK)],
      fills: [fill('atta', 'zepto', 80), fill('butter', 'zepto', 60), fill('eggs', 'zepto', 49), fill('onion', 'zepto', 44), fill('onion', 'blinkit', 40)],
    };
    const r = await planBasket(input);
    expect(r.solver.status).toBe('optimal');
    expect(r.best?.orders).toHaveLength(1);
    expect(r.best?.total).toBe(242); // 233 of items + ₹9 handling; greedy would pay 307
    const onion = r.best!.orders[0]!.lines.find((l) => l.itemId === 'onion')!;
    expect(onion.why).toMatch(/Blinkit/);
    expect(onion.why).toMatch(/₹4/);
    expect(onion.why).toMatch(/₹199/);
  });

  it('never splits when every order pays the same flat fee and the saving is smaller', async () => {
    const flat: FeeRule[] = [{ kind: 'flat', label: 'Home delivery', amount: 49 }];
    const r = await planBasket({
      rows: [{ id: 'a', label: 'a', brandLocked: false }, { id: 'b', label: 'b', brandLocked: false }],
      platforms: [platform('dmart', flat), platform('jiomart', flat)],
      fills: [fill('a', 'dmart', 100), fill('b', 'dmart', 120), fill('a', 'jiomart', 110), fill('b', 'jiomart', 90)],
    });
    // split would be 100 + 90 + 49 + 49 = 288; one order on DMart 220 + 49 = 269; JioMart 200 + 49 = 249
    expect(r.best?.total).toBe(249);
    expect(r.best?.orders).toHaveLength(1);
  });

  it('charges a stacked small-cart fee to a tiny order', async () => {
    const blinkit: FeeRule[] = [
      { kind: 'flat', label: 'Handling', amount: 4 },
      { kind: 'below', label: 'Delivery', amount: 30, threshold: 199 },
      { kind: 'below', label: 'Small cart', amount: 20, threshold: 99 },
    ];
    const r = await planBasket({ rows: [{ id: 'a', label: 'a', brandLocked: false }], platforms: [platform('blinkit', blinkit)], fills: [fill('a', 'blinkit', 50)] });
    expect(r.best?.total).toBe(104);
    expect(r.best?.orders[0]?.fees.map((f) => f.label)).toEqual(['Handling', 'Delivery', 'Small cart']);
  });

  it('includes the only app that sells an item, even though it adds an order', async () => {
    const r = await planBasket({
      rows: [{ id: 'a', label: 'a', brandLocked: false }, { id: 'rare', label: 'rare', brandLocked: false }],
      platforms: [platform('zepto', QUICK), platform('blinkit', QUICK)],
      fills: [fill('a', 'zepto', 300), fill('rare', 'blinkit', 20)],
    });
    expect(r.best?.orders.map((o) => o.platformId).sort()).toEqual(['blinkit', 'zepto']);
  });

  it('treats an app whose minimum order cannot be reached as unavailable for its items', async () => {
    const r = await planBasket({
      rows: [{ id: 'a', label: 'a', brandLocked: false }, { id: 'only-dmart', label: 'x', brandLocked: false }],
      platforms: [platform('zepto', QUICK), platform('dmart', [{ kind: 'flat', label: 'Home delivery', amount: 49 }], 200)],
      fills: [fill('a', 'zepto', 250), fill('only-dmart', 'dmart', 50)],
    });
    expect(r.unavailable).toEqual(['only-dmart']);
    expect(r.best?.orders.map((o) => o.platformId)).toEqual(['zepto']);
  });

  it('prefers fewer orders when totals tie exactly', async () => {
    const r = await planBasket({
      rows: [{ id: 'a', label: 'a', brandLocked: false }, { id: 'b', label: 'b', brandLocked: false }],
      platforms: [platform('zepto', []), platform('blinkit', [])],
      fills: [fill('a', 'zepto', 100), fill('b', 'zepto', 100), fill('a', 'blinkit', 100), fill('b', 'blinkit', 100)],
    });
    expect(r.best?.orders).toHaveLength(1);
    expect(r.best?.total).toBe(200);
  });

  it('offers fewer-order plans that never undercut the best plan', async () => {
    const r = await planBasket({
      rows: ['a', 'b', 'c'].map((id) => ({ id, label: id, brandLocked: false })),
      platforms: [platform('zepto', []), platform('blinkit', []), platform('instamart', [])],
      fills: [
        fill('a', 'zepto', 100), fill('a', 'blinkit', 130), fill('a', 'instamart', 130),
        fill('b', 'zepto', 130), fill('b', 'blinkit', 100), fill('b', 'instamart', 130),
        fill('c', 'zepto', 130), fill('c', 'blinkit', 130), fill('c', 'instamart', 100),
      ],
    });
    expect(r.best?.orders).toHaveLength(3);
    expect(r.fewerOrders.map((p) => p.orders.length)).toEqual([2, 1]);
    expect(r.fewerOrders.map((p) => p.total)).toEqual([330, 360]);
  });

  it('computes each single-app plan and the cheapest complete one as the baseline', async () => {
    const r = await planBasket({
      rows: ['a', 'b'].map((id) => ({ id, label: id, brandLocked: false })),
      platforms: [platform('zepto', []), platform('blinkit', [])],
      fills: [fill('a', 'zepto', 100), fill('b', 'zepto', 100), fill('a', 'blinkit', 90)],
    });
    const blinkit = r.singleApp.find((s) => s.platformId === 'blinkit')!;
    expect(blinkit.missing).toEqual(['b']);
    expect(r.baseline).toEqual({ platformId: 'zepto', total: 200 });
  });

  it('nudges a locked brand only when switching saves at least ₹5', async () => {
    const r = await planBasket({
      rows: [{ id: 'atta', label: 'Aashirvaad atta', brandLocked: true }, { id: 'oil', label: 'oil', brandLocked: true }],
      platforms: [platform('zepto', [])],
      fills: [fill('atta', 'zepto', 262, 'Aashirvaad Atta'), fill('oil', 'zepto', 150, 'Fortune Oil')],
      unlockedFills: [fill('atta', 'zepto', 239, 'Fortune Chakki Atta'), fill('oil', 'zepto', 147, 'Gemini Oil')],
    });
    expect(r.nudges).toHaveLength(1);
    expect(r.nudges[0]).toMatchObject({ itemId: 'atta', saving: 23, fromLabel: 'Aashirvaad Atta' });
    expect(r.nudges[0]?.fill.label).toBe('Fortune Chakki Atta');
  });

  it('warns when a demand-driven peak threshold would make the plan dearer', async () => {
    const zepto = platform('zepto', [{ kind: 'below', label: 'Delivery', amount: 30, threshold: 199 }], null, [
      { id: 'peak', label: 'Peak demand', rules: [{ kind: 'below', label: 'Delivery', amount: 30, threshold: 299 }] },
    ]);
    const r = await planBasket({ rows: [{ id: 'a', label: 'a', brandLocked: false }], platforms: [zepto], fills: [fill('a', 'zepto', 250)] });
    expect(r.peak).toEqual([expect.objectContaining({ platformId: 'zepto', extraCost: 30 })]);
  });

  it('returns an empty result when nothing can be bought', async () => {
    const r = await planBasket({ rows: [{ id: 'a', label: 'a', brandLocked: false }], platforms: [platform('zepto', QUICK)], fills: [] });
    expect(r.best).toBeNull();
    expect(r.unavailable).toEqual(['a']);
    expect(r.solver.status).toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// The exact solver must agree with exhaustive enumeration on every basket.
// ---------------------------------------------------------------------------

const ruleArb: fc.Arbitrary<FeeRule[]> = fc
  .record({
    flat: fc.integer({ min: 0, max: 12 }),
    deliveryAt: fc.integer({ min: 60, max: 450 }),
    delivery: fc.integer({ min: 0, max: 60 }),
    smallAt: fc.integer({ min: 20, max: 150 }),
    small: fc.integer({ min: 0, max: 30 }),
  })
  .map(({ flat, deliveryAt, delivery, smallAt, small }) => [
    ...(flat ? [{ kind: 'flat' as const, label: 'Handling', amount: flat }] : []),
    { kind: 'below' as const, label: 'Delivery', amount: delivery, threshold: deliveryAt },
    ...(small ? [{ kind: 'below' as const, label: 'Small cart', amount: small, threshold: Math.min(smallAt, deliveryAt) }] : []),
  ]);

const basketArb = fc
  .record({
    rows: fc.integer({ min: 1, max: 6 }),
    apps: fc.integer({ min: 1, max: 4 }),
  })
  .chain(({ rows, apps }) =>
    fc.record({
      rows: fc.constant(rows),
      apps: fc.array(
        fc.record({ rules: ruleArb, minOrder: fc.option(fc.integer({ min: 50, max: 250 }), { nil: null }) }),
        { minLength: apps, maxLength: apps },
      ),
      // cost of up to two fills per (row, app); 0 = not sold there
      costs: fc.array(fc.array(fc.array(fc.integer({ min: 0, max: 300 }), { minLength: 2, maxLength: 2 }), { minLength: apps, maxLength: apps }), {
        minLength: rows,
        maxLength: rows,
      }),
    }),
  );

function inputFrom(b: fc.Arbitrary<unknown> extends never ? never : any): PlanInput {
  const platforms = b.apps.map((a: { rules: FeeRule[]; minOrder: number | null }, j: number) => platform(IDS[j]!, a.rules, a.minOrder));
  const fills: Fill[] = [];
  b.costs.forEach((perApp: number[][], i: number) =>
    perApp.forEach((pair: number[], j: number) =>
      pair.forEach((cost: number, k: number) => {
        if (cost > 0) fills.push(fill(`r${i}`, IDS[j]!, cost + k * 0.5, `r${i}-${k}`));
      }),
    ),
  );
  return { rows: Array.from({ length: b.rows }, (_, i) => ({ id: `r${i}`, label: `r${i}`, brandLocked: false })), platforms, fills };
}

describe('solveExact agrees with brute force', () => {
  it('on random baskets, for the best plan and every order limit', async () => {
    await fc.assert(
      fc.asyncProperty(basketArb, async (b) => {
        const input = inputFrom(b);
        const problem = buildProblem(input.rows.map((r) => r.id), input.platforms, input.fills);
        for (const maxOrders of [undefined, 1, 2]) {
          const exact = await solveExact(problem, { maxOrders });
          const brute = bruteForce(problem, { maxOrders });
          if (brute === null) {
            expect(exact).toBeNull();
          } else {
            expect(exact).not.toBeNull();
            expect(exact!.total).toBeCloseTo(brute.total, 2);
          }
        }
      }),
      { numRuns: 400 },
    );
  }, 120_000);
});

describe('performance', () => {
  it('solves 60 rows × 6 apps × 3 fills quickly', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, label: `r${i}`, brandLocked: false }));
    const platforms = IDS.map((id, j) => platform(id, [
      { kind: 'flat', label: 'Handling', amount: 5 + j },
      { kind: 'below', label: 'Delivery', amount: 30, threshold: 199 + 50 * j },
      { kind: 'below', label: 'Small cart', amount: 20, threshold: 99 },
    ]));
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const fills: Fill[] = [];
    for (const r of rows) for (const p of IDS) for (let k = 0; k < 3; k++) fills.push(fill(r.id, p, Math.round(40 + rand() * 260), `${r.id}-${k}`));
    const problem = buildProblem(rows.map((r) => r.id), platforms, fills);
    await solveExact(problem); // warm the WebAssembly module
    const t0 = performance.now();
    const res = await solveExact(problem);
    const ms = performance.now() - t0;
    expect(res).not.toBeNull();
    expect(ms).toBeLessThan(2000);
  }, 60_000);
});
