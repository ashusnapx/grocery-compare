import Link from 'next/link';
import { APPS, appFees, FAQ, PAIRS } from '@/lib/seo';
import { SITE } from '@/lib/site';

const STEPS = [
  { title: 'Add your list', body: 'Type, paste or pick real products — any brand or exactly the one you want.' },
  { title: 'Every app, live', body: `${SITE.name} checks each app’s prices, stock and fees at your exact location.` },
  { title: 'The cheapest split', body: 'One plan, fees included — or the best with fewer orders — and your cart, one tap away.' },
];

/**
 * The quiet part of the home page, below the app: how it works, the apps
 * compared and the questions people search for. Collapsed by default, so the
 * page stays "add your list, get the answer".
 */
export function HomeGuide() {
  return (
    <section aria-labelledby="guide-heading" className="mt-20 border-t border-line pt-12">
      <h2 id="guide-heading" className="text-2xl font-semibold tracking-tight">
        Compare grocery prices across every app, fees included
      </h2>
      <ol className="mt-6 grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-2xl border border-line bg-card p-5 shadow-card">
            <span className="text-sm font-medium text-accent">{i + 1}</span>
            <h3 className="mt-1 font-semibold">{s.title}</h3>
            <p className="mt-1 text-sm text-muted">{s.body}</p>
          </li>
        ))}
      </ol>

      <h2 className="mt-12 text-lg font-semibold">Apps compared</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {APPS.map((a) => {
          const f = appFees(a.id);
          return (
            <li key={a.id}>
              <Link href={`/fees#${a.slug}`} className="block rounded-xl border border-line bg-card px-4 py-3 transition-colors hover:bg-soft">
                <span className="font-medium">{a.name}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Delivery {f.delivery}
                  {f.freeAbove !== '—' && f.freeAbove !== 'never' ? `, free from ${f.freeAbove}` : ''}
                  {f.handling !== '—' ? ` · handling ${f.handling}` : ''}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm">
        <Link href="/fees" className="font-medium text-accent underline-offset-2 hover:underline">
          All grocery delivery fees, side by side →
        </Link>
      </p>

      <h2 className="mt-12 text-lg font-semibold">Popular comparisons</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {PAIRS.map((p) => (
          <li key={p.slug}>
            <Link href={`/compare/${p.slug}`} className="inline-block rounded-full border border-line bg-card px-3 py-1.5 text-sm transition-colors hover:bg-soft">
              {p.a.short} vs {p.b.short}
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 text-lg font-semibold">Questions</h2>
      <div className="mt-3 divide-y divide-line rounded-2xl border border-line bg-card shadow-card">
        {FAQ.map((f) => (
          <details key={f.q} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
              {f.q}
              <span aria-hidden className="text-muted transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
