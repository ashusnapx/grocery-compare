/**
 * Canary: one known search per platform at a fixed location, so a broken
 * adapter shows up before users notice. Run on demand or from cron:
 *
 *   npm run canary -w @gc/fetcher
 *
 * Exits 1 if any platform fails to return priced results.
 */
import { PLATFORM_IDS, type FetcherSearchRequest, type PlatformStatus } from '@gc/engine';
import { runPlatformSearch } from './search';
import { closeBrowser } from './transports/browser';

const QUERY = process.env.CANARY_QUERY ?? 'toor dal';
const location = { lat: 12.9352, lng: 77.6245, pincode: '560034', approximate: false };

let failures = 0;
for (const platformId of PLATFORM_IDS) {
  const req: FetcherSearchRequest = { platformId, location, queries: [{ itemId: 'canary', text: QUERY }], clientIp: null };
  const started = Date.now();
  let status: PlatformStatus = 'error';
  let listings = 0;
  let priced = 0;
  let error: string | undefined;
  for await (const ev of runPlatformSearch(req, new AbortController().signal)) {
    if (ev.type === 'query') {
      listings = ev.listings.length;
      priced = ev.listings.filter((l) => l.price > 0).length;
      error ??= ev.error;
    }
    if (ev.type === 'store') error ??= ev.error;
    if (ev.type === 'done') {
      status = ev.status;
      error ??= ev.error;
    }
  }
  const ok = status === 'ok' && priced > 0;
  if (!ok) failures++;
  console.log(
    `${ok ? '✔' : '✘'} ${platformId.padEnd(10)} ${status.padEnd(13)} ${String(priced).padStart(3)}/${String(listings).padEnd(3)} priced  ${Date.now() - started} ms${error ? `  — ${error}` : ''}`,
  );
}
await closeBrowser();
process.exit(failures ? 1 : 0);
