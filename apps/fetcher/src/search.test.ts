import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetcherEvent, GeoLocation } from '@gc/engine';
import { BlockedError } from './errors';

const search = vi.fn();
const resolveStore = vi.fn();
vi.mock('./adapters/registry', () => ({
  ADAPTERS: new Proxy({}, { get: () => ({ resolveStore, search }) }),
}));

const { restingFor, runPlatformSearch } = await import('./search');

const location: GeoLocation = { lat: 19.1364, lng: 72.8296, pincode: '400053', approximate: false };
const req = (text: string) => ({ platformId: 'dmart' as const, location, queries: [{ itemId: 'a', text }], clientIp: null });

async function run(text: string): Promise<FetcherEvent[]> {
  const out: FetcherEvent[] = [];
  for await (const ev of runPlatformSearch(req(text), new AbortController().signal)) out.push(ev);
  return out;
}

describe('resting after a refusal', () => {
  beforeEach(() => {
    search.mockReset();
    resolveStore.mockReset();
    resolveStore.mockResolvedValue({ storeId: '10151', label: null, eta: null, context: { storeId: '10151' } });
  });

  it('stops asking a platform that just refused us, instead of retrying into the ban', async () => {
    search.mockRejectedValueOnce(new BlockedError('digital.dmart.in: HTTP 403'));
    const first = await run('milk');
    expect(first.at(-1)).toMatchObject({ type: 'done', status: 'blocked' });
    expect(restingFor('dmart')).toBeGreaterThan(60_000);

    const calls = search.mock.calls.length;
    const second = await run('bread');
    expect(second.at(-1)).toMatchObject({ type: 'done', status: 'blocked' });
    expect(String((second.at(-1) as { error?: string }).error)).toMatch(/trying again in ~\d+ min/);
    // Not a single request went out while resting.
    expect(search.mock.calls.length).toBe(calls);
  });
});
