/**
 * The fee catalog: each platform's order-level fees as best known, with the
 * source, date and confidence of every number. Seeded from
 * docs/research/2026-09-27-fee-research.md; re-verify monthly (docs/FEES.md).
 *
 * Fees vary by city, time, demand and even account, so these are defaults.
 * Live hints from the platform's own response override them field by field,
 * and the user's own numbers override everything. Rules marked approximate
 * display with "≈".
 */
import type { FeeSchedule, MembershipEffect, PlatformId } from './types';

const CHECKED = '2026-09-27';

export const FEE_CATALOG: FeeSchedule[] = [
  {
    platformId: 'blinkit',
    cities: 'default',
    minOrder: null,
    rules: [
      { kind: 'flat', label: 'Handling', amount: 2 },
      { kind: 'below', label: 'Delivery', amount: 25, threshold: 99 },
    ],
    variants: [],
    notes: [
      'Read live from Blinkit’s own cart on 2026-09-29 (Bengaluru, Mumbai): ₹25 delivery below ₹99, ₹2 handling, no small-cart fee. Blinkit tests fees per device, so yours may differ.',
      'Rain and high-demand surcharges apply at times; when Blinkit shows one, it is used.',
    ],
    sources: [
      { title: 'Blinkit’s own guest cart, read live by jhola (Bengaluru, Mumbai)', url: 'https://blinkit.com', date: '2026-09-29', confidence: 'confirmed' },
      { title: 'Upstox: Zepto scraps handling, surge fees; vs Instamart, Blinkit', url: 'https://upstox.com/news/business-news/latest-updates/zepto-scraps-all-handling-surge-fees-how-does-it-stack-up-against-instamart-and-blinkit/article-183964/', date: '2025-11-03', confidence: 'confirmed' },
      { title: "Inc42: India's convenience economy is getting expensive", url: 'https://inc42.com/features/indias-convenience-economy-is-getting-expensive/', date: '2026-03-31', confidence: 'confirmed' },
      { title: 'DesiDime users: fee snapshot across apps (handling ₹5–9)', url: 'https://www.desidime.com/discussions/jiomart-delivery-charges-f4b73b90-bbb9-441a-ba9c-c7bd28240b03', date: '2026-06-08', confidence: 'uncertain' },
      { title: 'ANI / Jefferies: free-delivery threshold ≈ ₹199', url: 'https://english.punjabkesari.com/business/quick-commerce-sector-shows-signs-of-pricing-discipline-as-discounting-moderates-jefferies', date: '2026-09-25', confidence: 'confirmed' },
    ],
    checkedAt: '2026-09-29',
  },
  {
    platformId: 'zepto',
    cities: 'default',
    minOrder: null,
    rules: [{ kind: 'below', label: 'Delivery', amount: 30, threshold: 199, approximate: true }],
    variants: [
      { id: 'peak', label: 'Peak demand', rules: [{ kind: 'below', label: 'Delivery', amount: 30, threshold: 299, approximate: true }] },
    ],
    notes: [
      'Handling fee differs by account (₹0–40 reported), so it is not included — add yours in fee settings.',
      'At peak demand the free-delivery threshold rises to ₹299.',
    ],
    sources: [
      { title: 'Goodreturns: Zepto free-delivery threshold ₹199, up to ₹299 at peak', url: 'https://www.goodreturns.in/news/zepto-free-delivery-charges-increased-minimum-order-value-raised-to-rs-199-check-new-rule-for-smal-1529635.html', date: '2026-08-20', confidence: 'confirmed' },
      { title: 'Curly Tales: Zepto ends free delivery below ₹99 (₹20 fee)', url: 'https://curlytales.com/india/trending/zepto-ends-free-delivery-below-check-minimum-order-value-to-avoid-delivery-charge/', date: '2026-01-09', confidence: 'confirmed' },
      { title: "Inc42: Zepto's retention play — fee waivers pulled back", url: 'https://inc42.com/features/zeptos-retention-play-fewer-discounts-premium-carts-a-paid-club/', date: '2026-09-01', confidence: 'confirmed' },
      { title: 'DesiDime users: Zepto handling ₹0–40 by account', url: 'https://www.desidime.com/discussions/jiomart-delivery-charges-f4b73b90-bbb9-441a-ba9c-c7bd28240b03', date: '2026-06-08', confidence: 'uncertain' },
    ],
    checkedAt: CHECKED,
  },
  {
    platformId: 'instamart',
    cities: 'default',
    minOrder: null,
    rules: [
      { kind: 'flat', label: 'Handling', amount: 10, approximate: true },
      { kind: 'below', label: 'Delivery', amount: 30, threshold: 199 },
      { kind: 'below', label: 'Small cart', amount: 15, threshold: 99, approximate: true },
    ],
    variants: [],
    notes: ['Late-night (≈₹10), surge and festive handling fees apply at times.'],
    sources: [
      { title: 'Upstox: Instamart ₹30 delivery below ₹199, ₹9.8 handling, ₹15 small cart', url: 'https://upstox.com/news/business-news/latest-updates/zepto-scraps-all-handling-surge-fees-how-does-it-stack-up-against-instamart-and-blinkit/article-183964/', date: '2025-11-03', confidence: 'confirmed' },
      { title: 'Swiggy Q4 FY26 shareholder letter: delivery-fee charging resumed', url: 'https://www.swiggy.com/corporate/wp-content/uploads/2026/05/Q4-FY2026-Shareholder-letter.pdf', date: '2026-05-08', confidence: 'confirmed' },
      { title: 'DesiDime users: Instamart handling ₹5–12 since Feb 2026', url: 'https://www.desidime.com/discussions/swiggy-again-started-charging-handling-fee-for-instamart-orders', date: '2026-02-01', confidence: 'uncertain' },
    ],
    checkedAt: CHECKED,
  },
  {
    platformId: 'jiomart',
    cities: 'default',
    minOrder: 99,
    rules: [{ kind: 'below', label: 'Delivery', amount: 30, threshold: 199 }],
    variants: [],
    notes: [
      'Read live from JioMart’s own fee quote on 2026-09-29 (Bengaluru, Mumbai): ₹99 minimum order, ₹30 delivery below ₹199. The ₹399 figure people quote is JioMart’s other, non-quick basket.',
      'First orders often get free delivery.',
    ],
    sources: [
      { title: 'JioMart’s own fee quote and store lookup, read live by jhola (Bengaluru, Mumbai)', url: 'https://www.jiomart.com', date: '2026-09-29', confidence: 'confirmed' },
      { title: 'DesiDime users: JioMart quick ₹30 below ₹400', url: 'https://www.desidime.com/discussions/jiomart-delivery-charges-f4b73b90-bbb9-441a-ba9c-c7bd28240b03', date: '2026-06-08', confidence: 'uncertain' },
      { title: 'DesiDime users: JioMart removed ₹30 fee below ₹200', url: 'https://www.desidime.com/discussions/jiomart-removed-30-delivery-fee-on-quick-orders-below-200', date: '2025-09-30', confidence: 'uncertain' },
      { title: 'Inc42: JioMart Quick in 1,000 cities', url: 'https://inc42.com/buzz/reliance-expands-quick-jiomart-deliveries-to-1000-cities/', date: '2025-10-18', confidence: 'confirmed' },
    ],
    checkedAt: '2026-09-29',
  },
  {
    platformId: 'dmart',
    cities: 'default',
    minOrder: null,
    rules: [{ kind: 'flat', label: 'Home delivery', amount: 49 }],
    variants: [],
    notes: ['DMart has a minimum order; the amount is not published.', 'Pickup points are free; this plan assumes home delivery.'],
    sources: [
      { title: 'DMart Ready FAQs and checkout (₹49 flat home delivery)', url: 'https://www.dmart.in/service/faqs', date: '2026-09-27', confidence: 'confirmed' },
      { title: 'RetailIntel: DMart Ready retreats to 11 cities', url: 'https://retailintel.in/signal/dmart-ready-retreats-to-11-cities-as-quick-commerce-reshapes-8306e5d2', date: '2026-09-07', confidence: 'confirmed' },
    ],
    checkedAt: CHECKED,
  },
  {
    platformId: 'bigbasket',
    cities: 'default',
    minOrder: null,
    rules: [
      { kind: 'flat', label: 'Handling', amount: 6, approximate: true },
      { kind: 'below', label: 'Delivery', amount: 30, threshold: 199, approximate: true },
    ],
    variants: [],
    notes: ['BB Now fees vary with order value, time of day and weather.'],
    sources: [
      { title: 'BigBasket delivery-charge FAQ (fees vary)', url: 'https://www.bigbasket.com/delivery-charge/', date: '2026-09-27', confidence: 'confirmed' },
      { title: 'DesiDime users: BB Now ₹30 below ₹199', url: 'https://www.desidime.com/discussions/bigbasket-increased-mov-from-99-to-199-for-free-delivery', date: '2026-04-24', confidence: 'uncertain' },
    ],
    checkedAt: CHECKED,
  },
];

/**
 * Memberships whose fee effect is sourced. Swiggy One is left out until its
 * Instamart effect is confirmed: sources conflict (spec, "What v1 does").
 */
export const MEMBERSHIPS: MembershipEffect[] = [
  {
    membershipId: 'zepto_club',
    platformId: 'zepto',
    label: 'Zepto Club — free delivery from ₹99',
    changes: [{ rule: 'Delivery', threshold: 99 }],
    confirmed: true,
  },
];

export function catalogSchedule(platformId: PlatformId, city?: string): FeeSchedule {
  const entries = FEE_CATALOG.filter((s) => s.platformId === platformId);
  const byCity = city ? entries.find((s) => s.cities !== 'default' && s.cities.some((c) => c.toLowerCase() === city.toLowerCase())) : undefined;
  const found = byCity ?? entries.find((s) => s.cities === 'default');
  if (!found) throw new Error(`No fee schedule for ${platformId}`);
  return found;
}
