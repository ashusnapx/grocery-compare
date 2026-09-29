'use client';

import { CheckCircleIcon, GearSixIcon, SignInIcon, XIcon } from '@phosphor-icons/react';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { catalogSchedule, formatRupees, MEMBERSHIPS, PLATFORMS, resolveSchedule, type FeeRule, type PlanSettings, type PlatformId } from '@gc/engine';
import { startSignIn } from '@/lib/account/oauth';
import { isAccountPlatform } from '@/lib/account/providers';
import type { PlatformResult } from '@/lib/compare-types';
import { PlatformBadge } from './PlatformBadge';

interface Props {
  settings: PlanSettings;
  platforms: PlatformId[];
  /** What each app said in the last comparison: live fee hints, and the shopper's own account. */
  results: Partial<Record<PlatformId, PlatformResult>>;
  onChange: (s: PlanSettings) => void;
  /** Controlled open state, so other parts of the page can open the sheet. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function describe(rule: FeeRule): string {
  const about = rule.approximate ? '≈' : '';
  switch (rule.kind) {
    case 'flat':
      return `${rule.label} ${about}${formatRupees(rule.amount)}`;
    case 'below':
      return `${rule.label} ${about}${formatRupees(rule.amount)} below ${formatRupees(rule.threshold)}`;
    case 'tiered':
      return `${rule.label} ${rule.tiers.map((t) => `${formatRupees(t.amount)} from ${formatRupees(t.from)}`).join(', ')}`;
  }
}

/**
 * Apps & fees, asked of nobody: each app's fees come from the shopper's own
 * account when they're logged in, else from what the app states live, else
 * from its published rules. The only choice left here is which apps to use.
 */
export function SettingsSheet({ settings, platforms, results, onChange, open: openProp, onOpenChange }: Props) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const toggleApp = (p: PlatformId) =>
    onChange({ ...settings, excluded: settings.excluded.includes(p) ? settings.excluded.filter((x) => x !== p) : [...settings.excluded, p] });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label="Apps & fees" title="Apps & fees" className="btn-ghost size-9">
          <GearSixIcon size={18} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-y-3 right-3 z-50 w-[min(94vw,460px)] overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-xl font-semibold tracking-tight">Apps &amp; fees</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">From your account when you’re logged in, else live from the app.</Dialog.Description>
            </div>
            <Dialog.Close className="btn-ghost -mt-1 -mr-2 size-8 shrink-0" aria-label="Close">
              <XIcon size={16} />
            </Dialog.Close>
          </div>

          <h4 className="mt-6 text-sm font-medium text-muted">Apps to use</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {platforms.map((p) => {
              const off = settings.excluded.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggleApp(p)}
                  className={`press flex h-8 items-center rounded-full border px-3 ${off ? 'border-dashed border-line text-muted opacity-60 grayscale' : 'border-line bg-card hover:bg-soft'}`}
                  aria-pressed={!off}
                  title={off ? `Use ${PLATFORMS[p].name}` : `Don’t use ${PLATFORMS[p].name}`}
                >
                  <PlatformBadge id={p} className={off ? 'line-through' : ''} />
                </button>
              );
            })}
          </div>

          <h4 className="mt-6 text-sm font-medium text-muted">Fees used</h4>
          <div className="mt-2 flex flex-col gap-3">
            {platforms.map((p) => {
              const r = results[p];
              const catalog = catalogSchedule(p);
              const memberships = r?.accountFees?.memberships ?? [];
              const resolved = resolveSchedule(catalog, { hints: r?.feeHints, memberships });
              const fromAccount = r?.account === 'used' && !!r.accountFees?.source;
              const live = !fromAccount && Object.values(r?.feeHints ?? {}).some((v) => v !== null && v !== undefined);
              const canLogIn = isAccountPlatform(p) && r?.account !== 'used';
              return (
                <div key={p} className="rounded-xl border border-line p-3.5" data-app={p}>
                  <div className="flex items-center justify-between gap-2">
                    <PlatformBadge id={p} />
                    {fromAccount ? (
                      <span className="flex items-center gap-1 rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good" title={`Read from ${r?.accountFees?.source}`}>
                        <CheckCircleIcon size={12} weight="fill" /> your account
                      </span>
                    ) : live ? (
                      <span className="rounded-full border border-line px-2 py-0.5 text-xs font-medium text-muted">live</span>
                    ) : (
                      <span className="text-xs text-muted">published · {catalog.checkedAt}</span>
                    )}
                  </div>
                  <p className="mt-2 text-[0.8rem] leading-relaxed">
                    {resolved.rules.length ? resolved.rules.map(describe).join(' · ') : 'No fees'}
                    {resolved.minOrder ? ` · minimum order ${formatRupees(resolved.minOrder)}` : ''}
                  </p>
                  {memberships.length > 0 && (
                    <p className="mt-1 text-xs font-medium">
                      {MEMBERSHIPS.filter((m) => memberships.includes(m.membershipId)).map((m) => `${m.label} ✓`).join(' · ') || memberships.join(', ')}
                    </p>
                  )}
                  {canLogIn && (
                    <button
                      type="button"
                      onClick={() => void startSignIn(p, { returnTo: window.location.pathname })}
                      className="btn-secondary mt-2.5 h-8 gap-1.5 px-2.5 text-xs"
                    >
                      <SignInIcon size={13} weight="bold" className="text-good" /> Log in for your fees
                    </button>
                  )}
                  <details className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer font-medium hover:text-fg">Notes &amp; sources ({catalog.sources.length})</summary>
                    {catalog.notes.length > 0 && <p className="mt-1 leading-snug">{catalog.notes.join(' ')}</p>}
                    <ul className="mt-1 list-disc pl-4">
                      {catalog.sources.map((s) => (
                        <li key={s.url + s.title}>
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">
                            {s.title}
                          </a>{' '}
                          · {s.date} · {s.confidence}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted">Surge, rain &amp; late-night fees can’t be known ahead, so plans skip them.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
