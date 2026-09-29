/**
 * Fees as step functions of an order's item subtotal. Every rule shape in the
 * catalog (flat, fee-below-threshold, tiered table) is one, so the optimizer
 * can treat each platform's fees as a handful of tiers.
 *
 * Invariant: a resolved schedule's total fee never rises as the subtotal
 * rises. The optimizer relies on it (see optimize/model.ts); isMonotone()
 * checks it and resolveSchedule() refuses schedules that break it.
 */
import { MEMBERSHIPS } from './catalog';
import type { FeeHints, FeeLine, FeeOverride, FeeRule, FeeSchedule, MembershipId, ResolvedSchedule } from './types';

type HasRules = { rules: FeeRule[] };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ruleAmount(rule: FeeRule, subtotal: number): number {
  switch (rule.kind) {
    case 'flat':
      return rule.amount;
    case 'below':
      return subtotal < rule.threshold ? rule.amount : 0;
    case 'tiered': {
      let amount = 0;
      for (const t of [...rule.tiers].sort((a, b) => a.from - b.from)) if (t.from <= subtotal) amount = t.amount;
      return amount;
    }
  }
}

export function feeLines(s: HasRules, subtotal: number): FeeLine[] {
  const lines: FeeLine[] = [];
  for (const r of s.rules) {
    const amount = ruleAmount(r, subtotal);
    if (amount > 0) lines.push({ label: r.label, amount: round2(amount), approximate: !!r.approximate });
  }
  return lines;
}

export function feeTotal(s: HasRules, subtotal: number): number {
  return round2(s.rules.reduce((sum, r) => sum + ruleAmount(r, subtotal), 0));
}

export function breakpoints(s: HasRules): number[] {
  const pts = new Set<number>([0]);
  for (const r of s.rules) {
    if (r.kind === 'below') pts.add(r.threshold);
    if (r.kind === 'tiered') for (const t of r.tiers) pts.add(t.from);
  }
  return [...pts].filter((p) => p >= 0 && Number.isFinite(p)).sort((a, b) => a - b);
}

/** The fee as tiers: from each breakpoint up to the next, the fee is constant. */
export function feeTiers(s: HasRules): { from: number; fee: number }[] {
  return breakpoints(s).map((from) => ({ from, fee: feeTotal(s, from) }));
}

export function isMonotone(s: HasRules): boolean {
  const tiers = feeTiers(s);
  return tiers.every((t, i) => i === 0 || t.fee <= tiers[i - 1]!.fee + 1e-9);
}

/** Replaces rules that share a label with the variant's, and adds the rest. */
export function withVariant<T extends FeeSchedule | ResolvedSchedule>(s: T, id: 'peak' | 'late_night'): T {
  const v = s.variants.find((x) => x.id === id);
  if (!v) return s;
  const labels = new Set(v.rules.map((r) => r.label));
  return {
    ...s,
    rules: [...s.rules.filter((r) => !labels.has(r.label)), ...v.rules],
    minOrder: v.minOrder !== undefined ? v.minOrder : s.minOrder,
  };
}

function istMinutes(now: Date): number {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function inWindow(now: Date, w: { from: string; to: string }): boolean {
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return h! * 60 + (m ?? 0);
  };
  const t = istMinutes(now);
  const from = toMin(w.from);
  const to = toMin(w.to);
  return from <= to ? t >= from && t < to : t >= from || t < to;
}

function setRule(rules: FeeRule[], label: string, patch: (r: FeeRule | undefined) => FeeRule | null): FeeRule[] {
  const i = rules.findIndex((r) => r.label === label);
  const next = patch(i >= 0 ? rules[i] : undefined);
  const out = rules.filter((_, j) => j !== i);
  if (next) out.splice(i >= 0 ? i : out.length, 0, next);
  return out;
}

export interface ResolveOptions {
  memberships?: MembershipId[];
  hints?: FeeHints;
  overrides?: FeeOverride[];
  now?: Date;
}

/**
 * Catalog → live hints → memberships → time-of-day variants → the user's own
 * numbers. Later layers win, and the user always has the last word.
 */
export function resolveSchedule(s: FeeSchedule, opts: ResolveOptions = {}): ResolvedSchedule {
  let rules = s.rules.map((r) => ({ ...r }));
  let minOrder = s.minOrder;
  const provenance: ResolvedSchedule['provenance'] = ['catalog'];

  const h = opts.hints;
  const hasHint =
    !!h &&
    (h.minOrder !== undefined ||
      [h.freeDeliveryAbove, h.deliveryFee, h.handlingFee, h.smallCartFee, h.smallCartBelow, h.surgeFee, h.packagingFee, h.platformFee].some((v) => v != null));
  if (h && hasHint) {
    if (h.minOrder !== undefined) minOrder = h.minOrder;
    if (h.freeDeliveryAbove != null || h.deliveryFee != null) {
      rules = setRule(rules, 'Delivery', (r) => {
        const prev = r?.kind === 'below' ? r : undefined;
        const amount = h.deliveryFee ?? prev?.amount;
        const threshold = h.freeDeliveryAbove ?? prev?.threshold;
        if (amount == null || threshold == null) return r ?? null;
        return { kind: 'below', label: 'Delivery', amount, threshold };
      });
    }
    if (h.handlingFee != null) {
      const amount = h.handlingFee;
      rules = setRule(rules, 'Handling', () => (amount > 0 ? { kind: 'flat', label: 'Handling', amount } : null));
    }
    if (h.smallCartFee != null || h.smallCartBelow != null) {
      rules = setRule(rules, 'Small cart', (r) => {
        const prev = r?.kind === 'below' ? r : undefined;
        const amount = h.smallCartFee ?? prev?.amount;
        const threshold = h.smallCartBelow ?? prev?.threshold;
        if (amount == null || threshold == null) return r ?? null;
        return amount > 0 ? { kind: 'below', label: 'Small cart', amount, threshold } : null;
      });
    }
    for (const [label, amount] of [['Packaging', h.packagingFee], ['Platform', h.platformFee]] as const) {
      if (amount != null) rules = setRule(rules, label, () => (amount > 0 ? { kind: 'flat', label, amount } : null));
    }
    if (h.surgeFee != null && h.surgeFee > 0) {
      const amount = h.surgeFee;
      rules = setRule(rules, 'Surge (right now)', () => ({ kind: 'flat', label: 'Surge (right now)', amount }));
    }
    provenance.unshift('live');
  }

  for (const m of MEMBERSHIPS) {
    if (m.platformId !== s.platformId || !opts.memberships?.includes(m.membershipId)) continue;
    for (const c of m.changes) {
      rules = setRule(rules, c.rule, (r) => {
        if (!r || c.remove) return null;
        return r.kind === 'below' && c.threshold !== undefined ? { ...r, threshold: c.threshold } : r;
      });
    }
  }

  const now = opts.now ?? new Date();
  for (const v of s.variants) {
    if (v.id === 'late_night' && v.window && inWindow(now, v.window)) {
      const labels = new Set(v.rules.map((r) => r.label));
      rules = [...rules.filter((r) => !labels.has(r.label)), ...v.rules];
    }
  }

  const o = opts.overrides?.find((x) => x.platformId === s.platformId);
  if (o) {
    if (o.deliveryFee !== undefined || o.freeDeliveryAbove !== undefined) {
      rules = setRule(rules, 'Delivery', (r) => {
        const prev = r?.kind === 'below' ? r : undefined;
        const amount = o.deliveryFee ?? prev?.amount ?? 0;
        const threshold = o.freeDeliveryAbove ?? prev?.threshold ?? Number.MAX_SAFE_INTEGER;
        return amount > 0 ? { kind: 'below', label: 'Delivery', amount, threshold } : null;
      });
    }
    if (o.handlingFee !== undefined) {
      rules = setRule(rules, 'Handling', () => (o.handlingFee! > 0 ? { kind: 'flat', label: 'Handling', amount: o.handlingFee! } : null));
    }
    if (o.smallCartFee !== undefined || o.smallCartBelow !== undefined) {
      rules = setRule(rules, 'Small cart', (r) => {
        const prev = r?.kind === 'below' ? r : undefined;
        const amount = o.smallCartFee ?? prev?.amount ?? 0;
        const threshold = o.smallCartBelow ?? prev?.threshold ?? 0;
        return amount > 0 && threshold > 0 ? { kind: 'below', label: 'Small cart', amount, threshold } : null;
      });
    }
    if (o.minOrder !== undefined) minOrder = o.minOrder;
    provenance.unshift('override');
  }

  const resolved: ResolvedSchedule = {
    platformId: s.platformId,
    minOrder,
    rules,
    variants: s.variants.filter((v) => v.id === 'peak'),
    notes: s.notes,
    checkedAt: s.checkedAt,
    provenance,
  };
  if (!isMonotone(resolved)) {
    throw new Error(`${s.platformId}: fees would rise with the order value; check the fee override`);
  }
  return resolved;
}
