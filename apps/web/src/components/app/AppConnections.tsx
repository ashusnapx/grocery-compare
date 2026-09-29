'use client';

import { CheckCircleIcon, SignInIcon, SpinnerGapIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PLATFORMS, type PlatformId } from '@gc/engine';
import { isSignedIn, signOut, startSignIn } from '@/lib/account/oauth';
import { isAccountPlatform, type AccountPlatform } from '@/lib/account/providers';

const APPS: PlatformId[] = ['blinkit', 'zepto', 'instamart', 'bigbasket', 'jiomart', 'dmart'];

const CHIP = 'flex h-8 items-center gap-1.5 rounded-full border text-[0.8rem] font-medium sm:text-sm';

/**
 * One small chip per app. Apps with an official sign-in for other apps (Zepto,
 * Instamart) log in on their own page and turn green; the rest are priced
 * live without a login (tap one to hear why).
 * Test hooks: each chip is `li[data-app][data-state="public" | "login" | "connected"]`.
 */
export function AppConnections() {
  const [signedIn, setSignedIn] = useState<Partial<Record<AccountPlatform, boolean>>>({});
  const [busy, setBusy] = useState<AccountPlatform | null>(null);

  useEffect(() => {
    const read = () => setSignedIn({ zepto: isSignedIn('zepto'), instamart: isSignedIn('instamart') });
    read();
    window.addEventListener('jhola:accounts', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('jhola:accounts', read);
      window.removeEventListener('storage', read);
    };
  }, []);

  const logIn = async (id: AccountPlatform) => {
    setBusy(id);
    try {
      await startSignIn(id, { returnTo: window.location.pathname });
    } catch (e) {
      setBusy(null);
      toast.error(e instanceof Error ? e.message : `Couldn’t open ${PLATFORMS[id].name}’s sign-in`);
    }
  };

  return (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
      aria-labelledby="apps-heading"
      title="Log in where the app allows it and jhola uses your account’s own prices. Your login stays on this phone."
    >
      <h2 id="apps-heading" className="text-sm text-muted">
        Your apps
      </h2>
      <ul className="flex flex-wrap gap-1.5 sm:gap-2">
        {APPS.map((id) => {
          const app = PLATFORMS[id];
          const dot = <span className="size-2 shrink-0 rounded-full" style={{ background: app.color }} aria-hidden />;

          if (!isAccountPlatform(id)) {
            return (
              <li key={id} data-app={id} data-state="public">
                <button
                  type="button"
                  onClick={() => toast(`${app.name} has no official sign-in for other apps yet — its live prices are in every comparison without one.`)}
                  className={`${CHIP} press border-line bg-card px-3 hover:bg-soft`}
                >
                  {dot} {app.name}
                </button>
              </li>
            );
          }

          if (signedIn[id]) {
            return (
              <li key={id} data-app={id} data-state="connected" title={`Using your ${app.name} account’s prices`} className={`${CHIP} border-good-line bg-good-soft pr-1 pl-3`}>
                {dot} {app.name}
                <span className="flex items-center gap-0.5 text-xs text-good">
                  <CheckCircleIcon size={14} weight="fill" aria-hidden /> connected
                </span>
                <button
                  type="button"
                  onClick={() => {
                    signOut(id);
                    toast(`Logged out of ${app.name} — back to its logged-out prices`);
                  }}
                  className="grid size-6 place-items-center rounded-full text-muted transition-colors hover:bg-fg/10 hover:text-fg"
                  aria-label={`Log out of ${app.name}`}
                  title={`Log out of ${app.name}`}
                >
                  <XIcon size={12} weight="bold" />
                </button>
              </li>
            );
          }

          return (
            <li key={id} data-app={id} data-state="login">
              <button
                type="button"
                onClick={() => void logIn(id)}
                disabled={busy !== null}
                title={`Log in for your own ${app.name} prices`}
                className={`${CHIP} press border-line bg-card pr-3 pl-3 hover:bg-soft disabled:opacity-60`}
              >
                {dot} {app.name}
                <span className="ml-0.5 flex items-center gap-1 border-l border-line pl-2 text-xs text-good">
                  {busy === id ? <SpinnerGapIcon size={12} className="animate-spin" /> : <SignInIcon size={12} weight="bold" />} Log in
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
