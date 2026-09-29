'use client';

import { CheckCircleIcon, SpinnerGapIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { finishSignIn } from '@/lib/account/oauth';
import { refreshName } from '@/lib/account/profile';
import { ACCOUNT_PROVIDERS } from '@/lib/account/providers';

type State = { kind: 'working' } | { kind: 'done'; name: string } | { kind: 'error'; message: string };

/** Where an app's sign-in page sends the shopper back to. */
export default function CallbackPage() {
  const [state, setState] = useState<State>({ kind: 'working' });
  const ran = useRef(false);

  useEffect(() => {
    // The sign-in code works once; React may run effects twice in development.
    if (ran.current) return;
    ran.current = true;
    finishSignIn(new URLSearchParams(window.location.search))
      .then(async ({ platformId, returnTo }) => {
        setState({ kind: 'done', name: ACCOUNT_PROVIDERS[platformId].name });
        // The shopper's first name, for the greeting; never holds up the way back for long.
        await Promise.race([refreshName(true).catch(() => null), new Promise((r) => setTimeout(r, 3000))]);
        window.location.replace(returnTo);
      })
      .catch((e: unknown) => setState({ kind: 'error', message: e instanceof Error ? e.message : 'Sign-in failed' }));
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-6 text-center shadow-card">
        {state.kind === 'working' && (
          <p className="flex items-center justify-center gap-2 text-lg font-semibold">
            <SpinnerGapIcon size={20} className="animate-spin text-muted" /> Connecting…
          </p>
        )}
        {state.kind === 'done' && (
          <p className="flex items-center justify-center gap-2 text-lg font-semibold">
            <CheckCircleIcon size={22} weight="fill" className="text-good" /> {state.name} connected
          </p>
        )}
        {state.kind === 'error' && (
          <>
            <p className="flex items-center justify-center gap-2 text-lg font-semibold">
              <WarningCircleIcon size={22} weight="fill" className="text-bad" /> Didn’t connect
            </p>
            <p className="mt-2 text-sm text-muted">{state.message}</p>
            <a href="/" className="btn-primary mt-4 h-10 px-4 text-sm">
              Back to jhola
            </a>
          </>
        )}
      </div>
    </main>
  );
}
