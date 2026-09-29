/**
 * Core domain types. The engine is pure: nothing in here performs I/O, so the
 * same code runs in the Next.js server, the fetch worker, tests, and (Phase 2)
 * on a phone.
 */

export type PlatformId = 'blinkit' | 'zepto' | 'instamart' | 'jiomart' | 'dmart' | 'bigbasket';

/** Base dimensions. Quantities are always stored in base units: g, ml, pcs, packs. */
export type Dim = 'mass' | 'volume' | 'count' | 'pack';

/** Units offered in the list builder's dropdown. */
export type Unit = 'g' | 'kg' | 'ml' | 'L' | 'pcs' | 'dozen' | 'pack';

export interface Quantity {
  /** In base units: grams, millilitres, pieces or packs. */
  value: number;
  dim: Dim;
}

export interface GeoLocation {
  lat: number;
  lng: number;
  pincode: string;
  /** True when only a pincode was given, so coordinates are the pincode's centroid. */
  approximate: boolean;
  label?: string;
}

/** A row exactly as the user entered it in the list builder. */
export interface ListRow {
  id: string;
  /** "Aashirvaad atta", "full cream milk", "pyaz" */
  text: string;
  amount: number;
  unit: Unit;
  /** The per-row toggle. A row whose text names a brand is locked unless this is true. */
  anyBrand: boolean;
  /** listingId the user pinned per platform, e.g. after accepting a possible match. */
  pins?: Partial<Record<PlatformId, string>>;
  /** Photo of the exact product picked from live suggestions (display only). */
  imageUrl?: string;
}

/** What the engine understood from a row. */
export interface ParsedRow {
  id: string;
  text: string;
  quantity: Quantity;
  /** Display form of a detected brand, e.g. "Aashirvaad". */
  brand: string | null;
  /** True when a brand was named and the row is not switched to "any brand". */
  brandLocked: boolean;
  /** Canonical product type, e.g. "atta", "onion", "milk". */
  head: string;
  /** Every alias of the head that counts as the same product type. */
  headForms: string[];
  /** Dictionary item id when the row was recognised. */
  itemKey: string | null;
  /** Normalised words that must appear in a matching listing ("full", "cream"). */
  required: string[];
  /** What is sent to each platform's search. */
  searchText: string;
  /** One retry, used only when the first search finds no confident match. */
  fallbackSearchText: string | null;
}

/** One product as one platform sells it, normalised by the adapter. */
export interface Listing {
  platformId: PlatformId;
  /** The platform's own product / variant id. */
  listingId: string;
  title: string;
  brand: string | null;
  /** Net quantity exactly as the platform states it: "2 x 500 g", "1 kg (4-6 pcs)". */
  quantityText: string;
  /** Payable price in INR, GST-inclusive, as shown to a logged-out visitor. */
  price: number;
  mrp: number | null;
  inStock: boolean;
  productUrl: string;
  imageUrl: string | null;
  category: string | null;
  fetchedAt: string;
}

export type PlatformStatus = 'ok' | 'no_results' | 'blocked' | 'timeout' | 'unserviceable' | 'error';

export interface StoreInfo {
  storeId: string;
  /** Human label, e.g. "Koramangala" or "DMart store 10744". */
  label: string | null;
  /** Delivery promise as the platform phrases it: "10 min", "30 mins", "Today, 6-9 pm". */
  eta: string | null;
}

/** Fee facts a platform stated in this very response. They override the catalog field by field. */
export interface FeeHints {
  minOrder?: number | null;
  freeDeliveryAbove?: number | null;
  deliveryFee?: number | null;
  handlingFee?: number | null;
  smallCartFee?: number | null;
  smallCartBelow?: number | null;
  /** A surge / rain / high-demand fee the platform says is in force right now. */
  surgeFee?: number | null;
  /** Flat per-order fees some accounts pay (Instamart's packaging fee, platform fees). */
  packagingFee?: number | null;
  platformFee?: number | null;
}

/** A listing matched to a row. */
export interface Match {
  listing: Listing;
  /** Parsed pack size, in the row's dimension. Null when the size could not be read. */
  packQuantity: number | null;
  confidence: 'confident' | 'possible';
  /** For possible matches: why it was not confident. */
  reason: string | null;
}

/** One way to cover a row on one platform: a set of packs of one product line. */
export interface Fill {
  itemId: string;
  platformId: PlatformId;
  packs: { listingId: string; count: number; size: number; price: number; title: string }[];
  /** Total quantity bought, in the row's base unit. */
  quantity: number;
  cost: number;
  /** True when the only way to cover the row exceeds the +25% over-buy cap. */
  overBuy: boolean;
  /**
   * The next size up from the line's cheapest fill, still within +25%: a plan
   * takes it only when the bigger pack costs less than the fee it avoids.
   */
  stepUp?: boolean;
  /** Product line, e.g. "Aashirvaad Shudh Chakki Atta". */
  label: string;
  /** Pack summary, e.g. "5 kg" or "2 × 500 g". */
  packLabel: string;
  brand: string | null;
  imageUrl: string | null;
  productUrl: string;
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

export type FeeRule =
  /** Charged on every order. */
  | { kind: 'flat'; label: string; amount: number; approximate?: boolean }
  /** Charged when the item subtotal is below `threshold`. */
  | { kind: 'below'; label: string; amount: number; threshold: number; approximate?: boolean }
  /** Amount of the highest tier whose `from` is at or below the subtotal. */
  | { kind: 'tiered'; label: string; tiers: { from: number; amount: number }[]; approximate?: boolean };

export interface FeeSource {
  title: string;
  url: string;
  date: string;
  confidence: 'confirmed' | 'uncertain';
}

export interface FeeVariant {
  id: 'peak' | 'late_night';
  label: string;
  /** IST wall-clock window, 'HH:MM'. Omitted for variants that cannot be predicted (peak). */
  window?: { from: string; to: string };
  rules: FeeRule[];
  minOrder?: number | null;
}

export interface FeeSchedule {
  platformId: PlatformId;
  cities: string[] | 'default';
  /** Cannot check out below this subtotal. */
  minOrder: number | null;
  rules: FeeRule[];
  variants: FeeVariant[];
  /** Caveats shown next to the fees, e.g. "handling fee varies by account". */
  notes: string[];
  sources: FeeSource[];
  checkedAt: string;
}

export type MembershipId = 'zepto_club' | 'swiggy_one';

export interface MembershipEffect {
  membershipId: MembershipId;
  platformId: PlatformId;
  label: string;
  /** Changes applied to rules by label: a new threshold, or removal. */
  changes: { rule: string; threshold?: number; remove?: true }[];
  confirmed: boolean;
}

/** "My Blinkit fees are different" — the user's own numbers, which beat everything. */
export interface FeeOverride {
  platformId: PlatformId;
  deliveryFee?: number;
  freeDeliveryAbove?: number;
  handlingFee?: number;
  smallCartFee?: number;
  smallCartBelow?: number;
  minOrder?: number | null;
}

/** A schedule after catalog, membership, live hints and overrides are applied. */
export interface ResolvedSchedule {
  platformId: PlatformId;
  minOrder: number | null;
  rules: FeeRule[];
  variants: FeeVariant[];
  notes: string[];
  checkedAt: string;
  /** Where the numbers came from, most authoritative first. */
  provenance: ('override' | 'live' | 'catalog')[];
}

export interface FeeLine {
  label: string;
  amount: number;
  approximate: boolean;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export interface PlanSettings {
  memberships: MembershipId[];
  excluded: PlatformId[];
  overrides: FeeOverride[];
}

export interface OrderLine {
  itemId: string;
  fill: Fill;
  /** One sentence when the line is not on its cheapest platform. */
  why: string | null;
}

export interface Order {
  platformId: PlatformId;
  lines: OrderLine[];
  subtotal: number;
  fees: FeeLine[];
  feesTotal: number;
  total: number;
  eta: string | null;
}

export interface Plan {
  orders: Order[];
  itemsTotal: number;
  feesTotal: number;
  total: number;
}

export interface SingleAppPlan {
  platformId: PlatformId;
  plan: Plan | null;
  /** Row ids this platform could not supply. */
  missing: string[];
  belowMinOrder: boolean;
}

export interface BrandSwapNudge {
  itemId: string;
  fromLabel: string;
  fill: Fill;
  saving: number;
}

export interface PeakWarning {
  platformId: PlatformId;
  label: string;
  extraCost: number;
  alternative: Plan | null;
}

export interface PlanResult {
  best: Plan | null;
  /** Best plan with at most k orders, k descending from (orders in best − 1). */
  fewerOrders: Plan[];
  singleApp: SingleAppPlan[];
  nudges: BrandSwapNudge[];
  peak: PeakWarning[];
  /** Row ids with no fill on any reachable platform. */
  unavailable: string[];
  /** Cheapest single-app plan that carries every row. */
  baseline: { platformId: PlatformId; total: number } | null;
  solver: { status: 'optimal' | 'fallback' | 'empty'; ms: number; truncated: boolean; message?: string };
}
