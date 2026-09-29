'use client';

import { ArrowsClockwiseIcon, PlugsIcon, ReceiptIcon, SpinnerGapIcon, TableIcon } from '@phosphor-icons/react';
import { Tabs } from 'radix-ui';
import { useEffect, useMemo, useState } from 'react';
import { dimOf, formatAmount, formatQuantity, formatRupees, PLATFORMS, type ListRow, type Plan, type PlanSettings, type PlatformId } from '@gc/engine';
import type { CompareState, Phase } from './GroceryApp';
import { Extras } from './Extras';
import { OrderCard } from './OrderCard';
import { PlanSummary } from './PlanSummary';
import { PriceGrid } from './PriceGrid';
import { ProgressBoard } from './ProgressBoard';
import { SettingsSheet } from './SettingsSheet';

interface Props {
  state: CompareState;
  phase: Phase;
  rows: ListRow[];
  settings: PlanSettings;
  replanning: boolean;
  onSettings: (s: PlanSettings) => void;
  onAnyBrand: (itemId: string) => void;
  onPin: (itemId: string, platformId: PlatformId, listingId: string) => void;
  onRecompare: () => void;
  /** Drop one app from the plan, from its order card. */
  onRemoveApp?: (platformId: PlatformId) => void;
}

export function Results({ state, phase, rows, settings, replanning, onSettings, onAnyBrand, onPin, onRecompare, onRemoveApp }: Props) {
  const result = state.plan;
  const [planIndex, setPlanIndex] = useState(0);
  const [peakPlan, setPeakPlan] = useState<Plan | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setPlanIndex(0);
    setPeakPlan(null);
  }, [result]);

  const plans = useMemo(() => (result?.best ? [result.best, ...result.fewerOrders] : []), [result]);
  const plan = peakPlan ?? plans[planIndex] ?? null;
  const pending = state.platforms.filter((p) => !state.results[p]).length;

  const row = (id: string) => rows.find((r) => r.id === id);
  const rowText = (id: string) => row(id)?.text ?? id;
  const rowQuantity = (id: string) => {
    const r = row(id);
    return r ? formatAmount(r.amount, r.unit) : '';
  };
  const fillQuantity = (id: string, value: number) => {
    const r = row(id);
    return r ? formatQuantity({ value, dim: dimOf(r.unit) }) : String(value);
  };
  const comparedRows = state.rowsMeta.map((m) => ({ id: m.id, text: rowText(m.id) }));
  // Every app failed the same way: our fetcher is down. The banner says it all.
  const fetcherDown =
    state.final &&
    state.platforms.length > 0 &&
    state.platforms.every((p) => state.results[p]?.status === 'error' && /unreachable|interrupted|ended early/.test(state.results[p]?.error ?? ''));

  return (
    <section className="mt-12 grid grid-cols-1 gap-4 sm:mt-14">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your plan</h2>
        <div className="flex gap-1">
          <SettingsSheet settings={settings} platforms={state.platforms} results={state.results} onChange={onSettings} open={settingsOpen} onOpenChange={setSettingsOpen} />
          <button
            type="button"
            onClick={onRecompare}
            disabled={phase === 'comparing'}
            aria-label="Re-check prices"
            title="Re-check prices"
            className="btn-ghost size-9"
          >
            <ArrowsClockwiseIcon size={18} className={phase === 'comparing' ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <ProgressBoard state={state} phase={phase} />

      {fetcherDown && (
        <div className="flex items-center gap-3 rounded-xl border border-bad-line bg-bad-soft px-4 py-3 text-sm">
          <PlugsIcon size={18} className="shrink-0 text-bad" aria-hidden />
          <span className="flex-1 font-medium">Price fetcher’s down.</span>
          <button type="button" onClick={onRecompare} className="btn-secondary h-8 px-3 text-sm">
            Retry
          </button>
        </div>
      )}

      {result?.best && plan ? (
        <>
          <div className="relative">
            {replanning && (
              <span className="absolute -top-3 right-4 z-10 flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-xs font-medium text-muted shadow-card">
                <SpinnerGapIcon size={13} className="animate-spin" /> re-solving
              </span>
            )}
            <PlanSummary
              fetchedAt={state.startedAt}
              personalFees={state.platforms.filter((p) => state.results[p]?.account === 'used' && !!state.results[p]?.accountFees?.source)}
              liveFees={state.platforms.filter((p) => Object.values(state.results[p]?.feeHints ?? {}).some((v) => v !== null && v !== undefined))}
              result={result}
              plans={peakPlan ? [...plans, peakPlan] : plans}
              planIndex={peakPlan ? plans.length : planIndex}
              onPick={(i) => {
                setPeakPlan(null);
                setPlanIndex(i);
              }}
              itemCount={state.rowsMeta.length}
              final={state.final}
              pending={pending}
            />
          </div>

          <Tabs.Root defaultValue="plan" className="grid gap-4">
            <Tabs.List className="flex w-fit gap-1 rounded-lg bg-soft p-1" aria-label="Plan views">
              {[
                { v: 'plan', label: 'Plan', icon: <ReceiptIcon size={16} /> },
                { v: 'grid', label: 'All prices', icon: <TableIcon size={16} /> },
              ].map((t) => (
                <Tabs.Trigger
                  key={t.v}
                  value={t.v}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-fg data-[state=active]:bg-card data-[state=active]:text-fg data-[state=active]:shadow-card dark:data-[state=active]:bg-line"
                >
                  {t.icon} {t.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content value="plan">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {plan.orders.map((o, i) => (
                  <OrderCard
                    key={`${o.platformId}-${planIndex}-${peakPlan ? 'peak' : ''}`}
                    order={o}
                    index={i}
                    count={plan.orders.length}
                    rowText={rowText}
                    rowQuantity={rowQuantity}
                    fillQuantity={fillQuantity}
                    cartable={o.platformId === 'instamart' && state.results.instamart?.account === 'used'}
                    onRemove={onRemoveApp ? () => onRemoveApp(o.platformId) : undefined}
                  />
                ))}
              </div>
            </Tabs.Content>
            <Tabs.Content value="grid">
              <PriceGrid rows={comparedRows} platforms={state.platforms} results={state.results} plan={plan} />
            </Tabs.Content>
          </Tabs.Root>

          <Extras
            result={result}
            rows={rows}
            results={state.results}
            platforms={state.platforms}
            rowsMeta={state.rowsMeta}
            onAnyBrand={onAnyBrand}
            onPin={onPin}
            onShowPeakPlan={(i) => setPeakPlan(result.peak[i]?.alternative ?? null)}
          />
        </>
      ) : fetcherDown ? null : result && !result.best ? (
        <>
          <div className="rounded-2xl border border-line bg-card p-6 text-center shadow-card">
            <p className="text-lg font-semibold tracking-tight">
              {result.solver.status === 'fallback' ? 'Minimum orders got in the way 😵' : state.final ? 'Nothing to buy here… yet 🫠' : 'Waiting on the apps…'}
            </p>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
              {result.solver.message ?? (state.final ? 'Try simpler names or “any brand”.' : 'First prices on the way.')}
            </p>
            {result.singleApp.some((s) => s.plan) && (
              <ul className="mx-auto mt-4 flex max-w-sm flex-col gap-2 text-left">
                {result.singleApp
                  .filter((s) => s.plan)
                  .map((s) => (
                    <li key={s.platformId} className="flex justify-between rounded-lg bg-soft px-3 py-2 text-sm">
                      <span>{PLATFORMS[s.platformId].name}</span>
                      <span className="font-medium tabular-nums">{formatRupees(s.plan!.total)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <Extras
            result={result}
            rows={rows}
            results={state.results}
            platforms={state.platforms}
            rowsMeta={state.rowsMeta}
            onAnyBrand={onAnyBrand}
            onPin={onPin}
            onShowPeakPlan={() => undefined}
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-card p-8 text-center shadow-card">
          <SpinnerGapIcon size={24} className="mb-1 animate-spin text-muted" />
          <p className="font-medium">Asking every app…</p>
          <p className="text-sm text-muted">5–15 sec</p>
        </div>
      )}
    </section>
  );
}
