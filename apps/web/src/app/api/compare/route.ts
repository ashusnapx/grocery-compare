import { parseRow, type Listing, type ListRow, type PlatformId, type PlatformStatus } from '@gc/engine';
import { planBasket } from '@gc/engine/optimize';
import { isAccountPlatform } from '@/lib/account/providers';
import type { CompareEvent, PlatformResult } from '@/lib/compare-types';
import { AccountError, searchAccount } from '@/lib/server/accounts';
import { ENABLED_PLATFORMS } from '@/lib/server/config';
import { searchPlatform } from '@/lib/server/fetcher';
import { platformSpecs, rowResult, sanitize } from '@/lib/server/pipeline';
import { CompareSchema } from '@/lib/server/schemas';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Apps that refuse bursts from one address (Zepto's and DMart's firewalls,
 * Instamart's sessions) get one search per row: no extra brand-free search
 * for nudges and no retry in the shopper's own words.
 */
const LEAN = new Set<PlatformId>(['zepto', 'instamart', 'dmart']);

/** Per signed-in app, the time allowed for the shopper's own account search. */
const ACCOUNT_DEADLINE_MS = 14_000;

/** Cheapest cost per unit for each row a platform can fill. */
function unitCosts(perRow: PlatformResult['perRow']): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, r] of Object.entries(perRow)) if (r.fills.length) out.set(id, Math.min(...r.fills.map((f) => f.cost / f.quantity)));
  return out;
}

/**
 * How far an account's prices sit from the other apps' for the same rows
 * (median ratio), or null with nothing to compare. Grocery prices across apps
 * sit within tens of percent; ~100× is a paise/rupee mix-up.
 */
function offBy(account: PlatformResult['perRow'], others: PlatformResult[]): number | null {
  const mine = unitCosts(account);
  const ratios: number[] = [];
  for (const [id, cost] of mine) {
    const theirs = others.map((o) => unitCosts(o.perRow).get(id)).filter((c): c is number => c !== undefined).sort((a, b) => a - b);
    if (theirs.length) ratios.push(cost / theirs[Math.floor(theirs.length / 2)]!);
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)]!;
}

export async function POST(request: Request) {
  let body;
  try {
    body = CompareSchema.parse(await request.json());
  } catch (e) {
    return Response.json({ error: 'That list doesn’t look right', detail: e instanceof Error ? e.message.slice(0, 300) : undefined }, { status: 400 });
  }

  const rows = body.rows as ListRow[];
  const { location, settings } = body;
  const parsed = rows.map(parseRow);
  const unlocked = rows.map((r) => parseRow({ ...r, anyBrand: true }));
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null;
  const platforms = ENABLED_PLATFORMS;

  const ac = new AbortController();
  request.signal.addEventListener('abort', () => ac.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (ev: CompareEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send({
        type: 'meta',
        platforms,
        rows: parsed.map((p) => ({ id: p.id, brand: p.brand, brandLocked: p.brandLocked, searchText: p.searchText })),
      });

      const results: Partial<Record<PlatformId, PlatformResult>> = {};

      /** The shopper's own account, when signed in: searched first, with the logged-out search as the fallback. */
      const runAccount = async (platformId: PlatformId, token: string): Promise<PlatformResult> => {
        const started = Date.now();
        const queries = parsed.map((p) => ({ itemId: p.id, text: p.searchText }));
        let done = 0;
        const found = await searchAccount(
          platformId as Parameters<typeof searchAccount>[0],
          token,
          queries,
          location,
          AbortSignal.any([ac.signal, AbortSignal.timeout(ACCOUNT_DEADLINE_MS)]),
          () => send({ type: 'progress', platformId, done: ++done, total: queries.length }),
        );
        const build = (scale: number) => {
          const perRow: PlatformResult['perRow'] = {};
          parsed.forEach((p, i) => {
            const listings: Listing[] = (found.listings[p.id] ?? []).map((l) => ({ ...l, platformId, price: l.price * scale, mrp: l.mrp === null ? null : l.mrp * scale }));
            perRow[p.id] = rowResult(p, unlocked[i]!, platformId, listings, listings, undefined, listings.length ? 'ok' : 'no_results');
          });
          return perRow;
        };
        let perRow = build(1);
        // A paise/rupee mix-up shows as ~100× against every other app: fix the unit rather than trust it.
        const others = Object.values(results).filter((r): r is PlatformResult => !!r && r.platformId !== platformId && !r.account);
        const ratio = offBy(perRow, others);
        if (ratio !== null && (ratio > 20 || ratio < 0.05)) perRow = build(ratio > 20 ? 0.01 : 100);
        if (process.env.NODE_ENV !== 'production') {
          const filled = Object.values(perRow).filter((r) => r.fills.length).length;
          console.log(`[account:${platformId}] used: ${filled}/${parsed.length} rows filled · price vs other apps ×${ratio?.toFixed(2) ?? 'n/a'}${ratio !== null && (ratio > 20 || ratio < 0.05) ? ' → unit corrected' : ''}`);
        }
        return {
          platformId,
          status: 'ok',
          store: { storeId: 'account', label: found.note, eta: null },
          feeHints: found.fees.hints,
          perRow,
          elapsedMs: Date.now() - started,
          account: 'used',
          accountNote: found.note,
          accountFees: { memberships: found.fees.memberships, source: found.fees.source },
        };
      };

      const runPlatform = async (platformId: PlatformId): Promise<PlatformResult> => {
        const token = isAccountPlatform(platformId) ? body.accounts?.[platformId] : undefined;
        let accountProblem: PlatformResult['accountProblem'];
        if (token) {
          try {
            return await runAccount(platformId, token);
          } catch (e) {
            accountProblem = e instanceof AccountError ? e.kind : 'failed';
            if (process.env.NODE_ENV !== 'production') console.log(`[account:${platformId}] not used: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        const fallback = await runLoggedOut(platformId);
        return accountProblem ? { ...fallback, account: 'unavailable', accountProblem } : fallback;
      };

      const runLoggedOut = async (platformId: PlatformId): Promise<PlatformResult> => {
        const started = Date.now();
        const queries: { itemId: string; text: string }[] = [];
        parsed.forEach((p, i) => {
          queries.push({ itemId: p.id, text: p.searchText });
          // Brand-locked rows also search without the brand, so nudges can find a cheaper brand.
          if (!LEAN.has(platformId) && p.brandLocked && unlocked[i]!.searchText !== p.searchText) queries.push({ itemId: `${p.id}::any`, text: unlocked[i]!.searchText });
        });

        const listings: Record<string, Listing[]> = {};
        const statuses: Record<string, PlatformStatus> = {};
        // Assigned inside `consume`; declared wide so TypeScript does not narrow them to 'error'.
        let storeStatus = 'error' as PlatformStatus;
        let doneStatus = 'error' as PlatformStatus;
        let store: PlatformResult['store'] = null;
        let feeHints: PlatformResult['feeHints'];
        let error: string | undefined;
        let done = 0;
        let total = queries.length;

        const consume = async (qs: { itemId: string; text: string }[]) => {
          for await (const ev of searchPlatform({ platformId, location, queries: qs, clientIp }, ac.signal)) {
            if (ev.type === 'store') {
              storeStatus = ev.status;
              store = ev.store;
              feeHints = ev.feeHints;
              error ??= ev.error;
            } else if (ev.type === 'query') {
              listings[ev.itemId] = [...(listings[ev.itemId] ?? []), ...ev.listings];
              statuses[ev.itemId] = ev.status;
              done += 1;
              send({ type: 'progress', platformId, done, total });
            } else {
              doneStatus = ev.status;
              error ??= ev.error;
            }
          }
        };

        await consume(queries);

        // One retry in the user's own words for rows the platform had no confident match for.
        if (doneStatus === 'ok' && !LEAN.has(platformId)) {
          const retry = parsed.filter((p, i) => {
            if (!p.fallbackSearchText) return false;
            const r = rowResult(p, unlocked[i]!, platformId, listings[p.id] ?? [], [], undefined, 'ok');
            return r.fills.length === 0;
          });
          if (retry.length) {
            total += retry.length;
            const before = doneStatus;
            await consume(retry.map((p) => ({ itemId: p.id, text: p.fallbackSearchText! })));
            doneStatus = before;
          }
        }

        const perRow: PlatformResult['perRow'] = {};
        parsed.forEach((p, i) => {
          perRow[p.id] = rowResult(
            p,
            unlocked[i]!,
            platformId,
            listings[p.id] ?? [],
            listings[`${p.id}::any`] ?? [],
            rows[i]!.pins?.[platformId],
            statuses[p.id] ?? doneStatus,
          );
        });

        const status: PlatformStatus = storeStatus !== 'ok' ? storeStatus : doneStatus;

        return { platformId, status, store, feeHints, error, perRow, elapsedMs: Date.now() - started };
      };

      const planInput = () => {
        const answered = platforms.filter((p) => {
          const r = results[p];
          return r && (r.status === 'ok' || Object.values(r.perRow).some((x) => x.fills.length > 0));
        });
        // Memberships the shopper's own accounts mention apply without being asked for.
        const detected = answered.flatMap((p) => results[p]!.accountFees?.memberships ?? []);
        const planSettings = detected.length ? { ...settings, memberships: [...new Set([...settings.memberships, ...detected])] } : settings;
        return {
          rows: parsed.map((p) => ({ id: p.id, label: p.text, brandLocked: p.brandLocked })),
          platforms: platformSpecs(
            answered.map((p) => ({ platformId: p, eta: results[p]!.store?.eta ?? null, feeHints: results[p]!.feeHints })),
            planSettings,
          ),
          fills: sanitize(answered.flatMap((p) => Object.values(results[p]!.perRow).flatMap((r) => r.fills))),
          unlockedFills: sanitize(answered.flatMap((p) => Object.values(results[p]!.perRow).flatMap((r) => r.unlockedFills))),
        };
      };

      let planning: Promise<void> = Promise.resolve();
      const replan = (final: boolean) => {
        planning = planning
          .then(async () => {
            const result = await planBasket(planInput(), { lite: !final });
            send({ type: 'plan', result, final });
          })
          .catch((e: unknown) => {
            send({ type: 'error', message: `Planning hiccup: ${e instanceof Error ? e.message : String(e)}` });
          });
        return planning;
      };

      await Promise.all(
        platforms.map(async (platformId) => {
          let result: PlatformResult;
          try {
            result = await runPlatform(platformId);
          } catch (e) {
            result = { platformId, status: 'error', store: null, error: e instanceof Error ? e.message : String(e), perRow: {}, elapsedMs: 0 };
          }
          results[platformId] = result;
          send({ type: 'platform', result });
          if (!ac.signal.aborted) void replan(false);
        }),
      );

      await planning;
      if (!ac.signal.aborted) await replan(true);
      send({ type: 'done' });
      closed = true;
      controller.close();
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
