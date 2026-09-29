/**
 * HMAC-SHA256 request signing between apps/web and apps/fetcher, using Web
 * Crypto so the same code runs in Node and in edge runtimes.
 */

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signRequest(secret: string, timestamp: string, body: string): Promise<string> {
  return hmacHex(secret, `${timestamp}.${body}`);
}

export async function verifyRequest(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
  maxSkewMs: number,
  now = Date.now(),
): Promise<boolean> {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxSkewMs) return false;
  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  if (expected.length !== signature.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** Shared in development so `npm run dev` works with no setup; production must set FETCHER_SECRET. */
export const DEV_FETCHER_SECRET = 'grocery-compare-dev-secret';
