import { z } from 'zod';
import { LocationSchema } from '@/lib/server/schemas';
import { AccountError, addToAccountCart } from '@/lib/server/accounts';

export const runtime = 'nodejs';

const Body = z.object({
  platformId: z.enum(['zepto', 'instamart']),
  token: z.string().min(8).max(4096),
  location: LocationSchema,
  items: z.array(z.object({ listingId: z.string().min(1).max(160), quantity: z.number().int().min(1).max(20) })).min(1).max(40),
});

/** One tap: the plan's items into the shopper's own cart in the app. The token is used for this call only. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });
  const { platformId, token, location, items } = parsed.data;
  try {
    const done = await addToAccountCart(platformId, token, location, items, AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]));
    return Response.json(done, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const kind = e instanceof AccountError ? e.kind : 'failed';
    return Response.json({ error: e instanceof Error ? e.message : String(e), kind }, { status: kind === 'signed_out' ? 401 : 502 });
  }
}
