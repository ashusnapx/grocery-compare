import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRupees } from '@gc/engine';
import { CompareCta, PageShell } from '@/components/seo/PageShell';
import { APPS, appFees, BASKETS, feesCheckedAt, membershipsFor, PAIRS } from '@/lib/seo';

const updated = feesCheckedAt();

const title = 'Grocery delivery fees in India, app by app';
const description = 'Blinkit, Zepto, Instamart, BigBasket, JioMart and DMart fees side by side: delivery, free-delivery threshold, handling, small cart, and totals by basket size.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/fees' },
  openGraph: { url: '/fees', title, description },
  twitter: { title, description },
};

export default function FeesPage() {
  const rows = APPS.map((a) => ({ app: a, fees: appFees(a.id) }));
  return (
    <PageShell crumbs={[{ name: 'Grocery fees', path: '/fees' }]}>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">Grocery delivery fees, app by app</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        What each app charges on top of your items at its published rates, checked {updated}. Fees change by city, time and
        account — jhola reads them live when you compare.
      </p>

      <div className="mt-8 overflow-x-auto rounded-2xl border border-line bg-card shadow-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Delivery, handling and small-cart fees on each grocery app</caption>
          <thead className="border-b border-line bg-soft text-muted">
            <tr>
              {['App', 'Delivery fee', 'Free delivery from', 'Handling', 'Small cart', 'Minimum order'].map((h) => (
                <th key={h} scope="col" className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ app, fees }) => (
              <tr key={app.id} id={app.slug}>
                <th scope="row" className="px-4 py-3 font-semibold">
                  {app.name}
                </th>
                <td className="px-4 py-3 tabular-nums">{fees.delivery}</td>
                <td className="px-4 py-3 tabular-nums">{fees.freeAbove}</td>
                <td className="px-4 py-3 tabular-nums">{fees.handling}</td>
                <td className="px-4 py-3 tabular-nums">{fees.smallCart}</td>
                <td className="px-4 py-3 tabular-nums">{fees.minOrder}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">What the fees add up to</h2>
      <p className="mt-2 text-muted">Total fees on one order, by basket size (items only, before fees).</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-card shadow-card">
        <table className="w-full min-w-[560px] text-left text-sm">
          <caption className="sr-only">Total fees on each app for baskets of ₹80 to ₹600</caption>
          <thead className="border-b border-line bg-soft text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                App
              </th>
              {BASKETS.map((b) => (
                <th key={b} scope="col" className="px-4 py-3 font-medium tabular-nums">
                  {formatRupees(b)} basket
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ app, fees }) => (
              <tr key={app.id}>
                <th scope="row" className="px-4 py-3 font-semibold">
                  {app.short}
                </th>
                {fees.at.map((f, i) => (
                  <td key={BASKETS[i]} className="px-4 py-3 tabular-nums">
                    {f === null ? <span className="text-muted">below minimum</span> : f === 0 ? <span className="text-good">free</span> : formatRupees(f)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">Notes and sources</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {rows.map(({ app, fees }) => {
          const members = membershipsFor(app.id);
          return (
            <section key={app.id} className="rounded-2xl border border-line bg-card p-5 shadow-card">
              <h3 className="font-semibold">{app.name}</h3>
              <ul className="mt-2 space-y-1 text-sm text-fg/80">
                {fees.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
                {members.map((m) => (
                  <li key={m}>Membership: {m}</li>
                ))}
              </ul>
              {fees.notes.length > 0 && <p className="mt-2 text-sm text-muted">{fees.notes.join(' ')}</p>}
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {fees.sources.map((s) => (
                  <li key={s.url + s.title}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 hover:text-fg">
                      {s.title}
                    </a>{' '}
                    · {s.date}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">Head to head</h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {PAIRS.map((p) => (
          <li key={p.slug}>
            <Link href={`/compare/${p.slug}`} className="inline-block rounded-full border border-line bg-card px-3 py-1.5 text-sm transition-colors hover:bg-soft">
              {p.a.short} vs {p.b.short}
            </Link>
          </li>
        ))}
      </ul>

      <CompareCta />
    </PageShell>
  );
}
