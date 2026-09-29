/**
 * Coverage: which apps deliver where, across India. For each place, every
 * platform's store lookup runs (uncached) and, where a store answers, one
 * search, so an adapter that only works in the city it was built in shows up.
 *
 *   npm run coverage -w @gc/fetcher
 *   npm run coverage -w @gc/fetcher -- jiomart,bigbasket     (some platforms only)
 *
 * Each platform sees one request at a time; places run one after another.
 */
import { isPlatformId, PLATFORM_IDS, type GeoLocation, type PlatformId } from '@gc/engine';
import { ADAPTERS } from './adapters/registry';
import { statusOf } from './search';
import { closeBrowser } from './transports/browser';

/** Residential spots from metros to a tier-3 town, north to south, west to north-east. */
const PLACES: (GeoLocation & { name: string })[] = [
  { name: 'Delhi · Malviya Nagar', pincode: '110017', lat: 28.5355, lng: 77.209, approximate: false },
  { name: 'Gurugram · DLF Ph 3', pincode: '122002', lat: 28.4924, lng: 77.0935, approximate: false },
  { name: 'Chandigarh · Sec 22', pincode: '160022', lat: 30.7333, lng: 76.7794, approximate: false },
  { name: 'Jaipur · Malviya Ngr', pincode: '302017', lat: 26.853, lng: 75.805, approximate: false },
  { name: 'Lucknow · Gomti Ngr', pincode: '226010', lat: 26.856, lng: 80.991, approximate: false },
  { name: 'Patna · Kankarbagh', pincode: '800020', lat: 25.5941, lng: 85.1612, approximate: false },
  { name: 'Bhagalpur', pincode: '812001', lat: 25.2425, lng: 86.9842, approximate: false },
  { name: 'Kolkata · Salt Lake', pincode: '700064', lat: 22.5867, lng: 88.4171, approximate: false },
  { name: 'Guwahati · Beltola', pincode: '781028', lat: 26.121, lng: 91.8, approximate: false },
  { name: 'Ahmedabad · Satellite', pincode: '380015', lat: 23.0258, lng: 72.525, approximate: false },
  { name: 'Mumbai · Andheri W', pincode: '400053', lat: 19.1364, lng: 72.8296, approximate: false },
  { name: 'Pune · Kothrud', pincode: '411038', lat: 18.5074, lng: 73.8077, approximate: false },
  { name: 'Hyderabad · Madhapur', pincode: '500081', lat: 17.4483, lng: 78.3915, approximate: false },
  { name: 'Bengaluru · Koramangala', pincode: '560034', lat: 12.9352, lng: 77.6245, approximate: false },
  { name: 'Chennai · Adyar', pincode: '600020', lat: 13.0012, lng: 80.2565, approximate: false },
  { name: 'Kochi · Kadavanthra', pincode: '682020', lat: 9.9658, lng: 76.2999, approximate: false },
];
const QUERY = process.env.COVERAGE_QUERY ?? 'milk';
const DEADLINE_MS = 30_000;

const only = process.argv[2]?.split(',').filter(isPlatformId);
const platforms: PlatformId[] = only?.length ? only : [...PLATFORM_IDS];

type Cell = { mark: string; note?: string };

async function check(platformId: PlatformId, place: GeoLocation): Promise<Cell> {
  const logs: string[] = [];
  const ctx = { signal: AbortSignal.timeout(DEADLINE_MS), log: (m: string) => logs.push(m) };
  const note = () => logs.at(-1);
  try {
    const store = await ADAPTERS[platformId].resolveStore(place, ctx);
    if (!store) return { mark: '·', note: note() };
    const listings = await ADAPTERS[platformId].search(QUERY, store, ctx);
    const priced = listings.filter((l) => l.inStock && l.price > 0).length;
    return priced ? { mark: `✔${priced}` } : { mark: '0', note: `store ${store.storeId}, nothing in stock for "${QUERY}"` };
  } catch (e) {
    return { mark: `✘${statusOf(e).slice(0, 5)}`, note: e instanceof Error ? e.message.slice(0, 160) : String(e) };
  }
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length));
console.log(`${pad('place', 26)}${platforms.map((p) => pad(p, 11)).join('')}`);
const notes: string[] = [];
for (const place of PLACES) {
  const cells = await Promise.all(platforms.map((p) => check(p, place)));
  console.log(`${pad(place.name, 26)}${cells.map((c) => pad(c.mark, 11)).join('')}`);
  cells.forEach((c, i) => c.note && c.mark !== '·' && notes.push(`${place.name} · ${platforms[i]}: ${c.note}`));
  cells.forEach((c, i) => c.mark === '·' && c.note && notes.push(`${place.name} · ${platforms[i]} (not served): ${c.note}`));
}
console.log(`\n✔n = n priced in-stock results for "${QUERY}" · · = does not deliver there · ✘ = failed`);
if (notes.length) console.log(`\n${notes.join('\n')}`);
await closeBrowser();
process.exit(0);
