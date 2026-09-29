/**
 * Exhaustive search over every assignment — the oracle the exact solver is
 * tested against, and never used for real baskets (it is exponential).
 */
import { evaluate, type Problem, type Solution } from './problem';

export function bruteForce(problem: Problem, opts: { maxOrders?: number } = {}): Solution | null {
  if (problem.byRow.some((r) => r.length === 0)) return null;
  const n = problem.rowIds.length;
  const minCost = problem.byRow.map((opts) => Math.min(...opts.map((o) => problem.options[o]!.fill.cost)));
  // suffixMin[i] = cheapest possible items cost of rows i..n-1 (fees are ≥ 0, so a valid bound)
  const suffixMin = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffixMin[i] = suffixMin[i + 1]! + minCost[i]!;

  let best: { choice: number[]; score: number; total: number } | null = null;
  const choice = new Array<number>(n);

  const rec = (i: number, itemsSoFar: number) => {
    if (best && itemsSoFar + suffixMin[i]! > best.score) return;
    if (i === n) {
      const ev = evaluate(problem, choice);
      if (!ev) return;
      if (opts.maxOrders !== undefined && ev.orders > opts.maxOrders) return;
      if (!best || ev.score < best.score - 1e-9) best = { choice: [...choice], score: ev.score, total: ev.total };
      return;
    }
    for (const o of problem.byRow[i]!) {
      choice[i] = o;
      rec(i + 1, itemsSoFar + problem.options[o]!.fill.cost);
    }
  };
  rec(0, 0);
  const found = best as { choice: number[]; total: number } | null;
  return found ? { choice: found.choice, total: found.total } : null;
}
