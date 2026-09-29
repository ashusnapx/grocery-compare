import { DEV_FETCHER_SECRET, isPlatformId, type PlatformId } from '@gc/engine';

/** Where the fetch worker lives. Local dev runs it on 4100 via `npm run dev`. */
export const FETCHER_URL = process.env.FETCHER_URL ?? 'http://localhost:4100';

export const FETCHER_SECRET =
  process.env.FETCHER_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : DEV_FETCHER_SECRET);

/**
 * Platforms fanned out to. BigBasket (BB Now) passed its location spike (S3,
 * docs/research/2026-09-27-spike-s3-bigbasket.md), so all six are on.
 */
export const ENABLED_PLATFORMS: PlatformId[] = (process.env.GC_PLATFORMS ?? 'blinkit,zepto,instamart,jiomart,dmart,bigbasket')
  .split(',')
  .map((s) => s.trim())
  .filter(isPlatformId);
