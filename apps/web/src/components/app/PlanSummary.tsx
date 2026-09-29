'use client';

import { InfoIcon, SealCheckIcon, ShareNetworkIcon, SpinnerGapIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatRupees, PLATFORMS, type Plan, type PlanResult, type PlatformId } from '@gc/engine';
import { money, track } from '@/lib/analytics';
import { shareOrCopy } from '@/lib/share';

interface Props {
  /** When the prices were fetched, for the "prices from" line. */
  fetchedAt: number;
  /** Apps planned with fees read from the shopper's own account. */
  personalFees: PlatformId[];
  /** Apps whose fees were read live from their own response. */
  liveFees: PlatformId[];
  result: PlanResult;
  plans: Plan[];
  planIndex: number;
  onPick: (i: number) => void;
  itemCount: number;
  final: boolean;
  pending: number;
}

function planChip(plan: Plan, i: number, best: Plan): { title: string; sub: string } {
  const n = plan.orders.length;
  if (i === 0) return { title: 'Cheapest', sub: `${n} order${n === 1 ? '' : 's'} · ${formatRupees(best.total)}` };
  const extra = Math.round((plan.total - best.total) * 100) / 100;
  return { title: `${n} order${n === 1 ? '' : 's'}`, sub: extra > 0 ? `+${formatRupees(extra)}` : 'same price' };
}

const names = (ids: PlatformId[]) => ids.map((p) => PLATFORMS[p].name).join(', ');

/**
 * The headline number. One tiny status line under it; the fee provenance and
 * fetch time sit behind the (i).
 * Test hooks: `[data-testid=plan-status][data-final=true]` once every app is in; `[data-testid=plan-total]`.
 */
export function PlanSummary({ fetchedAt, personalFees, liveFees, result, plans, planIndex, onPick, itemCount, final, pending }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const best = result.best!;
  const plan = plans[planIndex] ?? best;
  const bought = plan.orders.reduce((n, o) => n + o.lines.length, 0);
  const missing = Math.max(0, itemCount - bought);
  const baseline = result.baseline;
  const saving = baseline ? Math.round((baseline.total - plan.total) * 100) / 100 : 0;
  const single = best.orders.length === 1;
  const time = new Date(fetchedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  const liveOnly = liveFees.filter((p) => !personalFees.includes(p));
  const feeSource = [
    liveOnly.length ? `live from ${names(liveOnly)}` : null,
    personalFees.length ? `from your account for ${names(personalFees)}` : null,
    liveOnly.length || personalFees.length ? 'published rules for the rest' : 'each app’s published rules',
  ]
    .filter(Boolean)
    .join(' · ');
  const details = [
    `${bought} of ${itemCount} item${itemCount === 1 ? '' : 's'} · ${formatRupees(plan.itemsTotal)} items + ${formatRupees(plan.feesTotal)} fees across ${plan.orders.length} order${plan.orders.length === 1 ? '' : 's'}`,
    `Fees: ${feeSource}`,
    `Prices fetched ${time}, live at your location`,
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-4 p-5 sm:p-6">
        <div className="min-w-0">
          <motion.p
            key={plan.total}
            data-testid="plan-total"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="text-4xl leading-none font-semibold tracking-tight tabular-nums sm:text-5xl"
          >
            {formatRupees(plan.total)}
          </motion.p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <p
              data-testid="plan-status"
              data-final={final ? 'true' : 'false'}
              title={details.join('\n')}
              className="flex items-center gap-1.5 text-sm text-muted"
            >
              {final ? (
                <>
                  <SealCheckIcon size={16} weight="fill" className="text-good" aria-hidden /> Live · {time} · incl. {formatRupees(plan.feesTotal)} fees
                </>
              ) : (
                <>
                  <SpinnerGapIcon size={15} className="animate-spin" aria-hidden /> Checking {pending} more app{pending === 1 ? '' : 's'}…
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              aria-label="Price details"
              title="Price details"
              className="-my-1 grid size-6 place-items-center rounded-full text-muted transition-colors hover:bg-soft hover:text-fg"
            >
              <InfoIcon size={16} />
            </button>
            {missing > 0 && (
              <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
                {missing} not found
              </span>
            )}
          </div>
          {showDetails && (
            <ul className="mt-2.5 max-w-md space-y-1 text-xs leading-snug text-muted">
              {details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex w-full shrink-0 items-center sm:ml-auto sm:w-auto">
          {saving > 0 && baseline ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="flex flex-1 items-center justify-between gap-3 rounded-xl border border-good-line bg-good-soft px-4 py-3 sm:block sm:flex-none sm:px-5"
            >
              <div>
                <span className="block text-xs font-medium text-good">You save</span>
                <span className="mt-0.5 block text-2xl leading-tight font-semibold tracking-tight text-good tabular-nums sm:text-3xl">{formatRupees(saving)}</span>
                <span className="block text-xs text-muted">vs {PLATFORMS[baseline.platformId].name} alone</span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const apps = plan.orders.map((o) => PLATFORMS[o.platformId].name).join(' + ');
                  const r = await shareOrCopy({
                    title: 'jhola',
                    text: `I’m saving ${formatRupees(saving)} on groceries by splitting my cart across ${apps} with jhola 🛍️`,
                    url: window.location.origin,
                  });
                  if (r === 'copied') toast('Copied — go flex it 😎');
                }}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-good underline-offset-2 hover:underline sm:mt-2"
              >
                <ShareNetworkIcon size={13} /> flex it
              </button>
            </motion.div>
          ) : single ? (
            <div className="rounded-lg bg-soft px-3 py-2 text-sm font-medium text-muted">All from {PLATFORMS[best.orders[0]!.platformId].name}</div>
          ) : !baseline ? (
            <div className="rounded-lg bg-soft px-3 py-2 text-sm font-medium text-muted">No one app has it all</div>
          ) : (
            <div className="rounded-lg bg-soft px-3 py-2 text-sm font-medium text-muted">Same as best single app</div>
          )}
        </div>
      </div>

      {plans.length > 1 && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto border-t border-line px-5 py-3 sm:px-6">
          {plans.map((p, i) => {
            const chip = planChip(p, i, best);
            const active = i === planIndex;
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  track('select_plan', { orders: p.orders.length, extra_cost: money(Math.max(0, p.total - best.total)) });
                  onPick(i);
                }}
                aria-pressed={active}
                className={`press shrink-0 rounded-lg border px-3 py-1.5 text-left ${active ? 'border-accent bg-good-soft ring-1 ring-accent' : 'border-line bg-card hover:bg-soft'}`}
              >
                <span className="block text-sm font-medium">{chip.title}</span>
                <span className="block text-xs text-muted tabular-nums">{chip.sub}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
