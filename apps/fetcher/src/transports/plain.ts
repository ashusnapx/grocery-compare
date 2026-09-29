import { TimeoutError, UpstreamError } from '../errors';
import { assertJsonBody, assertNotBlocked } from './detect';

/** Mirrors a current desktop Chrome, as med-compare's http.ts did. */
export const BROWSER_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-IN,en;q=0.9',
};

export interface PlainInit extends RequestInit {
  timeoutMs?: number;
}

/**
 * Node's fetch with browser headers, a deadline tied to the caller's signal,
 * and block detection. Use for platforms that answer plain HTTP (JioMart,
 * DMart).
 */
export async function plainFetch(url: string, init: PlainInit = {}): Promise<Response> {
  const { timeoutMs = 8000, signal, headers, ...rest } = init;
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const host = new URL(url).host;

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { ...BROWSER_HEADERS, ...(headers as Record<string, string> | undefined) },
      signal: combined,
      redirect: rest.redirect ?? 'follow',
    });
  } catch (e) {
    if (deadline.aborted) throw new TimeoutError(`${host}: no answer within ${timeoutMs} ms`);
    throw e;
  }
  assertNotBlocked(res, host);
  return res;
}

/** plainFetch + JSON parsing with an honest error when the body is not JSON. */
export async function plainJson<T>(url: string, init: PlainInit = {}): Promise<T> {
  const res = await plainFetch(url, init);
  const host = new URL(url).host;
  const body = await res.text();
  if (!res.ok) throw new UpstreamError(`${host}: HTTP ${res.status} ${body.slice(0, 120)}`, res.status);
  assertJsonBody(body, host);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new UpstreamError(`${host}: malformed JSON`);
  }
}
