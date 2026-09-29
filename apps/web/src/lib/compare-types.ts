import type { Fill, GeoLocation, ListRow, PlanResult, PlanSettings, PlatformId, PlatformStatus, StoreInfo, FeeHints, MembershipId } from '@gc/engine';

/** Body of POST /api/compare. */
export interface CompareRequest {
  rows: ListRow[];
  location: GeoLocation;
  settings: PlanSettings;
}

export interface RowResult {
  status: PlatformStatus;
  /** Candidate fills respecting the row's brand lock and pins. */
  fills: Fill[];
  /** For brand-locked rows: fills if any brand were allowed (feeds nudges). */
  unlockedFills: Fill[];
  /** Listings that might be right but need the user's nod. */
  possible: PossibleMatch[];
  /** How many listings came back at all, before matching. */
  seen: number;
}

export interface PossibleMatch {
  listingId: string;
  title: string;
  quantityText: string;
  price: number;
  imageUrl: string | null;
  productUrl: string;
  reason: string | null;
}

export interface PlatformResult {
  platformId: PlatformId;
  status: PlatformStatus;
  store: StoreInfo | null;
  feeHints?: FeeHints;
  error?: string;
  perRow: Record<string, RowResult>;
  elapsedMs: number;
  /** Prices from the shopper's own signed-in account ('used'), or a login that couldn't be used this time. */
  account?: 'used' | 'unavailable';
  /** Shopper-safe note on the account used, e.g. "your saved address". */
  accountNote?: string;
  accountProblem?: 'signed_out' | 'rate_limited' | 'unsupported' | 'no_address' | 'failed';
  /** What the shopper's own account said about fees: memberships, and where the fees were read. */
  accountFees?: { memberships: MembershipId[]; source: string | null };
}

/** Server-sent events from /api/compare, in order: meta, progress*, platform*, plan*, done. */
export type CompareEvent =
  | { type: 'meta'; platforms: PlatformId[]; rows: { id: string; brand: string | null; brandLocked: boolean; searchText: string }[] }
  | { type: 'progress'; platformId: PlatformId; done: number; total: number }
  | { type: 'platform'; result: PlatformResult }
  | { type: 'plan'; result: PlanResult; final: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Body of POST /api/plan — a stateless re-solve from data the client already has. */
export interface PlanRequest {
  rows: { id: string; label: string; brandLocked: boolean }[];
  platforms: { platformId: PlatformId; eta: string | null; feeHints?: FeeHints }[];
  fills: Fill[];
  unlockedFills: Fill[];
  settings: PlanSettings;
  city?: string;
}
