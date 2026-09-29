/**
 * What the search-facing pages say, computed from the same fee catalog the
 * planner uses — so a fee page can never disagree with a plan. Published
 * rules only (no one's account or live hints), each with its checked date.
 */
import { catalogSchedule, feeTotal, formatRupees, MEMBERSHIPS, PLATFORMS, resolveSchedule, type FeeRule, type PlatformId } from '@gc/engine';
import { SITE } from './site';

/** Search-friendly names: what people type, not our internal ids. */
export const APPS: { id: PlatformId; slug: string; name: string; short: string }[] = [
  { id: 'blinkit', slug: 'blinkit', name: 'Blinkit', short: 'Blinkit' },
  { id: 'zepto', slug: 'zepto', name: 'Zepto', short: 'Zepto' },
  { id: 'instamart', slug: 'instamart', name: 'Swiggy Instamart', short: 'Instamart' },
  { id: 'bigbasket', slug: 'bigbasket', name: 'BigBasket (BB Now)', short: 'BigBasket' },
  { id: 'jiomart', slug: 'jiomart', name: 'JioMart', short: 'JioMart' },
  { id: 'dmart', slug: 'dmart', name: 'DMart Ready', short: 'DMart' },
];

export const appBySlug = (slug: string) => APPS.find((a) => a.slug === slug);

/** Every pair once, in list order: "blinkit-vs-zepto", … (15 pages). */
export const PAIRS: { slug: string; a: (typeof APPS)[number]; b: (typeof APPS)[number] }[] = APPS.flatMap((a, i) =>
  APPS.slice(i + 1).map((b) => ({ slug: `${a.slug}-vs-${b.slug}`, a, b })),
);

export const pairBySlug = (slug: string) => PAIRS.find((p) => p.slug === slug);

/**
 * Basket sizes to show fees as money rather than rules. None sits exactly on
 * a threshold (₹99, ₹199), where apps differ on whether "above" includes it.
 */
export const BASKETS = [80, 150, 250, 400, 600];

export interface AppFees {
  id: PlatformId;
  delivery: string;
  freeAbove: string;
  handling: string;
  smallCart: string;
  minOrder: string;
  /** Total fees at each of BASKETS; null where the basket is under the minimum order. */
  at: (number | null)[];
  notes: string[];
  sources: { title: string; url: string; date: string }[];
  checkedAt: string;
  rules: string[];
}

function find(rules: FeeRule[], label: string) {
  return rules.find((r) => r.label.toLowerCase() === label.toLowerCase());
}

function describe(rule: FeeRule): string {
  const about = rule.approximate ? '≈' : '';
  if (rule.kind === 'flat') return `${rule.label}: ${about}${formatRupees(rule.amount)} per order`;
  if (rule.kind === 'below') return `${rule.label}: ${about}${formatRupees(rule.amount)} below ${formatRupees(rule.threshold)}`;
  return `${rule.label}: ${rule.tiers.map((t) => `${formatRupees(t.amount)} from ${formatRupees(t.from)}`).join(', ')}`;
}

export function appFees(id: PlatformId): AppFees {
  const catalog = catalogSchedule(id);
  const s = resolveSchedule(catalog);
  const delivery = find(s.rules, 'Delivery') ?? find(s.rules, 'Home delivery');
  const handling = find(s.rules, 'Handling');
  const small = find(s.rules, 'Small cart');
  const money = (r: FeeRule | undefined) => (!r || r.kind === 'tiered' ? '—' : `${r.approximate ? '≈' : ''}${formatRupees(r.amount)}`);
  return {
    id,
    delivery: money(delivery),
    freeAbove: delivery?.kind === 'below' ? formatRupees(delivery.threshold) : delivery ? 'never' : '—',
    handling: money(handling),
    smallCart: small?.kind === 'below' ? `${money(small)} below ${formatRupees(small.threshold)}` : '—',
    minOrder: s.minOrder ? formatRupees(s.minOrder) : 'none',
    at: BASKETS.map((b) => (s.minOrder && b < s.minOrder ? null : feeTotal(s, b))),
    notes: catalog.notes,
    sources: catalog.sources.map(({ title, url, date }) => ({ title, url, date })),
    checkedAt: catalog.checkedAt,
    rules: s.rules.map(describe),
  };
}

export function membershipsFor(id: PlatformId): string[] {
  return MEMBERSHIPS.filter((m) => m.platformId === id).map((m) => m.label);
}

/** The latest date any fee was checked, for "updated" lines and sitemap dates. */
export function feesCheckedAt(): string {
  return APPS.map((a) => catalogSchedule(a.id).checkedAt).sort().at(-1)!;
}

export const brandName = (id: PlatformId) => APPS.find((a) => a.id === id)?.name ?? PLATFORMS[id].name;

export const absolute = (path: string) => `${SITE.url}${path}`;

/** Structured data, safe inside a <script> (no closing tags can sneak in). */
export function ldJson(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** The questions people search for, answered once: shown on the home page and as FAQ structured data. */
export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Which grocery app is cheapest in India?',
    a: 'It depends on your list and where you live: item prices differ by a few rupees between Blinkit, Zepto, Instamart, BigBasket, JioMart and DMart, and delivery, handling and small-cart fees often decide the total. jhola checks every app live at your location and gives the cheapest split, fees included.',
  },
  {
    q: 'Is it cheaper to split one grocery order across two apps?',
    a: 'Sometimes. A second order adds its own fees, so splitting only pays when the items you move are cheaper by more than those fees. jhola works this out exactly and also shows what one or two orders would cost.',
  },
  {
    q: 'How are delivery fees calculated on Blinkit, Zepto and Instamart?',
    a: 'Most quick-commerce apps charge a delivery fee below a free-delivery threshold, plus a small handling fee on every order, and sometimes a small-cart fee on tiny baskets. jhola reads the fees live where the app shows them, or from your own account when you log in.',
  },
  {
    q: 'Do I need to log in to use jhola?',
    a: 'No. Prices are what a logged-out shopper sees at your location. Logging in to Zepto or Instamart is optional and lets jhola use your own account’s prices, fees and membership.',
  },
  {
    q: 'Is jhola free?',
    a: 'Yes, completely free, with no ads. Your list and location stay in your browser.',
  },
  {
    q: 'Which cities does jhola work in?',
    a: 'Anywhere in India that at least one of these apps delivers to. jhola finds the stores for your exact location and says which apps don’t deliver there.',
  },
];
