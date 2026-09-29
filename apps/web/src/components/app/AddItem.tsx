'use client';

import { MapPinIcon, PlusIcon, SpinnerGapIcon, StorefrontIcon } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatRupees, parsePastedList, PLATFORMS, productToRow, suggest, type GeoLocation, type ListRow, type ProductGroup, type Suggestion, type Unit } from '@gc/engine';
import { itemLabel, money, searchLabel, track } from '@/lib/analytics';

const UNIT_LABEL: Record<Unit, string> = { g: 'g', kg: 'kg', ml: 'ml', L: 'L', pcs: 'pcs', dozen: 'dozen', pack: 'pack' };
const PLACEHOLDERS = ['amul butter', 'atta 5kg', 'pyaz 2 kg', 'eggs 12', 'toor dal 1kg', 'maggi 4 pack'];
const LIVE_MIN_CHARS = 3;
const LIVE_DEBOUNCE_MS = 350;
/** Below this much free screen under the box, the page scrolls the box up to make room. */
const ROOM_WANTED_PX = 380;

type Option = { kind: 'product'; p: ProductGroup } | { kind: 'dict'; d: Suggestion };

interface Props {
  location: GeoLocation | null;
  onAdd: (text: string, pick?: { row: Omit<ListRow, 'id'>; imageUrl?: string }) => void;
  /** A whole list pasted into the box. */
  onAddMany: (rows: Omit<ListRow, 'id'>[]) => void;
}

/**
 * The add box. Typing shows two things: real products near you, live from
 * the apps with photos and every app's price (pick one = that exact brand
 * and size), and the generic item ("butter · any brand").
 */
export function AddItem({ location, onAdd, onAddMany }: Props) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [live, setLive] = useState<{ q: string; loading: boolean; products: ProductGroup[] }>({ q: '', loading: false, products: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  // Rotates after mount; the server always renders the first, so hydration matches.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2600);
    return () => clearInterval(t);
  }, []);
  const placeholder = PLACEHOLDERS[tick % PLACEHOLDERS.length];

  const q = text.trim();
  const dict: Suggestion[] = useMemo(() => (focused && q.length >= 2 ? suggest(q, 4) : []), [q, focused]);

  useEffect(() => {
    if (!focused || q.length < LIVE_MIN_CHARS || !location) {
      setLive((l) => (l.loading ? { ...l, loading: false } : l));
      return;
    }
    const ac = new AbortController();
    setLive((l) => ({ q, loading: true, products: q.startsWith(l.q) || l.q.startsWith(q) ? l.products : [] }));
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, lat: String(location.lat), lng: String(location.lng), pincode: location.pincode });
        const res = await fetch(`/api/suggest?${params}`, { signal: ac.signal });
        const body = (await res.json()) as { products?: ProductGroup[] };
        setLive({ q, loading: false, products: body.products ?? [] });
      } catch {
        if (!ac.signal.aborted) setLive((l) => ({ ...l, loading: false }));
      }
    }, LIVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [q, focused, location]);

  const options: Option[] = [...live.products.map((p) => ({ kind: 'product' as const, p })), ...dict.map((d) => ({ kind: 'dict' as const, d }))];
  const open = focused && q.length >= 2 && (options.length > 0 || live.loading || !location);

  // Keep the list on screen: bring the box up when it sits low (or the phone
  // keyboard is up), then let the list take exactly the space that is left.
  useLayoutEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    const visibleTop = () => vv?.offsetTop ?? 0;
    const visibleBottom = () => (vv ? vv.offsetTop + vv.height : window.innerHeight);
    const measure = () => {
      const box = formRef.current?.getBoundingClientRect();
      if (box) setMaxHeight(Math.max(160, Math.floor(visibleBottom() - box.bottom - 16)));
    };
    const box = formRef.current?.getBoundingClientRect();
    if (box && visibleBottom() - box.bottom < ROOM_WANTED_PX) {
      window.scrollBy({ top: box.top - visibleTop() - 12, behavior: 'smooth' });
    }
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
    };
  }, [open]);

  const reset = () => {
    setText('');
    setActive(-1);
    setLive({ q: '', loading: false, products: [] });
    inputRef.current?.focus();
  };

  const pick = (o: Option) => {
    track('search', { search_term: searchLabel(q), results: live.products.length });
    if (o.kind === 'product') {
      const cheapest = o.p.offers[0];
      track('add_to_list', { method: 'product', item: itemLabel(o.p.title), app: cheapest?.platformId, price: cheapest ? money(cheapest.price) : undefined, brand_locked: true });
      onAdd(o.p.title, { row: productToRow(o.p), imageUrl: o.p.imageUrl ?? undefined });
    } else {
      // The dictionary matched the whole query, so its form already holds every typed word.
      const name = o.d.matched ?? o.d.name.toLowerCase();
      track('add_to_list', { method: 'generic', item: itemLabel(name), brand_locked: false });
      onAdd(name, { row: { text: name, amount: o.d.amount, unit: o.d.unit, anyBrand: true } });
    }
    reset();
  };

  return (
    <div className="relative">
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const o = options[active];
          if (o) pick(o);
          else if (q) {
            track('search', { search_term: searchLabel(q), results: live.products.length });
            track('add_to_list', { method: 'typed', item: itemLabel(q) });
            onAdd(q);
            reset();
          }
        }}
        className="flex items-center gap-2 rounded-xl border border-line bg-bg p-1.5 pl-3.5 transition-[border-color,box-shadow,background-color] focus-within:border-focus focus-within:bg-card focus-within:ring-4 focus-within:ring-focus/15"
      >
        <PlusIcon size={18} className="shrink-0 text-muted" aria-hidden />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(-1);
          }}
          onPaste={(e) => {
            // A pasted list (several lines or commas) becomes rows in one go; one item pastes as text.
            const pasted = parsePastedList(e.clipboardData.getData('text'));
            if (pasted.length < 2) return;
            e.preventDefault();
            onAddMany(pasted);
            reset();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (!options.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (a + 1) % options.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
            } else if (e.key === 'Escape') {
              setFocused(false);
            }
          }}
          placeholder={`Add “${placeholder}”…`}
          aria-label="Add an item"
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-muted"
        />
        <button type="submit" disabled={!q} className="btn-primary h-9 px-4 text-sm">
          Add
        </button>
      </form>

      {open && (
        <div
          role="listbox"
          style={maxHeight ? { maxHeight } : undefined}
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-[60vh] overflow-y-auto overscroll-contain rounded-xl border border-line bg-card p-1.5 shadow-pop"
        >
          {location ? (
            (live.loading || live.products.length > 0) && (
              <p className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted">
                <StorefrontIcon size={14} /> Real products near you
                {live.loading && <SpinnerGapIcon size={13} className="ml-auto animate-spin" />}
              </p>
            )
          ) : (
            <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-muted">
              <MapPinIcon size={14} weight="fill" /> Set your location to see real products.
            </p>
          )}

          {live.loading && live.products.length === 0 &&
            [0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-2.5 py-2">
                <span className="size-12 animate-pulse rounded-lg bg-soft" />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-3 w-3/4 animate-pulse rounded bg-soft" />
                  <span className="block h-3 w-1/3 animate-pulse rounded bg-soft" />
                </span>
              </div>
            ))}

          {options.map((o, i) => {
            const on = i === active;
            if (o.kind === 'product') {
              const p = o.p;
              const cheapest = p.offers[0]!;
              return (
                <button
                  key={p.key}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? 'bg-soft' : ''}`}
                >
                  <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-white">
                    {p.imageUrl ? (
                      // Product photos come from each app's own CDN.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-contain" />
                    ) : (
                      <span className="text-xl">🛒</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm leading-tight font-medium">{p.title}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-xs text-muted">{[p.brand, p.size].filter(Boolean).join(' · ')}</span>
                      {p.bestValue && (
                        <span className="shrink-0 rounded-full bg-good-soft px-1.5 py-px text-[0.65rem] font-medium whitespace-nowrap text-good">best value</span>
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-sm font-semibold tabular-nums">{formatRupees(cheapest.price)}</span>
                    {p.unitPrice && (
                      <span className="text-[0.7rem] whitespace-nowrap text-muted tabular-nums">
                        {formatRupees(p.unitPrice.amount)}/{p.unitPrice.per}
                      </span>
                    )}
                    <span className="flex gap-1.5">
                      {p.offers.slice(0, 3).map((of) => (
                        <span
                          key={of.platformId}
                          title={`${PLATFORMS[of.platformId].name} ${formatRupees(of.price)}`}
                          className="inline-flex items-center gap-1 text-[0.65rem] whitespace-nowrap text-muted"
                        >
                          <span className="size-1.5 shrink-0 rounded-full" style={{ background: PLATFORMS[of.platformId].color }} aria-hidden />
                          {PLATFORMS[of.platformId].name.replace(/ Ready$/, '')}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              );
            }
            const d = o.d;
            const first = i === live.products.length;
            return (
              <div key={`dict-${d.key}`}>
                {first && <p className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted">Any brand · cheapest wins</p>}
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? 'bg-soft' : ''}`}
                >
                  <span className={`grid size-8 shrink-0 place-items-center rounded-full text-base ${on ? 'bg-card' : 'bg-soft'}`}>{d.emoji}</span>
                  <span className="flex-1 text-sm font-medium">
                    {d.name}
                    {d.matched && <span className="ml-1.5 font-normal text-muted">“{d.matched}”</span>}
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    {d.amount} {UNIT_LABEL[d.unit]}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
