import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatRupees, PLATFORMS } from '@gc/engine';
import { JsonLd } from '@/components/JsonLd';
import { CompareCta, PageShell } from '@/components/seo/PageShell';
import { absolute, appFees, BASKETS, feesCheckedAt, membershipsFor, PAIRS, pairBySlug } from '@/lib/seo';
import { SITE } from '@/lib/site';

// Only the fifteen real pairs exist; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return PAIRS.map((p) => ({ pair: p.slug }));
}

type Props = { params: Promise<{ pair: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const pair = pairBySlug((await params).pair);
  if (!pair) return {};
  const { a, b } = pair;
  const title = `${a.short} vs ${b.short}: fees & which is cheaper`;
  const description = `${a.name} or ${b.name}? Delivery, handling and small-cart fees side by side, what each costs on ₹80–₹600 baskets, and how to find the cheaper app for your list.`;
  return {
    title,
    description,
    alternates: { canonical: `/compare/${pair.slug}` },
    openGraph: { url: `/compare/${pair.slug}`, title, description },
    twitter: { title, description },
  };
}

const speed = (id: keyof typeof PLATFORMS) => (PLATFORMS[id].delivery === 'quick' ? 'Quick delivery, in minutes' : 'Scheduled delivery slots');

export default async function ComparePage({ params }: Props) {
  const pair = pairBySlug((await params).pair);
  if (!pair) notFound();
  const { a, b } = pair;
  const fa = appFees(a.id);
  const fb = appFees(b.id);
  const updated = feesCheckedAt();
  const title = `${a.short} vs ${b.short}: fees, free delivery and which is cheaper`;
  const cheaperAt = BASKETS.map((basket, i) => {
    const x = fa.at[i] ?? null;
    const y = fb.at[i] ?? null;
    if (x === null && y === null) return { basket, x, y, winner: '—' };
    if (x === null) return { basket, x, y, winner: b.short };
    if (y === null) return { basket, x, y, winner: a.short };
    return { basket, x, y, winner: Math.abs(x - y) < 0.01 ? 'Same' : x < y ? a.short : b.short };
  });
  const related = PAIRS.filter((p) => p.slug !== pair.slug && (p.a.id === a.id || p.b.id === a.id || p.a.id === b.id || p.b.id === b.id)).slice(0, 8);

  return (
    <PageShell
      crumbs={[
        { name: 'Grocery fees', path: '/fees' },
        { name: `${a.short} vs ${b.short}`, path: `/compare/${pair.slug}` },
      ]}
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: title,
          url: absolute(`/compare/${pair.slug}`),
          dateModified: updated,
          inLanguage: 'en-IN',
          isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE.url },
          about: [a.name, b.name].map((name) => ({ '@type': 'Organization', name })),
        }}
      />
      <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        Item prices on {a.short} and {b.short} usually differ by a few rupees; the fees on top often decide which order costs less.
        Here are both apps’ published fees, checked {updated}.
      </p>

      <h2 className="mt-10 text-2xl font-semibold tracking-tight">Fees at a glance</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-card shadow-card">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            {a.short} and {b.short} fees compared
          </caption>
          <thead className="border-b border-line bg-soft text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Fee
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {a.name}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {b.name}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(
              [
                ['Delivery fee', fa.delivery, fb.delivery],
                ['Free delivery from', fa.freeAbove, fb.freeAbove],
                ['Handling fee', fa.handling, fb.handling],
                ['Small-cart fee', fa.smallCart, fb.smallCart],
                ['Minimum order', fa.minOrder, fb.minOrder],
                ['Delivery style', speed(a.id), speed(b.id)],
              ] as const
            ).map(([label, x, y]) => (
              <tr key={label}>
                <th scope="row" className="px-4 py-3 font-medium">
                  {label}
                </th>
                <td className="px-4 py-3 tabular-nums">{x}</td>
                <td className="px-4 py-3 tabular-nums">{y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-2xl font-semibold tracking-tight">Which is cheaper on fees, by basket size</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-card shadow-card">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Total fees on each app by basket size</caption>
          <thead className="border-b border-line bg-soft text-muted">
            <tr>
              {['Items worth', `${a.short} fees`, `${b.short} fees`, 'Lower fees'].map((h) => (
                <th key={h} scope="col" className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {cheaperAt.map((r) => (
              <tr key={r.basket}>
                <th scope="row" className="px-4 py-3 font-medium tabular-nums">
                  {formatRupees(r.basket)}
                </th>
                <td className="px-4 py-3 tabular-nums">{r.x === null ? 'below minimum' : r.x === 0 ? 'free' : formatRupees(r.x)}</td>
                <td className="px-4 py-3 tabular-nums">{r.y === null ? 'below minimum' : r.y === 0 ? 'free' : formatRupees(r.y)}</td>
                <td className={`px-4 py-3 font-medium ${r.winner === 'Same' || r.winner === '—' ? 'text-muted' : 'text-good'}`}>{r.winner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {[
          { app: a, fees: fa },
          { app: b, fees: fb },
        ].map(({ app, fees }) => (
          <section key={app.id} className="rounded-2xl border border-line bg-card p-5 shadow-card">
            <h2 className="font-semibold">{app.name} fees</h2>
            <ul className="mt-2 space-y-1 text-sm text-fg/80">
              {fees.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
              {membershipsFor(app.id).map((m) => (
                <li key={m}>Membership: {m}</li>
              ))}
            </ul>
            {fees.notes.length > 0 && <p className="mt-2 text-sm text-muted">{fees.notes.join(' ')}</p>}
            <p className="mt-3 text-xs text-muted">
              Sources:{' '}
              {fees.sources.map((s, i) => (
                <span key={s.url + s.title}>
                  {i > 0 && ' · '}
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 hover:text-fg">
                    {s.title}
                  </a>{' '}
                  ({s.date})
                </span>
              ))}
            </p>
          </section>
        ))}
      </div>

      <h2 className="mt-10 text-2xl font-semibold tracking-tight">So which should you order from?</h2>
      <p className="mt-2 max-w-2xl text-fg/80">
        The fees above are only half of it: prices of the same item, stock at your nearest store and your own account’s fees
        all change the answer, and sometimes splitting one list across both apps is cheapest. {SITE.name} checks {a.short},{' '}
        {b.short} and four more apps live at your location and gives you the cheapest way to buy your whole list, fees
        included.
      </p>
      <CompareCta>Compare your list on {a.short}, {b.short} & more</CompareCta>

      {related.length > 0 && (
        <>
          <h2 className="mt-12 text-lg font-semibold">More comparisons</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {related.map((p) => (
              <li key={p.slug}>
                <Link href={`/compare/${p.slug}`} className="inline-block rounded-full border border-line bg-card px-3 py-1.5 text-sm transition-colors hover:bg-soft">
                  {p.a.short} vs {p.b.short}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/fees" className="inline-block rounded-full border border-line bg-card px-3 py-1.5 text-sm transition-colors hover:bg-soft">
                All apps’ fees
              </Link>
            </li>
          </ul>
        </>
      )}
    </PageShell>
  );
}
