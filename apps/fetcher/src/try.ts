/**
 * Developer tool: run one platform search end to end, without HTTP.
 *
 *   npx tsx src/try.ts <platform> "<query>[|<query>...]" [pincode] [lat] [lng]
 *   npx tsx src/try.ts jiomart "toor dal|amul butter" 560034
 *
 * Defaults to Koramangala, Bengaluru (560034, 12.9352, 77.6245).
 */
import { isPlatformId, type FetcherSearchRequest } from '@gc/engine';
import { runPlatformSearch } from './search';
import { closeBrowser } from './transports/browser';

const [platform, queryArg, pincode = '560034', lat = '12.9352', lng = '77.6245'] = process.argv.slice(2);
if (!platform || !isPlatformId(platform) || !queryArg) {
  console.error('usage: tsx src/try.ts <platform> "<query>[|<query>...]" [pincode] [lat] [lng]');
  process.exit(2);
}

const req: FetcherSearchRequest = {
  platformId: platform,
  location: { lat: Number(lat), lng: Number(lng), pincode, approximate: false },
  queries: queryArg.split('|').map((text, i) => ({ itemId: `q${i}`, text: text.trim() })),
  clientIp: null,
};

const verbose = process.env.VERBOSE === '1';
for await (const ev of runPlatformSearch(req, new AbortController().signal)) {
  if (ev.type === 'store') {
    console.log(`store: ${ev.status}`, ev.store ?? '', ev.feeHints ?? '', ev.error ?? '');
  } else if (ev.type === 'query') {
    console.log(`\nquery "${ev.text}": ${ev.status} (${ev.listings.length} listings${ev.cached ? ', cached' : ''})${ev.error ? ` — ${ev.error}` : ''}`);
    for (const l of ev.listings.slice(0, verbose ? 50 : 8)) {
      console.log(
        `  ${l.inStock ? ' ' : '✗'} ₹${l.price}${l.mrp && l.mrp !== l.price ? ` (MRP ₹${l.mrp})` : ''}  ${l.title}  [${l.quantityText}]  brand=${l.brand ?? '-'}`,
      );
    }
  } else {
    console.log(`\ndone: ${ev.status} in ${ev.elapsedMs} ms${ev.error ? ` — ${ev.error}` : ''}`);
  }
}
await closeBrowser();
