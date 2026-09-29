'use client';

import { ArrowCounterClockwiseIcon, ArrowSquareOutIcon, ShoppingCartSimpleIcon, SpinnerGapIcon, XIcon } from '@phosphor-icons/react';
import { Dialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { formatRupees, itemFor, PLATFORMS, type GeoLocation, type Order } from '@gc/engine';
import { accessToken, signOut } from '@/lib/account/oauth';
import { itemLabel, money, track } from '@/lib/analytics';
import { load } from '@/lib/storage';
import { PlatformBadge } from './PlatformBadge';
import { ProductThumb } from './ProductThumb';

interface Props {
  order: Order;
  rowText: (id: string) => string;
  /** The order came from the shopper's own signed-in account on an app whose cart we may fill (Instamart). */
  cartable: boolean;
  children: ReactNode;
}

/**
 * The hand-off. Everything in the plan is in; the shopper only takes out what
 * they don't want. Where the app lets us (Instamart, signed in) one tap fills
 * their real cart and opens the app; elsewhere each item opens its product
 * page, one tap from the app's own Add button.
 */
export function HandoffSheet({ order, rowText, cartable, children }: Props) {
  const meta = PLATFORMS[order.platformId];
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const lines = order.lines.filter((l) => !removed.includes(l.itemId));
  const subtotal = lines.reduce((sum, l) => sum + l.fill.cost, 0);
  const toggle = (id: string) => {
    const out = !removed.includes(id);
    setRemoved(out ? [...removed, id] : removed.filter((x) => x !== id));
    const line = order.lines.find((l) => l.itemId === id);
    if (line) track(out ? 'remove_from_order' : 'restore_to_order', { app: order.platformId, item: itemLabel(line.fill.label) });
  };
  const gaItems = () =>
    lines.slice(0, 20).map((line) => ({
      item_id: line.fill.packs[0]?.listingId ?? line.itemId,
      item_name: line.fill.label.slice(0, 100),
      item_brand: line.fill.brand ?? undefined,
      item_category: itemLabel(line.fill.label),
      price: money(line.fill.cost),
      quantity: 1,
      affiliation: order.platformId,
    }));

  const openApp = (target?: Window | null) => {
    track('open_app', { app: order.platformId, value: money(subtotal), currency: 'INR' });
    if (target) target.location.href = meta.homepage;
    else window.open(meta.homepage, '_blank', 'noopener');
  };

  const fillCart = async () => {
    // Opened now, while the tap still counts as the shopper's own, so the app isn't blocked as a pop-up.
    const tab = window.open('', '_blank');
    setBusy(true);
    try {
      const token = await accessToken('instamart');
      const location = load<GeoLocation | null>('location', null);
      if (!token || !location) throw new Error('Log in to Instamart again to fill your cart');
      const items = lines.flatMap((l) => l.fill.packs.map((p) => ({ listingId: p.listingId, quantity: Math.max(1, Math.round(p.count)) })));
      const res = await fetch('/api/account/cart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platformId: 'instamart', token, location, items }),
      });
      const body = (await res.json()) as { added?: number; unavailable?: number; error?: string; kind?: string };
      if (!res.ok) {
        if (body.kind === 'signed_out') signOut('instamart');
        throw new Error(body.error ?? 'Couldn’t fill the cart');
      }
      track('add_to_cart', { currency: 'INR', value: money(subtotal), app: order.platformId, count: body.added ?? lines.length, items: gaItems() });
      toast(
        body.unavailable
          ? `Added ${body.added} to your Instamart cart · ${body.unavailable} just went out of stock`
          : `Added ${body.added} to your Instamart cart 🛒`,
      );
      setOpen(false);
      openApp(tab);
    } catch (e) {
      tab?.close();
      toast.error(e instanceof Error ? e.message : 'Couldn’t fill the cart');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) track('begin_checkout', { currency: 'INR', value: money(order.total), app: order.platformId, affiliation: order.platformId, orders: 1, items: gaItems() });
      }}
    >
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-x-3 bottom-3 z-50 max-h-[85vh] overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(92vw,480px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <PlatformBadge id={order.platformId} className="text-muted" />
              <Dialog.Title className="mt-1.5 text-xl font-semibold tracking-tight">Your {meta.name} order</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                {lines.length} of {order.lines.length} in · tap × to drop one
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-ghost -mt-1 -mr-2 size-8 shrink-0" aria-label="Close">
              <XIcon size={16} />
            </Dialog.Close>
          </div>

          <ul className="mt-4 flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line">
            {order.lines.map((line) => {
              const out = removed.includes(line.itemId);
              return (
                <li key={line.itemId} data-item={line.itemId} data-removed={out} className={`flex items-center gap-3 py-2.5 pr-2 pl-3 transition-colors ${out ? 'bg-soft text-muted' : ''}`}>
                  <ProductThumb src={line.fill.imageUrl} emoji={itemFor(rowText(line.itemId))?.emoji ?? '🛒'} className={out ? 'opacity-50 grayscale' : ''} />
                  <a href={line.fill.productUrl} target="_blank" rel="noopener noreferrer" className="group min-w-0 flex-1">
                    <span className={`block truncate text-sm font-medium group-hover:underline ${out ? 'line-through' : ''}`}>{line.fill.label}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {line.fill.packLabel} · {rowText(line.itemId)}
                    </span>
                  </a>
                  <span className={`text-sm font-semibold tabular-nums ${out ? 'line-through' : ''}`}>{formatRupees(line.fill.cost)}</span>
                  <button
                    type="button"
                    onClick={() => toggle(line.itemId)}
                    aria-label={out ? `Put ${line.fill.label} back` : `Remove ${line.fill.label}`}
                    title={out ? 'Put back' : 'Remove'}
                    className="btn-ghost size-8 shrink-0"
                  >
                    {out ? <ArrowCounterClockwiseIcon size={15} /> : <XIcon size={15} />}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 flex justify-between px-1 text-sm">
            <span className="text-muted">Items</span>
            <span className="font-semibold tabular-nums">{formatRupees(subtotal)}</span>
          </p>

          {cartable ? (
            <button
              type="button"
              onClick={() => void fillCart()}
              disabled={busy || lines.length === 0}
              data-testid="fill-cart"
              className="btn-primary mt-4 h-11 w-full px-4 text-base"
            >
              {busy ? <SpinnerGapIcon size={18} className="animate-spin" /> : <ShoppingCartSimpleIcon size={18} weight="bold" />}
              Add {lines.length} to cart &amp; open {meta.name}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openApp()}
              disabled={lines.length === 0}
              className="btn-primary mt-4 h-11 w-full px-4 text-base"
            >
              Open {meta.name} <ArrowSquareOutIcon size={18} weight="bold" />
            </button>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
