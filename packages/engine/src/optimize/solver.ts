/**
 * The exact solver: the basket as a mixed-integer program, solved by HiGHS
 * (compiled to WebAssembly) — provably the cheapest plan, not a greedy guess.
 *
 *   x[o]   ∈ {0,1}  option o (row, platform, fill) is bought
 *   u[j]   ∈ {0,1}  an order is placed on platform j
 *   z[j,t] ∈ {0,1}  platform j pays fee tier t
 *
 *   minimise  Σ c[o]·x[o] + Σ φ[j,t]·z[j,t] + ε·Σ u[j]
 *   s.t.      Σ_{o∈row i} x[o] = 1                 every row bought exactly once
 *             x[o] ≤ u[j(o)]                       options only on used platforms
 *             u[j] ≤ Σ_{o∈j} x[o]                  no empty orders
 *             Σ_t z[j,t] = u[j]                    a used platform pays one tier
 *             Σ_{o∈j} c[o]·x[o] ≥ Σ_t L[j,t]·z[j,t] a tier needs its subtotal
 *             Σ_{o∈j} c[o]·x[o] ≥ MOV[j]·u[j]      minimum order
 *             Σ_j u[j] ≤ K                         (fewer-order variants only)
 *
 * Because each platform's fee never rises with its subtotal (fees.ts
 * isMonotone), the optimum always claims the highest tier its subtotal
 * reaches, so the fee paid is exactly the fee function — no upper bounds
 * needed. ε breaks exact ties in favour of fewer orders.
 */
import type { LegacyHighs } from 'highs';
import { evaluate, ORDER_EPSILON, type Problem, type Solution } from './problem';

let highsPromise: Promise<LegacyHighs> | null = null;

async function getHighs(): Promise<LegacyHighs> {
  if (!highsPromise) {
    highsPromise = import('highs')
      .then((m) => (m.default as unknown as () => Promise<LegacyHighs>)())
      .catch((e) => {
        highsPromise = null;
        throw e;
      });
  }
  return highsPromise;
}

function num(n: number): string {
  // Coefficients are rupees with paise; 4 decimals is exact for them.
  return Number(n.toFixed(4)).toString();
}

function sum(terms: [number, string][]): string {
  const parts: string[] = [];
  terms.forEach(([c, v], i) => {
    if (c === 0) return;
    const sign = c < 0 ? '-' : '+';
    parts.push(`${i === 0 && sign === '+' ? '' : `${sign} `}${num(Math.abs(c))} ${v}`);
  });
  if (!parts.length) return '0';
  // Wrap long expressions: LP lines continue when the next line starts with a space.
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += 12) lines.push(parts.slice(i, i + 12).join(' '));
  return lines.join('\n   ');
}

export function buildLp(problem: Problem, opts: { maxOrders?: number } = {}): string {
  const obj: [number, string][] = [];
  const cons: string[] = [];
  const binaries: string[] = [];
  const x = (o: number) => `x${o}`;
  const u = (j: number) => `u${j}`;
  const z = (j: number, t: number) => `z${j}_${t}`;

  problem.options.forEach((opt, o) => {
    obj.push([opt.fill.cost, x(o)]);
    binaries.push(x(o));
  });

  const used = problem.platforms.map((_, j) => problem.byPlatform[j]!.length > 0);
  problem.platforms.forEach((p, j) => {
    if (!used[j]) return;
    binaries.push(u(j));
    obj.push([ORDER_EPSILON, u(j)]);
    problem.tiers[j]!.forEach((tier, t) => {
      binaries.push(z(j, t));
      if (tier.fee !== 0) obj.push([tier.fee, z(j, t)]);
    });

    const opts_ = problem.byPlatform[j]!;
    const itemTerms = opts_.map((o) => [problem.options[o]!.fill.cost, x(o)] as [number, string]);
    for (const o of opts_) cons.push(` l${o}: ${x(o)} - ${u(j)} <= 0`);
    cons.push(` e${j}: ${sum([[1, u(j)], ...opts_.map((o) => [-1, x(o)] as [number, string])])} <= 0`);
    cons.push(` t${j}: ${sum([...problem.tiers[j]!.map((_, t) => [1, z(j, t)] as [number, string]), [-1, u(j)]])} = 0`);
    const reach = problem.tiers[j]!.map((tier, t) => [-tier.from, z(j, t)] as [number, string]).filter(([c]) => c !== 0);
    if (reach.length) cons.push(` s${j}: ${sum([...itemTerms, ...reach])} >= 0`);
    const mov = p.schedule.minOrder;
    if (mov != null && mov > 0) cons.push(` m${j}: ${sum([...itemTerms, [-mov, u(j)]])} >= 0`);
  });

  problem.byRow.forEach((opts_, i) => {
    cons.push(` r${i}: ${sum(opts_.map((o) => [1, x(o)] as [number, string]))} = 1`);
  });

  if (opts.maxOrders !== undefined) {
    const us = problem.platforms.map((_, j) => j).filter((j) => used[j]);
    if (us.length) cons.push(` k: ${sum(us.map((j) => [1, u(j)] as [number, string]))} <= ${opts.maxOrders}`);
  }

  return ['Minimize', ` obj: ${sum(obj)}`, 'Subject To', ...cons, 'Binary', ` ${binaries.join(' ')}`, 'End', ''].join('\n');
}

export interface SolveOptions {
  maxOrders?: number;
  timeLimitSec?: number;
}

/** The provably cheapest assignment, or null when none exists (or the solver gave up). */
export async function solveExact(problem: Problem, opts: SolveOptions = {}): Promise<Solution | null> {
  if (!problem.rowIds.length || problem.byRow.some((r) => r.length === 0)) return null;
  const highs = await getHighs();
  const lp = buildLp(problem, opts);
  const result = highs.solve(lp, {
    time_limit: opts.timeLimitSec ?? 2,
    mip_rel_gap: 0,
    mip_abs_gap: 0,
    output_flag: false,
  });
  if (result.Status !== 'Optimal') return null;

  const columns = result.Columns as Record<string, { Primal: number }>;
  const choice = problem.byRow.map((opts_) => {
    let bestO = opts_[0]!;
    let bestV = -1;
    for (const o of opts_) {
      const v = columns[`x${o}`]?.Primal ?? 0;
      if (v > bestV) {
        bestV = v;
        bestO = o;
      }
    }
    return bestO;
  });
  const ev = evaluate(problem, choice);
  return ev ? { choice, total: ev.total } : null;
}
