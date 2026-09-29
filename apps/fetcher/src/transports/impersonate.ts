import { Impit } from 'impit';
import { TimeoutError, UpstreamError } from '../errors';
import { assertJsonBody, assertNotBlocked } from './detect';

/**
 * An HTTP client whose TLS and HTTP/2 fingerprint match desktop Chrome, for
 * platforms whose edge rejects Node's own fingerprint (Blinkit's Cloudflare).
 * It is not a browser: it runs no JavaScript, so it cannot clear a JS
 * challenge — that is the `browser` transport's job.
 *
 * One Impit instance is one user agent with one cookie jar and connection
 * pool. Adapters that need per-store cookies should create their own via
 * createImpersonator() rather than share this default.
 */
export function createImpersonator(options: ConstructorParameters<typeof Impit>[0] = {}): Impit {
  return new Impit({ browser: 'chrome', timeout: 10_000, ...options });
}

let shared: Impit | null = null;
function sharedImpit(): Impit {
  shared ??= createImpersonator();
  return shared;
}

export interface ImpersonateInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  client?: Impit;
}

export interface SimpleResponse {
  status: number;
  headers: { get(name: string): string | null };
  text: string;
}

export async function impersonateFetch(url: string, init: ImpersonateInit = {}): Promise<SimpleResponse> {
  const { client = sharedImpit(), timeoutMs = 10_000, signal, ...rest } = init;
  const host = new URL(url).host;
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const res = await client.fetch(url, { ...rest, signal: combined, timeout: timeoutMs } as never);
    const text = await res.text();
    const headers = { get: (name: string) => res.headers.get(name) };
    assertNotBlocked({ status: res.status, headers }, host);
    return { status: res.status, headers, text };
  } catch (e) {
    if (deadline.aborted) throw new TimeoutError(`${host}: no answer within ${timeoutMs} ms`);
    throw e;
  }
}

export async function impersonateJson<T>(url: string, init: ImpersonateInit = {}): Promise<T> {
  const res = await impersonateFetch(url, init);
  const host = new URL(url).host;
  if (res.status < 200 || res.status >= 300) {
    throw new UpstreamError(`${host}: HTTP ${res.status} ${res.text.slice(0, 120)}`, res.status);
  }
  assertJsonBody(res.text, host);
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new UpstreamError(`${host}: malformed JSON`);
  }
}
