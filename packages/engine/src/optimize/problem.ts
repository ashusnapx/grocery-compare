/**
 * The basket problem in the form both solvers share: every (row, platform,
 * fill) option, indexed by row and by platform, plus each platform's fee
 * tiers. A solution picks exactly one option per row.
 */
import { feeLines, feeTiers, feeTotal } from '../fees';
import type { Fill, Order, OrderLine, Plan, PlatformId, ResolvedSchedule } from '../types';

export interface PlatformSpec {
  id: PlatformId;
  schedule: ResolvedSchedule;
  eta: string | null;
}

export interface Option {
  row: number;
  platform: number;
  fill: Fill;
}

export interface Problem {
  rowIds: string[];
  platforms: PlatformSpec[];
  options: Option[];
  byRow: number[][];
  byPlatform: number[][];
  tiers: { from: number; fee: number }[][];
}

export interface Solution {
  /** Option index chosen for each row. */
  choice: number[];
  /** Items plus fees, exact to the paisa (without the tie-break epsilon). */
  total: number;
}

/** Tie-break: among equal totals, prefer fewer orders. Far below a paisa. */
export const ORDER_EPSILON = 0.001;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildProblem(rowIds: string[], platforms: PlatformSpec[], fills: Fill[]): Problem {
  const rowIndex = new Map(rowIds.map((id, i) => [id, i]));
  const platformIndex = new Map(platforms.map((p, j) => [p.id, j]));
  const options: Option[] = [];
  for (const fill of fills) {
    const row = rowIndex.get(fill.itemId);
    const platform = platformIndex.get(fill.platformId);
    if (row === undefined || platform === undefined || !(fill.cost > 0)) continue;
    options.push({ row, platform, fill });
  }
  const byRow: number[][] = rowIds.map(() => []);
  const byPlatform: number[][] = platforms.map(() => []);
  options.forEach((o, i) => {
    byRow[o.row]!.push(i);
    byPlatform[o.platform]!.push(i);
  });
  return { rowIds, platforms, options, byRow, byPlatform, tiers: platforms.map((p) => feeTiers(p.schedule)) };
}

/** Item subtotal per platform for a choice. */
export function subtotals(problem: Problem, choice: number[]): number[] {
  const s = problem.platforms.map(() => 0);
  for (const o of choice) {
    const opt = problem.options[o]!;
    s[opt.platform] = s[opt.platform]! + opt.fill.cost;
  }
  return s.map(round2);
}

/**
 * Total cost of a choice under the given schedules, or null when an order
 * falls below its platform's minimum. Returns the tie-break score as well.
 */
export function evaluate(
  problem: Problem,
  choice: number[],
  schedules: ResolvedSchedule[] = problem.platforms.map((p) => p.schedule),
): { total: number; score: number; orders: number } | null {
  const s = subtotals(problem, choice);
  let total = 0;
  let orders = 0;
  for (let j = 0; j < s.length; j++) {
    const sub = s[j]!;
    if (sub <= 0) continue;
    const sched = schedules[j]!;
    if (sched.minOrder != null && sub < sched.minOrder) return null;
    total += sub + feeTotal(sched, sub);
    orders += 1;
  }
  const t = round2(total);
  return { total: t, score: t + ORDER_EPSILON * orders, orders };
}

/** Turns a choice into the user-facing plan: one order per platform, biggest first. */
export function toPlan(problem: Problem, choice: number[], why: (row: number) => string | null = () => null): Plan {
  const s = subtotals(problem, choice);
  const orders: Order[] = [];
  problem.platforms.forEach((p, j) => {
    const sub = s[j]!;
    if (sub <= 0) return;
    const lines: OrderLine[] = [];
    choice.forEach((o, row) => {
      const opt = problem.options[o]!;
      if (opt.platform === j) lines.push({ itemId: problem.rowIds[row]!, fill: opt.fill, why: why(row) });
    });
    const fees = feeLines(p.schedule, sub);
    const feesTotal = round2(fees.reduce((a, f) => a + f.amount, 0));
    orders.push({ platformId: p.id, lines, subtotal: sub, fees, feesTotal, total: round2(sub + feesTotal), eta: p.eta });
  });
  orders.sort((a, b) => b.subtotal - a.subtotal);
  const itemsTotal = round2(orders.reduce((a, o) => a + o.subtotal, 0));
  const feesTotal = round2(orders.reduce((a, o) => a + o.feesTotal, 0));
  return { orders, itemsTotal, feesTotal, total: round2(itemsTotal + feesTotal) };
}
