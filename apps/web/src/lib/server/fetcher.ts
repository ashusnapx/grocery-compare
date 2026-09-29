import {
  FETCHER_SIGNATURE_HEADER,
  FETCHER_TIMESTAMP_HEADER,
  signRequest,
  type FetcherEvent,
  type FetcherSearchRequest,
  type FetcherSuggestRequest,
  type FetcherSuggestResponse,
} from '@gc/engine';
import { FETCHER_SECRET, FETCHER_URL } from './config';

/**
 * The fetcher in this very process: used when no worker is configured, and
 * whenever the configured one doesn't answer (a laptop asleep, a tunnel
 * restarting), so a missing worker costs only the apps it alone can reach.
 */
const inline = () => import('@gc/fetcher/inline');

/** The worker sends its headers before it starts searching, so one this slow to send them is treated as down. */
const SEARCH_CONNECT_MS = 4000;
const SUGGEST_CONNECT_MS = 2000;

let warnedAt = 0;
function noteDown(why: string) {
  if (Date.now() - warnedAt < 60_000) return;
  warnedAt = Date.now();
  console.warn(`[fetcher] ${FETCHER_URL} ${why}; searching from this server instead`);
}

/**
 * POSTs a signed body to the worker. Null when it's unreachable, too slow to
 * answer or answers with an error; a 429 (this person's limit) comes back as is,
 * so the fallback can't be used to get round it.
 */
async function callWorker(path: string, body: string, signal: AbortSignal, connectMs: number): Promise<Response | null> {
  if (!FETCHER_SECRET) {
    noteDown('is set without FETCHER_SECRET');
    return null;
  }
  const connect = new AbortController();
  const timer = setTimeout(() => connect.abort(), connectMs);
  try {
    const ts = String(Date.now());
    const sig = await signRequest(FETCHER_SECRET, ts, body);
    const res = await fetch(`${FETCHER_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [FETCHER_TIMESTAMP_HEADER]: ts, [FETCHER_SIGNATURE_HEADER]: sig },
      body,
      signal: AbortSignal.any([signal, connect.signal]),
    });
    if ((res.ok && res.body) || res.status === 429) return res;
    void res.body?.cancel();
    noteDown(`answered HTTP ${res.status}`);
    return null;
  } catch {
    if (!signal.aborted) noteDown(connect.signal.aborted ? 'was too slow to answer' : 'didn’t answer');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Searches one platform — through the worker when there is one, else here — yielding NDJSON events as they arrive. */
export async function* searchPlatform(req: FetcherSearchRequest, signal: AbortSignal): AsyncGenerator<FetcherEvent> {
  const res = FETCHER_URL ? await callWorker('/v1/search', JSON.stringify(req), signal, SEARCH_CONNECT_MS) : null;
  if (!res) {
    if (signal.aborted) {
      yield { type: 'done', status: 'timeout', elapsedMs: 0, error: 'cancelled' };
      return;
    }
    yield* (await inline()).searchInline(req, signal);
    return;
  }

  if (res.status === 429) {
    const error = 'too many comparisons — try again in a few minutes';
    yield { type: 'store', status: 'blocked', store: null, error };
    yield { type: 'done', status: 'blocked', elapsedMs: 0, error };
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line) as FetcherEvent;
        if (ev.type === 'done') sawDone = true;
        yield ev;
      }
    }
  } catch {
    if (!sawDone) yield { type: 'done', status: signal.aborted ? 'timeout' : 'error', elapsedMs: 0, error: 'stream interrupted' };
    return;
  }
  if (!sawDone) yield { type: 'done', status: 'error', elapsedMs: 0, error: 'stream ended early' };
}

/** Live product suggestions from the fastest platforms. Null when none can be had right now, or this person is busy. */
export async function suggestFromFetcher(req: FetcherSuggestRequest, signal: AbortSignal): Promise<FetcherSuggestResponse | null> {
  const res = FETCHER_URL ? await callWorker('/v1/suggest', JSON.stringify(req), signal, SUGGEST_CONNECT_MS) : null;
  if (!res) return signal.aborted ? null : (await inline()).suggestInline(req, signal);
  if (!res.ok) return null;
  try {
    return (await res.json()) as FetcherSuggestResponse;
  } catch {
    return null;
  }
}
