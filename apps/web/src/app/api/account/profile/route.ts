import { z } from 'zod';
import { profileName } from '@/lib/server/accounts';

export const runtime = 'nodejs';

const Body = z.object({ platformId: z.enum(['zepto', 'instamart']), token: z.string().min(8).max(4096) });

/** The shopper's first name from their own signed-in app, for the greeting. Nothing is kept here. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ name: null }, { status: 400 });
  const { platformId, token } = parsed.data;
  try {
    const name = await profileName(platformId, token, AbortSignal.any([request.signal, AbortSignal.timeout(8000)]));
    return Response.json({ name }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ name: null }, { headers: { 'cache-control': 'no-store' } });
  }
}
