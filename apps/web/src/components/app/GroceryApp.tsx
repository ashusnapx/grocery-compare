'use client';

import { ArrowRightIcon, SpinnerGapIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PLATFORMS, type GeoLocation, type ListRow, type PlanResult, type PlanSettings, type PlatformId } from '@gc/engine';
import type { CompareEvent, PlatformResult } from '@/lib/compare-types';
import { accessToken, isSignedIn, signOut } from '@/lib/account/oauth';
import { isAccountPlatform, type AccountPlatform } from '@/lib/account/providers';
import { itemLabel, money, track } from '@/lib/analytics';
import { gpsAllowed, gpsLocation, networkLocation, type LocationSource } from '@/lib/geo';
import { buildPlanRequest, requestPlan } from '@/lib/replan';
import { decodeList } from '@/lib/share';
import { load, save } from '@/lib/storage';
import { AppConnections } from './AppConnections';
import { Greeting } from './Greeting';
import { Header } from './Header';
import { ListBuilder, newRowId } from './ListBuilder';
import { LocationPicker } from './LocationPicker';
import { Results } from './Results';
import { SiteFooter } from '@/components/SiteFooter';

export type Phase = 'edit' | 'comparing' | 'done';

export interface CompareState {
  platforms: PlatformId[];
  rowsMeta: { id: string; brand: string | null; brandLocked: boolean }[];
  progress: Partial<Record<PlatformId, { done: number; total: number }>>;
  results: Partial<Record<PlatformId, PlatformResult>>;
  plan: PlanResult | null;
  final: boolean;
  startedAt: number;
}

const DEFAULT_SETTINGS: PlanSettings = { memberships: [], excluded: [], overrides: [] };
/** Prices are live: results older than this are checked again rather than re-used. */
const PRICES_FRESH_MS = 5 * 60 * 1000;

async function* readSse(res: Response): AsyncGenerator<CompareEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) yield JSON.parse(data) as CompareEvent;
    }
  }
}

/** The app. `children` render below it, before the footer (the home page's guide and FAQ). */
export function GroceryApp({ children }: { children?: ReactNode }) {
  const [rows, setRows] = useState<ListRow[]>([]);
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [locationSource, setLocationSource] = useState<LocationSource>('manual');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [readingAccounts, setReadingAccounts] = useState(false);
  const [settings, setSettings] = useState<PlanSettings>(DEFAULT_SETTINGS);
  const [phase, setPhase] = useState<Phase>('edit');
  const [compare, setCompare] = useState<CompareState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const rowsRef = useRef<ListRow[]>([]);
  rowsRef.current = rows;
  const resultsRef = useRef<HTMLDivElement>(null);
  const locationRef = useRef<GeoLocation | null>(null);
  locationRef.current = location;
  /** A comparison to run as soon as there is a location: on page load, or while the picker is open. */
  const autoRun = useRef<{ scroll: boolean; auto: boolean; trigger: string } | null>(null);
  const askedGps = useRef(false);

  // No saved place: GPS if the browser already allows it, else the network's rough location — never a prompt.
  const detectLocation = async () => {
    const exact = (await gpsAllowed()) ? await gpsLocation(8000) : null;
    const found = exact ?? (await networkLocation());
    if (!found || locationRef.current) return;
    setLocation(found);
    setLocationSource(exact ? 'gps' : 'network');
    track('location_set', { method: exact ? 'gps_allowed' : 'network' });
  };

  // Everything is remembered in this browser only — there is no database.
  // Read a shared-list link once. Effects can run twice (React StrictMode), and
  // the first run clears the fragment, so the result is kept in a ref.
  const sharedList = useRef<ReturnType<typeof decodeList> | undefined>(undefined);
  useEffect(() => {
    if (sharedList.current === undefined) {
      sharedList.current = window.location.hash.startsWith('#l=') ? decodeList(window.location.hash.slice(3)) : null;
      if (sharedList.current) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        const n = sharedList.current.length;
        toast(`Loaded a shared list — ${n} item${n === 1 ? '' : 's'} 🛍️`);
      }
    }
    const shared = sharedList.current;
    const initialRows = shared ? shared.map((r) => ({ ...r, id: newRowId() })) : load<ListRow[]>('rows', []);
    const savedLocation = load<GeoLocation | null>('location', null);
    setRows(initialRows);
    setLocation(savedLocation);
    setLocationSource(load<LocationSource>('location-source', 'manual'));
    // Fees and memberships are read from the shopper's accounts now, never typed in: only app choices carry over.
    setSettings({ ...DEFAULT_SETTINGS, excluded: load<Partial<PlanSettings>>('settings', {}).excluded ?? [] });
    setHydrated(true);
    // Fewest taps: a shared list, or a returning visitor's list, is priced straight away.
    if (initialRows.length) autoRun.current = { scroll: !!shared, auto: true, trigger: shared ? 'shared_link' : 'returning_visitor' };
    if (!savedLocation) void detectLocation();
  }, []);
  useEffect(() => {
    if (hydrated) save('rows', rows);
  }, [rows, hydrated]);
  useEffect(() => {
    if (hydrated) save('location', location);
  }, [location, hydrated]);
  useEffect(() => {
    if (hydrated) save('location-source', locationSource);
  }, [locationSource, hydrated]);
  useEffect(() => {
    if (hydrated) save('settings', settings);
  }, [settings, hydrated]);

  const runCompare = useCallback(async (opts: { rows?: ListRow[]; settings?: PlanSettings; scroll?: boolean; auto?: boolean; trigger?: string } = {}) => {
    const trigger = opts.trigger ?? 'button';
    const rows = opts.rows ?? rowsRef.current;
    const valid = rows.filter((r) => r.text.trim() && r.amount > 0);
    if (!valid.length) {
      toast('Your jhola is empty. Add a few things first.');
      return;
    }
    let loc = location;
    // No place yet, or only the network's guess: ask for GPS once, when the user asks for prices
    // (never on page load) — it decides which dark store's prices are real.
    if ((!loc || locationSource === 'network') && !askedGps.current && !opts.auto) {
      askedGps.current = true;
      setLocating(true);
      const exact = await gpsLocation(8000);
      setLocating(false);
      if (exact) {
        loc = exact;
        setLocation(exact);
        setLocationSource('gps');
        track('location_set', { method: 'gps_on_compare' });
      }
    }
    if (!loc) {
      autoRun.current = { scroll: opts.scroll !== false, auto: !!opts.auto, trigger };
      if (!opts.auto) setPickerOpen(true);
      return;
    }
    // Signed-in apps: their fresh tokens go with this comparison, so it searches the shopper's own account.
    const connected = (['zepto', 'instamart'] as AccountPlatform[]).filter(isSignedIn);
    let accounts: Partial<Record<AccountPlatform, string>> | undefined;
    if (connected.length) {
      setReadingAccounts(true);
      const tokens = await Promise.all(connected.map(async (id) => [id, await accessToken(id)] as const));
      setReadingAccounts(false);
      accounts = Object.fromEntries(tokens.filter(([, t]) => t));
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    // A fresh comparison brings back apps removed from the last plan (a stale re-plan carries them in its settings).
    if (!opts.settings) setRemovedApps([]);
    setPhase('comparing');
    setCompare({ platforms: [], rowsMeta: [], progress: {}, results: {}, plan: null, final: false, startedAt: Date.now() });
    if (opts.scroll !== false) setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    const started = Date.now();
    track('compare_start', {
      trigger,
      item_count: valid.length,
      accounts: connected.length ? connected.join('+') : 'none',
      location_source: locationRef.current === loc ? locationSource : 'gps',
      approximate: loc.approximate,
    });
    const answered: Partial<Record<PlatformId, PlatformResult>> = {};
    const report = (result: PlanResult) => {
      const best = result.best;
      const apps = Object.values(answered).filter((r): r is PlatformResult => !!r);
      const savings = best && result.baseline ? Math.max(0, result.baseline.total - best.total) : 0;
      track('compare_complete', {
        trigger,
        item_count: valid.length,
        items_found: valid.length - result.unavailable.length,
        orders: best?.orders.length ?? 0,
        value: best ? money(best.total) : 0,
        currency: 'INR',
        fees: best ? money(best.feesTotal) : 0,
        savings: money(savings),
        savings_pct: best && result.baseline ? Math.round((savings / result.baseline.total) * 100) : 0,
        apps_in_plan: best ? best.orders.map((o) => o.platformId).join('+') : 'none',
        cheapest_single_app: result.baseline?.platformId ?? 'none',
        apps_ok: apps.filter((r) => r.status === 'ok').length,
        apps_blocked: apps.filter((r) => r.status === 'blocked').map((r) => r.platformId).join('+') || 'none',
        apps_unserviceable: apps.filter((r) => r.status === 'unserviceable').length,
        apps_account: apps.filter((r) => r.account === 'used').length,
        duration_ms: Date.now() - started,
      });
    };

    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: valid, location: loc, settings: opts.settings ?? settings, accounts }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error((body as { error?: string }).error ?? `Comparison failed (HTTP ${res.status})`);
      }
      for await (const ev of readSse(res)) {
        if (ev.type === 'meta') setCompare((c) => c && { ...c, platforms: ev.platforms, rowsMeta: ev.rows });
        else if (ev.type === 'progress') setCompare((c) => c && { ...c, progress: { ...c.progress, [ev.platformId]: { done: ev.done, total: ev.total } } });
        else if (ev.type === 'platform') {
          // The app said this login has ended: show "Log in" again rather than keep a dead token.
          if (ev.result.accountProblem === 'signed_out' && isAccountPlatform(ev.result.platformId)) signOut(ev.result.platformId);
          answered[ev.result.platformId] = ev.result;
          setCompare((c) => c && { ...c, results: { ...c.results, [ev.result.platformId]: ev.result } });
        }
        else if (ev.type === 'plan') {
          setCompare((c) => c && { ...c, plan: ev.result, final: ev.final });
          if (ev.final) report(ev.result);
        }
        else if (ev.type === 'error') toast.error(ev.message);
      }
      setPhase('done');
    } catch (e) {
      if (ac.signal.aborted) return;
      track('compare_error', { trigger, reason: (e instanceof Error ? e.message : String(e)).slice(0, 90) });
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
      setPhase('edit');
    }
  }, [location, locationSource, settings]);

  useEffect(() => {
    if (!hydrated || !location || !autoRun.current) return;
    const opts = autoRun.current;
    autoRun.current = null;
    void runCompare(opts);
  }, [hydrated, location, runCompare]);

  // Instant re-solve from fills already in hand: settings, brand swaps, a removed app.
  const [replanning, setReplanning] = useState(false);
  const [removedApps, setRemovedApps] = useState<PlatformId[]>([]);
  const removedRef = useRef<PlatformId[]>([]);
  removedRef.current = removedApps;
  const replan = useCallback(
    async (nextRows: ListRow[], nextSettings: PlanSettings, removed: PlatformId[] = removedRef.current) => {
      if (!compare || phase === 'comparing') return;
      // Apps the shopper removed from this plan stay out of every re-plan of it.
      const effective = removed.length ? { ...nextSettings, excluded: [...new Set([...nextSettings.excluded, ...removed])] } : nextSettings;
      if (Date.now() - compare.startedAt > PRICES_FRESH_MS) {
        void runCompare({ rows: nextRows, settings: effective, scroll: false, trigger: 'settings_stale' });
        return;
      }
      const req = buildPlanRequest(compare, nextRows, effective);
      if (!req) return;
      setReplanning(true);
      try {
        const result = await requestPlan(req);
        setCompare((c) => c && { ...c, plan: result });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not re-plan');
      } finally {
        setReplanning(false);
      }
    },
    [compare, phase, runCompare],
  );

  // Back on a tab whose prices are a few minutes old: check the apps again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || phase !== 'done' || !compare?.final) return;
      const age = Date.now() - compare.startedAt;
      if (age < PRICES_FRESH_MS) return;
      toast(`Those prices were ${Math.floor(age / 60_000)} min old — getting live ones`);
      void runCompare({ scroll: false, auto: true, trigger: 'stale_refresh' });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [phase, compare, runCompare]);

  const changeSettings = (s: PlanSettings) => {
    const setting =
      s.memberships.length !== settings.memberships.length
        ? 'membership'
        : s.excluded.length !== settings.excluded.length
          ? 'apps_used'
          : 'fees';
    track('settings_change', { setting, count: setting === 'membership' ? s.memberships.length : setting === 'apps_used' ? s.excluded.length : s.overrides.length });
    setSettings(s);
    void replan(rows, s);
  };
  const anyBrand = (itemId: string) => {
    const row = rows.find((r) => r.id === itemId);
    if (row) track('any_brand', { item: itemLabel(row.text) });
    const next = rows.map((r) => (r.id === itemId ? { ...r, anyBrand: true } : r));
    setRows(next);
    void replan(next, settings);
  };
  // An order card's ×: plan again without that app (this plan only), with an undo.
  const removeApp = (platformId: PlatformId) => {
    const inPlan = new Set(compare?.plan?.best?.orders.map((o) => o.platformId) ?? []);
    if (inPlan.size <= 1 && inPlan.has(platformId)) {
      toast('Keep at least one app — or check prices again');
      return;
    }
    const next = [...new Set([...removedRef.current, platformId])];
    setRemovedApps(next);
    track('remove_app', { app: platformId, count: next.length });
    void replan(rows, settings, next);
    toast(`${PLATFORMS[platformId].name} removed · re-planned`, {
      action: {
        label: 'Undo',
        onClick: () => {
          const back = removedRef.current.filter((p) => p !== platformId);
          setRemovedApps(back);
          void replan(rowsRef.current, settings, back);
        },
      },
    });
  };
  const pin = (itemId: string, platformId: PlatformId, listingId: string) => {
    const row = rows.find((r) => r.id === itemId);
    track('pin_product', { item: row ? itemLabel(row.text) : undefined, app: platformId });
    const next = rows.map((r) => (r.id === itemId ? { ...r, pins: { ...(r.pins ?? {}), [platformId]: listingId } } : r));
    setRows(next);
    toast('Pinned — re-checking with your pick');
    void runCompare({ rows: next, trigger: 'pin' });
  };

  const ready = rows.length > 0;

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <Header />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-24 sm:px-6">
        {/* ---------- hero ---------- */}
        <section className="pt-6 pb-6 sm:pt-12 sm:pb-8">
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
            <div className="mb-2 empty:hidden">
              <Greeting />
            </div>
            <h1 className="text-[2.125rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[3.25rem] sm:leading-[1.05]">
              Stop overpaying for aloo.
            </h1>
            <p className="mt-3 text-base text-muted sm:text-lg">6 apps, every fee, one plan.</p>
          </motion.div>
        </section>

        {/* ---------- builder ---------- */}
        <section className="grid grid-cols-1 gap-4">
          <div className="flex">
            <LocationPicker
              location={location}
              approximate={locationSource === 'network'}
              onChange={(loc, source) => {
                setLocation(loc);
                setLocationSource(source);
                track('location_set', { method: source === 'gps' ? 'gps_button' : 'pincode', approximate: loc.approximate });
              }}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
            />
          </div>

          <AppConnections />

          <ListBuilder rows={rows} onChange={setRows} location={location} onBulkAdd={(next) => void runCompare({ rows: next, trigger: 'paste' })} />

          <button
            type="button"
            data-testid="compare"
            onClick={() => void runCompare()}
            disabled={phase === 'comparing' || locating || readingAccounts}
            className={`group h-13 w-full px-6 text-base font-semibold disabled:cursor-wait disabled:opacity-100 sm:h-14 sm:text-lg ${
              ready ? 'btn-primary' : 'btn-secondary text-muted'
            }`}
          >
            {locating ? (
              <>
                <SpinnerGapIcon size={20} className="animate-spin" /> Finding you…
              </>
            ) : readingAccounts ? (
              <>
                <SpinnerGapIcon size={20} className="animate-spin" /> Your prices…
              </>
            ) : phase === 'comparing' ? (
              <>
                <SpinnerGapIcon size={20} className="animate-spin" /> Hunting…
              </>
            ) : (
              <>
                Find cheapest
                <ArrowRightIcon size={20} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </section>

        {/* ---------- results ---------- */}
        <div ref={resultsRef} className="scroll-mt-6">
          {compare && (
            <Results
              state={compare}
              phase={phase}
              rows={rows}
              settings={settings}
              replanning={replanning}
              onSettings={changeSettings}
              onAnyBrand={anyBrand}
              onPin={pin}
              onRecompare={() => void runCompare({ trigger: 'recheck' })}
              onRemoveApp={removeApp}
            />
          )}
        </div>

        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
