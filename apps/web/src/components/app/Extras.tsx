'use client';

import { ArrowsLeftRightIcon, CaretDownIcon, CloudLightningIcon, MagnifyingGlassIcon, PlugsIcon, SparkleIcon } from '@phosphor-icons/react';
import { formatRupees, itemFor, PLATFORMS, type ListRow, type PlanResult, type PlatformId, type PlatformStatus } from '@gc/engine';
import type { PlatformResult } from '@/lib/compare-types';
import { PlatformBadge } from './PlatformBadge';
import { ProductThumb } from './ProductThumb';

const STATUS_WHY: Record<PlatformStatus, string> = {
  ok: 'answered',
  no_results: 'had none of your list',
  blocked: 'blocked us',
  timeout: 'too slow',
  unserviceable: 'doesn’t deliver here',
  error: 'had a hiccup',
};

/** The app never answered (as opposed to answering "none" or "not here"). */
const DIDNT_ANSWER: PlatformStatus[] = ['blocked', 'timeout', 'error'];

const andList = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`);

interface Props {
  result: PlanResult;
  rows: ListRow[];
  results: Partial<Record<PlatformId, PlatformResult>>;
  platforms: PlatformId[];
  rowsMeta: { id: string; brand: string | null; brandLocked: boolean }[];
  onAnyBrand: (itemId: string) => void;
  onPin: (itemId: string, platformId: PlatformId, listingId: string) => void;
  onShowPeakPlan: (i: number) => void;
}

function Group({ tone, icon, title, children }: { tone: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line p-3.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className={`grid size-6 place-items-center rounded-md bg-soft ${tone}`}>{icon}</span>
        {title}
      </h3>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * Everything after the plan, folded away: brand swaps, peak hours, items not
 * found, apps skipped. Only "X didn't answer" stays out, as one line.
 */
export function Extras({ result, rows, results, platforms, rowsMeta, onAnyBrand, onPin, onShowPeakPlan }: Props) {
  const text = (id: string) => rows.find((r) => r.id === id)?.text ?? id;
  const unreachable = platforms.filter((p) => results[p] && results[p]!.status !== 'ok');
  const silent = unreachable.filter((p) => DIDNT_ANSWER.includes(results[p]!.status));

  const notFound = result.unavailable.map((id) => {
    const meta = rowsMeta.find((m) => m.id === id);
    const anyBrandOffers = platforms
      .map((p) => ({ p, fill: results[p]?.perRow[id]?.unlockedFills[0] }))
      .filter((x) => x.fill)
      .sort((a, b) => a.fill!.cost - b.fill!.cost);
    const possible = platforms.flatMap((p) => (results[p]?.perRow[id]?.possible ?? []).slice(0, 2).map((m) => ({ p, m })));
    return { id, meta, anyBrandOffers, possible };
  });

  // Nudges come biggest saving first.
  const topSaving = result.nudges[0]?.saving ?? 0;
  const notes = result.nudges.length + result.peak.length + notFound.length + (unreachable.length - silent.length);

  return (
    <div className="grid gap-3">
      {silent.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-muted" title="The plan only uses apps that answered.">
          <PlugsIcon size={16} className="shrink-0 text-warn" aria-hidden />
          {andList(silent.map((p) => PLATFORMS[p].name))} didn’t answer — skipped.
        </p>
      )}

      {notes > 0 && (
        <details className="group rounded-2xl border border-line bg-card shadow-card" open={!result.best}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-medium transition-colors group-open:rounded-b-none hover:bg-soft/60 [&::-webkit-details-marker]:hidden">
            More savings &amp; notes
            {topSaving > 0 && <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good">save {formatRupees(topSaving)}</span>}
            {notFound.length > 0 && (
              <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">{notFound.length} not found</span>
            )}
            <CaretDownIcon size={16} className="ml-auto text-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>

          <div className="grid grid-cols-1 gap-3 border-t border-line p-3 sm:p-4 lg:grid-cols-2">
            {result.nudges.length > 0 && (
              <Group tone="text-good" icon={<ArrowsLeftRightIcon size={14} />} title="Swap a brand">
                {result.nudges.map((n) => (
                  <div key={n.itemId} className="flex items-center gap-3" title={`instead of ${n.fromLabel}`}>
                    <ProductThumb src={n.fill.imageUrl} emoji={itemFor(text(n.itemId))?.emoji ?? '🛒'} size="md" />
                    <p className="min-w-0 flex-1 text-sm leading-snug">
                      <span className="line-clamp-2 font-medium">{n.fill.label}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {PLATFORMS[n.fill.platformId].name} · {n.fill.packLabel}
                      </span>
                    </p>
                    <button type="button" onClick={() => onAnyBrand(n.itemId)} className="press shrink-0 rounded-full border border-good-line bg-good-soft px-2.5 py-1 text-xs font-medium text-good">
                      save {formatRupees(n.saving)}
                    </button>
                  </div>
                ))}
              </Group>
            )}

            {result.peak.length > 0 && (
              <Group tone="text-warn" icon={<CloudLightningIcon size={14} />} title="Peak hours">
                {result.peak.map((w, i) => (
                  <div
                    key={w.platformId}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                    title={`At peak demand ${PLATFORMS[w.platformId].name} raises its free-delivery bar.`}
                  >
                    <span>
                      {PLATFORMS[w.platformId].name}: <span className="font-semibold tabular-nums">+{formatRupees(w.extraCost)}</span>
                    </span>
                    {w.alternative && (
                      <button type="button" onClick={() => onShowPeakPlan(i)} className="font-medium text-good underline decoration-good/40 underline-offset-2 hover:decoration-good">
                        peak-proof plan · {formatRupees(w.alternative.total)}
                      </button>
                    )}
                  </div>
                ))}
              </Group>
            )}

            {notFound.length > 0 && (
              <Group tone="text-muted" icon={<MagnifyingGlassIcon size={14} />} title="Not found nearby">
                {notFound.map(({ id, meta, anyBrandOffers, possible }) => (
                  <div key={id} className="text-sm">
                    <p className="font-medium">
                      {itemFor(text(id))?.emoji ?? '🛒'} {text(id)}
                    </p>
                    {meta?.brandLocked && anyBrandOffers[0] ? (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="min-w-0 text-xs text-muted" title={anyBrandOffers[0].fill!.label}>
                          No {meta.brand}. Any brand: <span className="font-medium text-fg tabular-nums">{formatRupees(anyBrandOffers[0].fill!.cost)}</span> on{' '}
                          {PLATFORMS[anyBrandOffers[0].p].name}
                        </span>
                        <button type="button" onClick={() => onAnyBrand(id)} className="press flex shrink-0 items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs font-medium hover:bg-soft">
                          <SparkleIcon size={12} weight="fill" className="text-good" /> any brand
                        </button>
                      </div>
                    ) : possible.length === 0 ? (
                      <p className="mt-0.5 text-xs text-muted">No match — try a simpler name.</p>
                    ) : null}
                    {possible.length > 0 && (
                      <ul className="mt-1.5 flex flex-col gap-1.5">
                        {possible.map(({ p, m }) => (
                          <li key={`${p}:${m.listingId}`} className="flex items-center gap-2">
                            <ProductThumb src={m.imageUrl} emoji={itemFor(text(id))?.emoji ?? '🛒'} size="sm" />
                            <PlatformBadge id={p} size="sm" />
                            <span className="min-w-0 flex-1 truncate text-xs" title={m.reason ?? m.title}>
                              {m.title} <span className="text-muted">({m.quantityText})</span>
                            </span>
                            <span className="text-xs tabular-nums">{formatRupees(m.price)}</span>
                            <button
                              type="button"
                              onClick={() => onPin(id, p, m.listingId)}
                              className="btn-secondary h-7 px-2 text-xs"
                            >
                              use this
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </Group>
            )}

            {unreachable.length > 0 && (
              <Group tone="text-muted" icon={<PlugsIcon size={14} />} title="Apps skipped">
                {unreachable.map((p) => (
                  <div key={p} className="flex items-center gap-2 text-sm">
                    <PlatformBadge id={p} size="sm" />
                    <span className="text-muted">{STATUS_WHY[results[p]!.status]}</span>
                  </div>
                ))}
              </Group>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
