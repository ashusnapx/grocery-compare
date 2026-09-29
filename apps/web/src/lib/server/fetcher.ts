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

/** Calls the fetch worker for one platform and yields its NDJSON events as they arrive. */
export async function* searchPlatform(req: FetcherSearchRequest, signal: AbortSignal): AsyncGenerator<FetcherEvent> {
  const body = JSON.stringify(req);
  const ts = String(Date.now());
  const sig = await signRequest(FETCHER_SECRET, ts, body);

  let res: Response;
  try {
    res = await fetch(`${FETCHER_URL}/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [FETCHER_TIMESTAMP_HEADER]: ts, [FETCHER_SIGNATURE_HEADER]: sig },
      body,
      signal,
    });
  } catch {
    yield { type: 'done', status: 'error', elapsedMs: 0, error: 'price service unreachable' };
    return;
  }

  if (res.status === 429) {
    yield { type: 'done', status: 'blocked', elapsedMs: 0, error: 'too many comparisons — try again in a few minutes' };
    return;
  }
  if (!res.ok || !res.body) {
    yield { type: 'done', status: 'error', elapsedMs: 0, error: `price service HTTP ${res.status}` };
    return;
  }

  const reader = res.body.getReader();
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

/** Live product suggestions from the fastest platforms. Null when the fetcher is unavailable or busy. */
export async function suggestFromFetcher(req: FetcherSuggestRequest, signal: AbortSignal): Promise<FetcherSuggestResponse | null> {
  const body = JSON.stringify(req);
  const ts = String(Date.now());
  const sig = await signRequest(FETCHER_SECRET, ts, body);
  try {
    const res = await fetch(`${FETCHER_URL}/v1/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [FETCHER_TIMESTAMP_HEADER]: ts, [FETCHER_SIGNATURE_HEADER]: sig },
      body,
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as FetcherSuggestResponse;
  } catch {
    return null;
  }
}
