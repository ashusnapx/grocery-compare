'use client';

import { CheckCircleIcon, ProhibitIcon, SpinnerGapIcon, TimerIcon, WarningCircleIcon, MapPinSimpleIcon } from '@phosphor-icons/react';
import { PLATFORMS, type PlatformId, type PlatformStatus } from '@gc/engine';
import type { PlatformResult } from '@/lib/compare-types';
import type { CompareState, Phase } from './GroceryApp';

/** What each chip says: a word or two. The long version is the chip's tooltip. */
const STATUS_SHORT: Record<PlatformStatus, string> = {
  ok: '',
  no_results: 'none',
  blocked: 'blocked',
  timeout: 'slow',
  unserviceable: 'no delivery',
  error: 'error',
};

const STATUS_LONG: Record<PlatformStatus, string> = {
  ok: 'prices in',
  no_results: 'had none of your list',
  blocked: 'blocked our request',
  timeout: 'too slow to answer',
  unserviceable: 'doesn’t deliver here',
  error: 'couldn’t load',
};

/** Why a signed-in account wasn't used this time: a short tag, and the tooltip. */
const ACCOUNT_HINT: Record<NonNullable<PlatformResult['accountProblem']>, [tag: string, tip: string]> = {
  signed_out: ['log in again', 'Your login ended — log in again for your own prices'],
  rate_limited: ['busy, try later', 'Your account was busy — try again in a bit'],
  no_address: ['add address', 'Add an address in the app to get your own prices'],
  unsupported: ['login not used', 'Your login couldn’t be used here — these are public prices'],
  failed: ['login not used', 'Your login couldn’t be used this time — these are public prices'],
};

function StatusIcon({ status }: { status: PlatformStatus | 'waiting' }) {
  switch (status) {
    case 'waiting':
      return <SpinnerGapIcon size={14} className="animate-spin" aria-hidden />;
    case 'ok':
      return <CheckCircleIcon size={14} weight="fill" className="text-good" aria-hidden />;
    case 'blocked':
      return <ProhibitIcon size={14} aria-hidden />;
    case 'timeout':
      return <TimerIcon size={14} aria-hidden />;
    case 'unserviceable':
      return <MapPinSimpleIcon size={14} aria-hidden />;
    default:
      return <WarningCircleIcon size={14} aria-hidden />;
  }
}

/** Chip tint by status: green = prices in, neutral = waiting or none, amber = couldn't check, red = doesn't deliver. */
function tone(status: PlatformStatus | 'waiting'): string {
  switch (status) {
    case 'ok':
      return 'border-good-line bg-good-soft';
    case 'waiting':
      return 'border-line bg-card text-muted';
    case 'no_results':
      return 'border-line bg-soft text-muted';
    case 'unserviceable':
      return 'border-bad-line bg-bad-soft text-bad';
    default:
      return 'border-warn-line bg-warn-soft text-warn';
  }
}

/** One chip per app: live progress while searching, then an honest (short) status. */
export function ProgressBoard({ state }: { state: CompareState; phase: Phase }) {
  const ids: PlatformId[] = state.platforms;
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => {
        const meta = PLATFORMS[id];
        const result = state.results[id];
        const prog = state.progress[id];
        const status = result?.status ?? 'waiting';
        const used = result?.account === 'used';
        const hint = result?.account === 'unavailable' ? ACCOUNT_HINT[result.accountProblem ?? 'failed'] : null;
        const label = status === 'waiting' ? (prog ? `${prog.done}/${prog.total}` : '…') : used ? 'your prices' : STATUS_SHORT[status];
        const title = [
          `${meta.name}: ${status === 'waiting' ? 'checking…' : used ? 'your account’s prices' : STATUS_LONG[status]}`,
          used ? result?.accountNote : null,
          hint?.[1],
          result?.error,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div
            key={id}
            title={title}
            data-platform={id}
            data-platform-status={status}
            className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${tone(used ? 'ok' : status)}`}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} aria-hidden />
            <span className="text-[0.8rem] font-medium text-fg">{meta.name}</span>
            <StatusIcon status={status} />
            {label ? <span className={`tabular-nums ${used ? 'font-medium text-good' : ''}`}>{label}</span> : <span className="sr-only">prices in</span>}
            {hint && <span className="rounded-full border border-current px-1.5 text-[0.65rem] whitespace-nowrap">{hint[0]}</span>}
          </div>
        );
      })}
    </div>
  );
}
