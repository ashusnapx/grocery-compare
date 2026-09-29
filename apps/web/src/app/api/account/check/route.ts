import { z } from 'zod';
import { AccountError, checkAccount } from '@/lib/server/accounts';

export const runtime = 'nodejs';

const Body = z.object({
  platformId: z.enum(['zepto', 'instamart']),
  token: z.string().min(8).max(4096),
  query: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^\d{6}$/),
});

/** The /connect check page: one account search, shown raw and as read. Nothing is kept. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });
  const { platformId, token, query, pincode } = parsed.data;
  try {
    return Response.json(await checkAccount(platformId, token, query, pincode, AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e) {
    return Response.json({ error: e instanceof AccountError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
