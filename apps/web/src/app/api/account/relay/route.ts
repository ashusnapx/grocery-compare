import { ACCOUNT_PROVIDERS, isAccountPlatform, targetUrl, type ProviderTarget } from '@/lib/account/providers';

export const runtime = 'nodejs';

const TARGETS: ProviderTarget[] = ['register', 'token'];
const FORWARD_REQUEST = ['content-type', 'accept', 'authorization', 'mcp-session-id', 'mcp-protocol-version'];
const FORWARD_RESPONSE = ['content-type', 'mcp-session-id', 'www-authenticate'];
const MAX_BODY = 64 * 1024;

/**
 * Pass-through for official sign-in endpoints that don't accept browser calls
 * (Swiggy's registration and token exchange). Only the fixed endpoints in ACCOUNT_PROVIDERS are
 * reachable; nothing is logged or kept — the shopper's token only passes by.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') ?? '';
  const target = url.searchParams.get('target') as ProviderTarget;
  if (!isAccountPlatform(provider) || !TARGETS.includes(target) || ACCOUNT_PROVIDERS[provider].direct) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  const body = await request.text();
  if (body.length > MAX_BODY) return Response.json({ error: 'too large' }, { status: 413 });

  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl(ACCOUNT_PROVIDERS[provider], target), {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    });
  } catch {
    return Response.json({ error: `${ACCOUNT_PROVIDERS[provider].name} didn’t answer` }, { status: 502 });
  }
  const out = new Headers({ 'cache-control': 'no-store' });
  for (const h of FORWARD_RESPONSE) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
