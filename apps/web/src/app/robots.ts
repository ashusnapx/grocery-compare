import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/** Crawl the pages, not the plumbing: the API, the sign-in return and the account check stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/callback', '/connect'] }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
