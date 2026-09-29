import { completeRow, groupProducts, parseRow } from '@gc/engine';
import { z } from 'zod';
import { suggestFromFetcher } from '@/lib/server/fetcher';

export const runtime = 'nodejs';

const Params = z.object({
  q: z.string().trim().min(3).max(80),
  lat: z.coerce.number().min(6).max(38),
  lng: z.coerce.number().min(68).max(98),
  pincode: z.string().regex(/^\d{6}$/),
});

/**
 * Real products while the user types: the fetcher asks the fastest apps,
 * and the same brand + product + size across apps comes back as one card
 * with every app's price. The apps are searched with what they call the
 * item ("vengayam" → onion), and a typed size ("atta 5kg") ranks first.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = Params.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ products: [], platforms: [] });
  const { q, lat, lng, pincode } = parsed.data;
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null;

  const typed = completeRow(q);
  const row = parseRow({ id: 'typed', text: typed.text, amount: typed.amount, unit: typed.unit, anyBrand: false });
  const query = row.searchText.length >= 2 ? row.searchText : q;
  const sized = typed.text !== q;

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  const result = await suggestFromFetcher({ query, location: { lat, lng, pincode, approximate: false }, clientIp }, signal);
  if (!result) return Response.json({ products: [], platforms: [] });

  return Response.json(
    { products: groupProducts(result.listings, 8, { row, sized }), platforms: result.platforms },
    { headers: { 'cache-control': 'private, max-age=60' } },
  );
}
