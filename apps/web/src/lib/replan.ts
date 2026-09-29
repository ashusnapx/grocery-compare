import type { ListRow, PlanResult, PlanSettings } from '@gc/engine';
import type { PlanRequest, PlatformResult } from './compare-types';

export interface ReplanSource {
  rowsMeta: { id: string; brand: string | null; brandLocked: boolean }[];
  results: Partial<Record<string, PlatformResult>>;
}

/**
 * Builds a stateless re-solve from what the browser already holds: the fills
 * each platform returned, the current brand toggles and settings. Rows the
 * user switched to "any brand" use their unlocked fills.
 */
export function buildPlanRequest(src: ReplanSource, rows: ListRow[], settings: PlanSettings): PlanRequest | null {
  const live = new Map(rows.map((r) => [r.id, r]));
  const metaRows = src.rowsMeta.filter((m) => live.has(m.id));
  if (!metaRows.length) return null;

  const answered = Object.values(src.results).filter(
    (r): r is PlatformResult => !!r && (r.status === 'ok' || Object.values(r.perRow).some((x) => x.fills.length > 0)),
  );
  const unlockedNow = (id: string) => {
    const meta = metaRows.find((m) => m.id === id);
    return !!meta?.brandLocked && !!live.get(id)?.anyBrand;
  };

  return {
    rows: metaRows.map((m) => ({ id: m.id, label: live.get(m.id)!.text, brandLocked: m.brandLocked && !unlockedNow(m.id) })),
    platforms: answered.map((r) => ({ platformId: r.platformId, eta: r.store?.eta ?? null, feeHints: r.feeHints })),
    fills: answered.flatMap((r) =>
      Object.entries(r.perRow)
        .filter(([id]) => live.has(id))
        .flatMap(([id, x]) => (unlockedNow(id) && x.unlockedFills.length ? x.unlockedFills : x.fills)),
    ),
    unlockedFills: answered.flatMap((r) =>
      Object.entries(r.perRow)
        .filter(([id]) => live.has(id))
        .flatMap(([, x]) => x.unlockedFills),
    ),
    // Memberships read from the shopper's accounts during the comparison still apply.
    settings: {
      ...settings,
      memberships: [...new Set([...settings.memberships, ...answered.flatMap((r) => r.accountFees?.memberships ?? [])])],
    },
  };
}

export async function requestPlan(req: PlanRequest): Promise<PlanResult> {
  const res = await fetch('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
  const body = (await res.json()) as PlanResult & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `Re-planning failed (HTTP ${res.status})`);
  return body;
}
