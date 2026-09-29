import { GroceryApp } from '@/components/app/GroceryApp';
import { JsonLd } from '@/components/JsonLd';
import { HomeGuide } from '@/components/seo/HomeGuide';
import { APPS, FAQ } from '@/lib/seo';
import { SITE } from '@/lib/site';

/** What the home page is, for search engines: the site, the free web app, who made it, and its FAQ. */
const STRUCTURED = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE.url}/#website`,
      url: SITE.url,
      name: SITE.name,
      description: SITE.description,
      inLanguage: 'en-IN',
      publisher: { '@id': `${SITE.url}/#author` },
    },
    {
      '@type': 'WebApplication',
      '@id': `${SITE.url}/#app`,
      name: SITE.name,
      url: SITE.url,
      description: SITE.description,
      applicationCategory: 'ShoppingApplication',
      operatingSystem: 'Any (web browser)',
      browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
      areaServed: { '@type': 'Country', name: 'India' },
      featureList: [
        `Compares grocery prices on ${APPS.map((a) => a.name).join(', ')}`,
        'Counts delivery, handling and small-cart fees',
        'Finds the cheapest split across apps, or the best plan with fewer orders',
        'Uses your own account prices and fees when you log in to Zepto or Instamart',
      ],
      author: { '@id': `${SITE.url}/#author` },
    },
    {
      '@type': 'Person',
      '@id': `${SITE.url}/#author`,
      name: SITE.author.handle,
      url: SITE.author.github,
      image: `${SITE.url}${SITE.author.photo}`,
      sameAs: [SITE.author.github, SITE.author.x, SITE.author.linkedin, SITE.author.instagram],
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE.url}/#faq`,
      mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ],
};

export default function Home() {
  return (
    <>
      <JsonLd data={STRUCTURED} />
      <GroceryApp>
        <HomeGuide />
      </GroceryApp>
    </>
  );
}
