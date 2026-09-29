import type { MetadataRoute } from 'next';
import { feesCheckedAt, PAIRS } from '@/lib/seo';
import { SITE } from '@/lib/site';

/** Every public page; the fee pages carry the date their numbers were last checked. */
export default function sitemap(): MetadataRoute.Sitemap {
  const checked = new Date(feesCheckedAt());
  return [
    { url: SITE.url, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE.url}/fees`, lastModified: checked, changeFrequency: 'weekly', priority: 0.8 },
    ...PAIRS.map((p) => ({ url: `${SITE.url}/compare/${p.slug}`, lastModified: checked, changeFrequency: 'weekly' as const, priority: 0.7 })),
    { url: `${SITE.url}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
