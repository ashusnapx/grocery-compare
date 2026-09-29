import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** A utility page for signed-in shoppers: never in search results. */
export const metadata: Metadata = { title: 'Connecting', robots: { index: false, follow: false }, alternates: { canonical: null } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
