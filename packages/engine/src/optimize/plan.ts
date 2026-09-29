/**
 * planBasket: every output the results screen shows, each one a solve of the
 * same model with one change (spec, "Optimizer → Outputs"):
 *
 *   best         the model as is — the cheapest total, however many orders
 *   fewerOrders  Σu ≤ k for k below best's order count — what convenience costs
 *   singleApp    one platform only — the savings baseline and a sanity check
 *   peak         best re-costed under a demand-driven fee variant
 *   nudges       each brand-locked row re-solved unlocked — "switch and save ₹23"
 *
 * Solves run in that priority order against a time budget; if it runs out,
 * the remaining peak checks and nudges are skipped and flagged.
 */
import { withVariant } from '../fees';
import type { BrandSwapNudge, Fill, PeakWarning, Plan, PlanResult, SingleAppPlan } from '../types';
import { explainLine } from './explain';
import { buildProblem, evaluate, round2, toPlan, type PlatformSpec, type Problem } from './problem';
import { solveExact } from './solver';

export interface PlanInput {
  rows: { id: string; label: string; brandLocked: boolean }[];
  platforms: PlatformSpec[];
  /** Candidate fills, already respecting brand locks and pins. */
  fills: Fill[];
  /** For brand-locked rows: the fills if any brand were allowed. */
  unlockedFills?: Fill[];
}

export interface PlanOptions {
  timeBudgetMs?: number;
  /** Intermediate plans while apps are still answering: skip peak checks and nudges. */
  lite?: boolean;
}

const NUDGE_MIN_SAVING = 5;

function planOf(problem: Problem, choice: number[]): Plan {
  return toPlan(problem, choice, (row) => explainLine(problem, choice, row));
}

export async function planBasket(input: PlanInput, opts: PlanOptions = {}): Promise<PlanResult> {
  const started = performance.now();
  const budget = opts.timeBudgetMs ?? 6000;
  const outOfTime = () => performance.now() - started > budget;
  const elapsed = () => Math.round(performance.now() - started);

  // An app whose minimum order cannot be reached even with every row on it is
  // unusable; its items count as unavailable rather than making the plan infeasible.
  const usable = input.platforms.filter((p) => {
    const mov = p.schedule.minOrder;
    if (mov == null) return true;
    const reach = input.rows.reduce((sum, r) => {
      const costs = input.fills.filter((f) => f.itemId === r.id && f.platformId === p.id).map((f) => f.cost);
      return sum + (costs.length ? Math.max(...costs) : 0);
    }, 0);
    return reach >= mov;
  });
  const usableIds = new Set(usable.map((p) => p.id));
  const fills = input.fills.filter((f) => usableIds.has(f.platformId) && f.cost > 0);

  const buyable = input.rows.filter((r) => fills.some((f) => f.itemId === r.id));
  const unavailable = input.rows.filter((r) => !buyable.includes(r)).map((r) => r.id);

  const empty = (status: PlanResult['solver']['status'], message?: string): PlanResult => ({
    best: null,
    fewerOrders: [],
    singleApp: [],
    nudges: [],
    peak: [],
    unavailable,
    baseline: null,
    solver: { status, ms: elapsed(), truncated: false, ...(message ? { message } : {}) },
  });
  if (!buyable.length) return empty('empty');

  const rowIds = buyable.map((r) => r.id);
  const problem = buildProblem(rowIds, usable, fills);

  // --- single-app plans (also the fallback) -----------------------------------
  const singleApp: SingleAppPlan[] = [];
  for (const p of usable) {
    const onP = buyable.filter((r) => fills.some((f) => f.itemId === r.id && f.platformId === p.id));
    const missing = buyable.filter((r) => !onP.includes(r)).map((r) => r.id);
    if (!onP.length) {
      singleApp.push({ platformId: p.id, plan: null, missing, belowMinOrder: false });
      continue;
    }
    const sub = buildProblem(onP.map((r) => r.id), [p], fills.filter((f) => f.platformId === p.id));
    const sol = await solveExact(sub).catch(() => null);
    singleApp.push({ platformId: p.id, plan: sol ? planOf(sub, sol.choice) : null, missing, belowMinOrder: !sol });
  }
  const complete = singleApp.filter((s) => s.plan && s.missing.length === 0);
  const baselineEntry = complete.sort((a, b) => a.plan!.total - b.plan!.total)[0];
  const baseline = baselineEntry ? { platformId: baselineEntry.platformId, total: baselineEntry.plan!.total } : null;

  // --- best --------------------------------------------------------------------
  let best: Awaited<ReturnType<typeof solveExact>> = null;
  try {
    best = await solveExact(problem);
  } catch {
    best = null;
  }
  if (!best) {
    return {
      ...empty('fallback', 'Couldn’t fit every minimum order into one plan — showing single-app totals instead.'),
      singleApp,
      baseline,
    };
  }
  const bestPlan = planOf(problem, best.choice);

  // --- fewer orders ----------------------------------------------------------------
  const fewerOrders: Plan[] = [];
  for (let k = bestPlan.orders.length - 1; k >= 1 && !outOfTime(); k--) {
    const sol = await solveExact(problem, { maxOrders: k }).catch(() => null);
    if (!sol) break;
    fewerOrders.push(planOf(problem, sol.choice));
  }

  let truncated = false;

  // --- peak check -----------------------------------------------------------------------
  const peak: PeakWarning[] = [];
  for (const order of opts.lite ? [] : bestPlan.orders) {
    if (outOfTime()) {
      truncated = true;
      break;
    }
    const j = usable.findIndex((p) => p.id === order.platformId);
    const variant = usable[j]!.schedule.variants.find((v) => v.id === 'peak');
    if (!variant) continue;
    const schedules = usable.map((p, i) => (i === j ? withVariant(p.schedule, 'peak') : p.schedule));
    const underPeak = evaluate(problem, best.choice, schedules);
    const extra = underPeak ? round2(underPeak.total - best.total) : 0;
    if (!underPeak || extra <= 0.009) continue;
    const peakProblem = buildProblem(rowIds, usable.map((p, i) => ({ ...p, schedule: schedules[i]! })), fills);
    const alt = await solveExact(peakProblem).catch(() => null);
    peak.push({
      platformId: order.platformId,
      label: variant.label,
      extraCost: extra,
      alternative: alt && alt.total < underPeak.total - 0.009 ? planOf(peakProblem, alt.choice) : null,
    });
  }

  // --- brand-swap nudges -----------------------------------------------------------
  const nudges: BrandSwapNudge[] = [];
  const unlocked = (input.unlockedFills ?? []).filter((f) => usableIds.has(f.platformId) && f.cost > 0);
  for (const r of opts.lite ? [] : buyable) {
    if (!r.brandLocked) continue;
    const alt = unlocked.filter((f) => f.itemId === r.id);
    if (!alt.length) continue;
    if (outOfTime()) {
      truncated = true;
      break;
    }
    const swapped = buildProblem(rowIds, usable, [...fills.filter((f) => f.itemId !== r.id), ...alt]);
    const sol = await solveExact(swapped).catch(() => null);
    if (!sol) continue;
    const saving = round2(best.total - sol.total);
    if (saving < NUDGE_MIN_SAVING) continue;
    const rowIndex = rowIds.indexOf(r.id);
    const newFill = swapped.options[sol.choice[rowIndex]!]!.fill;
    const oldFill = problem.options[best.choice[rowIndex]!]!.fill;
    nudges.push({ itemId: r.id, fromLabel: oldFill.label, fill: newFill, saving });
  }
  nudges.sort((a, b) => b.saving - a.saving);

  return {
    best: bestPlan,
    fewerOrders,
    singleApp,
    nudges,
    peak,
    unavailable,
    baseline,
    solver: { status: 'optimal', ms: elapsed(), truncated },
  };
}
