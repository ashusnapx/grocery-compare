'use client';

import { formatRupees, itemFor, type Plan, type PlatformId } from '@gc/engine';
import type { PlatformResult } from '@/lib/compare-types';
import { PlatformBadge } from './PlatformBadge';

interface Props {
  rows: { id: string; text: string }[];
  platforms: PlatformId[];
  results: Partial<Record<PlatformId, PlatformResult>>;
  plan: Plan;
}

/**
 * Every price the optimizer saw: rows × apps, with the plan's picks
 * highlighted. The receipts say what to buy; this shows the working.
 */
export function PriceGrid({ rows, platforms, results, plan }: Props) {
  const picked = new Map<string, PlatformId>();
  for (const o of plan.orders) for (const l of o.lines) picked.set(l.itemId, o.platformId);
  const orderBy = new Map(plan.orders.map((o) => [o.platformId, o]));
  const cols = platforms.filter((p) => results[p]);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <div className="scrollbar-none overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-soft">
              <th className="sticky left-0 z-10 bg-soft px-4 py-3 text-left text-xs font-medium text-muted">Item</th>
              {cols.map((p) => (
                <th key={p} className="px-3 py-3 text-left">
                  <PlatformBadge id={p} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cheapest = Math.min(
                ...cols.map((p) => results[p]?.perRow[r.id]?.fills[0]?.cost ?? Number.POSITIVE_INFINITY),
              );
              return (
                <tr key={r.id} className="border-b border-line">
                  <th className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-medium">
                    <span className="mr-1.5">{itemFor(r.text)?.emoji ?? '🛒'}</span>
                    {r.text}
                  </th>
                  {cols.map((p) => {
                    const res = results[p]!;
                    const fill = res.perRow[r.id]?.fills[0];
                    const chosen = picked.get(r.id) === p;
                    if (res.status !== 'ok' && !fill) {
                      return (
                        <td key={p} className="px-3 py-3 text-xs text-muted">
                          —
                        </td>
                      );
                    }
                    if (!fill) {
                      return (
                        <td key={p} className="px-3 py-3 text-xs text-muted" title="Not found here">
                          none
                        </td>
                      );
                    }
                    const isMin = fill.cost === cheapest;
                    return (
                      <td key={p} className="px-2 py-2 align-top">
                        <div
                          className={`rounded-lg px-2.5 py-1.5 ${chosen ? 'bg-good-soft ring-1 ring-good-line ring-inset' : ''}`}
                          title={fill.label}
                        >
                          <span
                            className={`font-semibold tabular-nums ${chosen ? 'text-good' : ''} ${isMin && !chosen ? 'underline decoration-muted/60 decoration-[1.5px] underline-offset-4' : ''}`}
                          >
                            {formatRupees(fill.cost)}
                          </span>
                          <span className="block max-w-[9rem] truncate text-[0.7rem] text-muted">{fill.packLabel}</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {(['subtotal', 'fees', 'total'] as const).map((k) => (
              <tr key={k} className={k === 'total' ? 'border-t border-line font-semibold' : ''}>
                <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium text-muted capitalize">{k}</th>
                {cols.map((p) => {
                  const o = orderBy.get(p);
                  const v = !o ? null : k === 'subtotal' ? o.subtotal : k === 'fees' ? o.feesTotal : o.total;
                  return (
                    <td key={p} className={`px-3 py-2 tabular-nums ${k === 'total' ? 'text-sm' : 'text-xs'}`}>
                      {v === null ? <span className="text-muted">·</span> : formatRupees(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      <p
        className="border-t border-line px-4 py-2.5 text-xs text-muted"
        title="The cheapest item price isn’t always the cheapest basket once fees kick in."
      >
        <span className="rounded bg-good-soft px-1 font-medium text-good">green</span> in your plan ·{' '}
        <span className="underline decoration-muted/60 decoration-[1.5px] underline-offset-4">underline</span> cheapest item
      </p>
    </div>
  );
}
