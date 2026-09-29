/**
 * "Why is this here?" — for a line that is not on its cheapest app, the
 * counterfactual of moving it there with everything else held still, told in
 * one sentence: "Blinkit sells it ₹4 cheaper, but moving it drops Zepto below
 * ₹199 (+₹30 delivery) and would open a separate Blinkit order (+₹39 in fees)."
 */
import { feeTotal, ruleAmount } from '../fees';
import { formatRupees } from '../format';
import { PLATFORMS } from '../platforms';
import type { ResolvedSchedule } from '../types';
import { round2, subtotals, type Problem } from './problem';

function newlyCharged(schedule: ResolvedSchedule, before: number, after: number): string[] {
  const out: string[] = [];
  for (const r of schedule.rules) {
    const extra = ruleAmount(r, after) - ruleAmount(r, before);
    if (extra > 0.009) out.push(`+${formatRupees(extra)} ${r.label.toLowerCase()}`);
  }
  return out;
}

/** The threshold crossed when a subtotal drops from `before` to `after`. */
function crossedThreshold(schedule: ResolvedSchedule, before: number, after: number): number | null {
  let best: number | null = null;
  for (const r of schedule.rules) {
    const points = r.kind === 'below' ? [r.threshold] : r.kind === 'tiered' ? r.tiers.map((t) => t.from) : [];
    for (const t of points) if (after < t && t <= before && (best === null || t > best)) best = t;
  }
  return best;
}

export function explainLine(problem: Problem, choice: number[], row: number): string | null {
  const current = problem.options[choice[row]!]!;
  let cheapest = current;
  for (const o of problem.byRow[row]!) {
    const opt = problem.options[o]!;
    if (opt.fill.cost < cheapest.fill.cost - 0.009) cheapest = opt;
  }
  if (cheapest === current) return null;

  const s = subtotals(problem, choice);
  const saving = round2(current.fill.cost - cheapest.fill.cost);
  const p = current.platform;
  const q = cheapest.platform;
  const P = problem.platforms[p]!;
  const Q = problem.platforms[q]!;
  const pName = PLATFORMS[P.id].name;
  const qName = PLATFORMS[Q.id].name;
  const parts: string[] = [];

  if (p === q) {
    // A dearer pack on the same app: it keeps this order over a threshold.
    const before = s[p]!;
    const after = round2(before - current.fill.cost + cheapest.fill.cost);
    const crossed = crossedThreshold(P.schedule, before, after);
    const charged = newlyCharged(P.schedule, before, after);
    if (crossed !== null && charged.length) parts.push(`the cheaper pack drops ${pName} below ${formatRupees(crossed)} (${charged.join(', ')})`);
    if (P.schedule.minOrder != null && after < P.schedule.minOrder) parts.push(`${pName}’s minimum order is ${formatRupees(P.schedule.minOrder)}`);
    return parts.length ? `A ${formatRupees(saving)} cheaper pack exists, but ${parts.join(' and ')}.` : null;
  }

  const beforeP = s[p]!;
  const afterP = round2(beforeP - current.fill.cost);
  if (afterP > 0) {
    const crossed = crossedThreshold(P.schedule, beforeP, afterP);
    const charged = newlyCharged(P.schedule, beforeP, afterP);
    if (crossed !== null && charged.length) parts.push(`moving it drops ${pName} below ${formatRupees(crossed)} (${charged.join(', ')})`);
    if (P.schedule.minOrder != null && afterP < P.schedule.minOrder) parts.push(`${pName} would fall under its ${formatRupees(P.schedule.minOrder)} minimum order`);
  }

  const beforeQ = s[q]!;
  if (beforeQ <= 0) {
    const fees = feeTotal(Q.schedule, cheapest.fill.cost);
    parts.push(`would open a separate ${qName} order${fees > 0 ? ` (+${formatRupees(fees)} in fees)` : ''}`);
    if (Q.schedule.minOrder != null && cheapest.fill.cost < Q.schedule.minOrder) {
      parts.push(`${qName}’s minimum order is ${formatRupees(Q.schedule.minOrder)}`);
    }
  }

  if (!parts.length) return null;
  return `${qName} sells it ${formatRupees(saving)} cheaper, but ${parts.join(' and ')}.`;
}
