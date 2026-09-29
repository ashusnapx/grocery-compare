'use client';

import { useEffect, useState } from 'react';
import { formatRupees, type GeoLocation, type Listing } from '@gc/engine';
import { accessToken, isSignedIn, signOut, startSignIn } from '@/lib/account/oauth';
import { ACCOUNT_PROVIDERS, type AccountPlatform } from '@/lib/account/providers';
import { load } from '@/lib/storage';

interface Check {
  tools: { name: string; params: string[]; description: string }[];
  address: string;
  search: string | null;
  raw: string | null;
  listings: Listing[];
  error?: string;
}

/**
 * Checking a connected account by hand: the tools the app offers, the saved
 * address it used, and one search shown raw next to how jhola reads it.
 * Not linked from the app.
 */
export default function ConnectPage() {
  return (
    <main className="mx-auto grid max-w-3xl gap-6 bg-bg p-4 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Connected accounts · check</h1>
      {(Object.keys(ACCOUNT_PROVIDERS) as AccountPlatform[]).map((id) => (
        <Provider key={id} id={id} />
      ))}
    </main>
  );
}

function Provider({ id }: { id: AccountPlatform }) {
  const p = ACCOUNT_PROVIDERS[id];
  const [on, setOn] = useState(false);
  const [query, setQuery] = useState('amul butter');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);

  useEffect(() => setOn(isSignedIn(id)), [id]);

  const run = async () => {
    setBusy(true);
    try {
      const token = await accessToken(id);
      if (!token) {
        setOn(false);
        return;
      }
      const pincode = load<GeoLocation | null>('location', null)?.pincode ?? '560034';
      const res = await fetch('/api/account/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platformId: id, token, query, pincode }),
      });
      setCheck((await res.json()) as Check);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-3 rounded-2xl border border-line bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{p.name}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${on ? 'bg-good-soft text-good' : 'bg-soft text-muted'}`}>{on ? 'connected' : 'not connected'}</span>
        {on ? (
          <button type="button" className="btn-secondary h-8 px-3 text-sm" onClick={() => (signOut(id), setOn(false))}>
            Log out
          </button>
        ) : (
          <button type="button" className="btn-primary h-8 px-3 text-sm" onClick={() => void startSignIn(id, { returnTo: '/connect' })}>
            Log in
          </button>
        )}
      </div>

      {on && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-card px-3 text-sm outline-none focus:border-focus focus:ring-4 focus:ring-focus/15"
            aria-label="Search"
          />
          <button type="submit" disabled={busy} className="btn-secondary h-9 px-3 text-sm">
            {busy ? 'Checking…' : 'Check'}
          </button>
        </form>
      )}

      {check?.error && <p className="text-sm font-medium text-bad">{check.error}</p>}
      {check && !check.error && (
        <>
          <p className="text-sm">
            Address: <b>{check.address}</b> · search tool: <b>{check.search ?? 'none'}</b> · read {check.listings.length} products
          </p>
          <ul className="grid gap-1 font-mono text-xs">
            {check.tools.map((t) => (
              <li key={t.name}>
                <b>{t.name}</b>({t.params.join(', ')}) — {t.description}
              </li>
            ))}
          </ul>
          <table className="text-left text-xs">
            <tbody>
              {check.listings.map((l) => (
                <tr key={l.listingId} className="border-t border-line">
                  <td className="py-1 pr-2">{l.title}</td>
                  <td className="pr-2 font-mono">{l.quantityText || '—'}</td>
                  <td className="pr-2 font-mono">{formatRupees(l.price)}</td>
                  <td className="pr-2 font-mono">{l.mrp ? formatRupees(l.mrp) : ''}</td>
                  <td>{l.inStock ? 'in stock' : 'out'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {check.raw && <pre className="max-h-96 overflow-auto rounded-lg bg-soft p-3 text-[0.7rem]">{check.raw}</pre>}
        </>
      )}
    </section>
  );
}
