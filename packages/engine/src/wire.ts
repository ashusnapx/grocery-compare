/**
 * Wire format between apps/web and apps/fetcher. The fetcher streams NDJSON:
 * one `store` event, one `query` event per query, then one `done` event.
 */
import type { FeeHints, GeoLocation, Listing, PlatformId, PlatformStatus, StoreInfo } from './types';

export interface FetcherSearchRequest {
  platformId: PlatformId;
  location: GeoLocation;
  queries: { itemId: string; text: string }[];
  /** The end user's IP, forwarded so the fetcher can rate-limit per person. */
  clientIp: string | null;
}

export type FetcherEvent =
  | { type: 'store'; status: PlatformStatus; store: StoreInfo | null; feeHints?: FeeHints; error?: string }
  | { type: 'query'; itemId: string; text: string; status: PlatformStatus; listings: Listing[]; error?: string; cached: boolean }
  | { type: 'done'; status: PlatformStatus; elapsedMs: number; error?: string };

export const FETCHER_SIGNATURE_HEADER = 'x-gc-signature';
export const FETCHER_TIMESTAMP_HEADER = 'x-gc-timestamp';
/** Signed requests older than this are rejected. */
export const FETCHER_MAX_SKEW_MS = 60_000;

/** POST /v1/suggest — live product suggestions while the user types. */
export interface FetcherSuggestRequest {
  query: string;
  location: GeoLocation;
  clientIp: string | null;
}

export interface FetcherSuggestResponse {
  platforms: { platformId: PlatformId; status: PlatformStatus }[];
  listings: Listing[];
}
