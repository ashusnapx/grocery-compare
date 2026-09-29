import Link from 'next/link';
import type { ReactNode } from 'react';
import { JsonLd } from '@/components/JsonLd';
import { SiteFooter } from '@/components/SiteFooter';
import { absolute } from '@/lib/seo';
import { SITE } from '@/lib/site';

/** A content page: breadcrumb (visible and as structured data), the page, and the footer. */
export function PageShell({ crumbs, children }: { crumbs: { name: string; path: string }[]; children: ReactNode }) {
  const trail = [{ name: SITE.name, path: '/' }, ...crumbs];
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: trail.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: absolute(c.path) })),
        }}
      />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-1.5">
            {trail.map((c, i) => (
              <li key={c.path} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>/</span>}
                {i < trail.length - 1 ? (
                  <Link href={c.path} className="transition-colors hover:text-fg">
                    {c.name}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-fg">
                    {c.name}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

/** The one call to action every content page ends with. */
export function CompareCta({ children = 'Compare your list on every app' }: { children?: ReactNode }) {
  return (
    <Link href="/" className="btn-primary mt-8 inline-flex items-center gap-2 rounded-lg px-5 py-3 text-base font-medium">
      {children} →
    </Link>
  );
}
