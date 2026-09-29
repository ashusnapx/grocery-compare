'use client';

import { ArrowUpRightIcon, LightbulbFilamentIcon, TimerIcon, TrendDownIcon, WarningIcon, XIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { formatRupees, itemFor, PLATFORMS, type Order, type OrderLine } from '@gc/engine';
import { HandoffSheet } from './HandoffSheet';
import { PlatformBadge } from './PlatformBadge';
import { ProductThumb } from './ProductThumb';

interface Props {
  order: Order;
  index: number;
  count: number;
  rowText: (itemId: string) => string;
  rowQuantity: (itemId: string) => string;
  /** Formats a fill's bought quantity in the row's own unit. */
  fillQuantity: (itemId: string, value: number) => string;
  /** Its prices came from the shopper's own account on an app whose cart we may fill. */
  cartable?: boolean;
  /** Drop this app from the plan (one tap, from the card's header). */
  onRemove?: () => void;
}

/** One order: the app, what to buy there, and what it comes to with fees. */
export function OrderCard({ order, index, count, rowText, rowQuantity, fillQuantity, cartable = false, onRemove }: Props) {
  const meta = PLATFORMS[order.platformId];
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25, ease: 'easeOut' }}
      className="flex flex-col rounded-2xl border border-line bg-card shadow-card"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line py-3 pr-2.5 pl-4">
        <PlatformBadge id={order.platformId} size="lg" />
        <div className="flex items-center gap-2 text-xs text-muted">
          {order.eta && (
            <span className="flex items-center gap-1 rounded-full bg-soft px-2 py-0.5 font-medium">
              <TimerIcon size={13} /> {order.eta}
            </span>
          )}
          <span className="tabular-nums">
            {index + 1}/{count}
          </span>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              data-testid="remove-app"
              aria-label={`Remove ${meta.name} from plan`}
              title="Remove from plan"
              className="btn-ghost -my-1 size-7"
            >
              <XIcon size={14} />
            </button>
          )}
        </div>
      </header>

      <ul className="flex flex-col divide-y divide-line px-4">
        {order.lines.map((line) => (
          <Line key={line.itemId} line={line} rowText={rowText} rowQuantity={rowQuantity} fillQuantity={fillQuantity} />
        ))}
      </ul>

      <div className="mt-auto border-t border-line px-4 pt-3 pb-4">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Items</dt>
            <dd className="tabular-nums">{formatRupees(order.subtotal)}</dd>
          </div>
          {order.fees.length === 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">Fees</dt>
              <dd className="font-medium text-good">₹0</dd>
            </div>
          ) : (
            order.fees.map((f) => (
              <div key={f.label} className="flex justify-between">
                <dt className="text-muted">{f.label}</dt>
                <dd className="tabular-nums">
                  {f.approximate ? '≈' : ''}
                  {formatRupees(f.amount)}
                </dd>
              </div>
            ))
          )}
          <div className="flex justify-between border-t border-line pt-2 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatRupees(order.total)}</dd>
          </div>
        </dl>
        <HandoffSheet order={order} rowText={rowText} cartable={cartable}>
          <button type="button" className="btn-primary mt-3.5 h-10 w-full px-4 text-sm">
            Order on {meta.name} <ArrowUpRightIcon size={16} weight="bold" />
          </button>
        </HandoffSheet>
      </div>
    </motion.article>
  );
}

/** One receipt line: what to buy, the pack, the price. "why?" explains a pick that isn't the cheapest sticker price. */
function Line({ line, rowText, rowQuantity, fillQuantity }: { line: OrderLine } & Pick<Props, 'rowText' | 'rowQuantity' | 'fillQuantity'>) {
  const [why, setWhy] = useState(false);
  const emoji = itemFor(rowText(line.itemId))?.emoji ?? '🛒';
  return (
    <li className="py-3" title={`for “${rowText(line.itemId)}” (${rowQuantity(line.itemId)})`}>
      <div className="flex items-start gap-3">
        <ProductThumb src={line.fill.imageUrl} emoji={emoji} />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-medium">{line.fill.label}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{line.fill.packLabel}</span>
            {line.fill.overBuy && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-1.5 py-px font-medium text-warn" title="Only bigger packs here">
                <WarningIcon size={12} aria-hidden /> bigger pack · {fillQuantity(line.itemId, line.fill.quantity)}
              </span>
            )}
            {line.fill.stepUp && (
              <span className="inline-flex items-center gap-1 rounded-full bg-good-soft px-1.5 py-px font-medium text-good" title="A slightly bigger pack makes this order cheaper overall">
                <TrendDownIcon size={12} aria-hidden /> bigger pack · cheaper overall
              </span>
            )}
            {line.why && (
              <button
                type="button"
                onClick={() => setWhy((v) => !v)}
                aria-expanded={why}
                className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-px text-[0.7rem] font-medium text-muted transition-colors hover:bg-soft hover:text-fg"
              >
                <LightbulbFilamentIcon size={11} weight="fill" aria-hidden /> why?
              </button>
            )}
          </p>
          {why && line.why && <p className="mt-2 rounded-lg bg-soft px-2.5 py-2 text-xs leading-snug text-muted">{line.why}</p>}
        </div>
        <span className="text-sm font-semibold tabular-nums">{formatRupees(line.fill.cost)}</span>
      </div>
    </li>
  );
}
