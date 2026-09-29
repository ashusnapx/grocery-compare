import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  DEV_FETCHER_SECRET,
  FETCHER_MAX_SKEW_MS,
  FETCHER_SIGNATURE_HEADER,
  FETCHER_TIMESTAMP_HEADER,
  PLATFORM_IDS,
  verifyRequest,
  type FetcherSearchRequest,
} from '@gc/engine';
import { allow } from './ratelimit';
import { runPlatformSearch } from './search';
import { suggestProducts } from './suggest';
import { closeBrowser } from './transports/browser';

const PORT = Number(process.env.FETCHER_PORT ?? 4100);
const MAX_BODY_BYTES = 256 * 1024;
const MAX_QUERIES = 60;

const SECRET = process.env.FETCHER_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : DEV_FETCHER_SECRET);
if (!SECRET) {
  console.error('FETCHER_SECRET must be set in production.');
  process.exit(1);
}

const SearchRequest = z.object({
  platformId: z.enum(PLATFORM_IDS as [string, ...string[]]),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    pincode: z.string().regex(/^\d{6}$/),
    approximate: z.boolean(),
    label: z.string().max(120).optional(),
  }),
  queries: z
    .array(z.object({ itemId: z.string().min(1).max(64), text: z.string().trim().min(1).max(120) }))
    .min(1)
    .max(MAX_QUERIES),
  clientIp: z.string().max(64).nullable(),
});

const SuggestRequest = z.object({
  query: z.string().trim().min(2).max(80),
  location: SearchRequest.shape.location,
  clientIp: z.string().max(64).nullable(),
});

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleSearch(req: IncomingMessage, res: ServerResponse) {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    return json(res, 413, { error: 'body too large' });
  }

  const ok = await verifyRequest(
    SECRET,
    req.headers[FETCHER_TIMESTAMP_HEADER] as string | undefined ?? null,
    req.headers[FETCHER_SIGNATURE_HEADER] as string | undefined ?? null,
    raw,
    FETCHER_MAX_SKEW_MS,
  );
  if (!ok) return json(res, 401, { error: 'bad signature' });

  let parsed: FetcherSearchRequest;
  try {
    parsed = SearchRequest.parse(JSON.parse(raw)) as FetcherSearchRequest;
  } catch (e) {
    return json(res, 400, { error: 'invalid request', detail: e instanceof Error ? e.message.slice(0, 300) : undefined });
  }

  if (!allow(parsed.clientIp)) return json(res, 429, { error: 'too many comparisons, try again in a few minutes' });

  const ac = new AbortController();
  res.on('close', () => ac.abort());
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
  try {
    for await (const ev of runPlatformSearch(parsed, ac.signal)) {
      if (res.writableEnded || ac.signal.aborted) break;
      res.write(`${JSON.stringify(ev)}\n`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.write(`${JSON.stringify({ type: 'done', status: 'error', elapsedMs: 0, error: message.slice(0, 200) })}\n`);
  }
  res.end();
}

async function readSigned(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    json(res, 413, { error: 'body too large' });
    return null;
  }
  const ok = await verifyRequest(
    SECRET,
    (req.headers[FETCHER_TIMESTAMP_HEADER] as string | undefined) ?? null,
    (req.headers[FETCHER_SIGNATURE_HEADER] as string | undefined) ?? null,
    raw,
    FETCHER_MAX_SKEW_MS,
  );
  if (!ok) {
    json(res, 401, { error: 'bad signature' });
    return null;
  }
  return raw;
}

async function handleSuggest(req: IncomingMessage, res: ServerResponse) {
  const raw = await readSigned(req, res);
  if (raw === null) return;
  let parsed: z.infer<typeof SuggestRequest>;
  try {
    parsed = SuggestRequest.parse(JSON.parse(raw));
  } catch {
    return json(res, 400, { error: 'invalid request' });
  }
  if (!allow(parsed.clientIp, 'suggest')) return json(res, 429, { error: 'slow down a little' });
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const result = await suggestProducts(parsed.query, parsed.location as never, ac.signal);
  if (!res.writableEnded) json(res, 200, result);
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/suggest') {
    void handleSuggest(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { ok: true });
  if (req.method === 'POST' && req.url === '/v1/search') {
    void handleSearch(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
    return;
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`fetcher listening on http://localhost:${PORT}`);
});

const shutdown = async () => {
  server.close();
  await closeBrowser();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
