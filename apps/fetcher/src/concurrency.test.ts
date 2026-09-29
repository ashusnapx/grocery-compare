import { describe, expect, it } from 'vitest';
import { Coalescer, Gate, waitOrAbort } from './concurrency';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('Gate', () => {
  it('never runs more than its limit at once', async () => {
    const gate = new Gate(2);
    let active = 0;
    let peak = 0;
    const job = async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    };
    await Promise.all(Array.from({ length: 7 }, () => gate.run(job)));
    expect(peak).toBe(2);
  });

  it('releases its slot when a job throws', async () => {
    const gate = new Gate(1);
    await expect(gate.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(gate.run(async () => 'next')).resolves.toBe('next');
  });
});

describe('Coalescer', () => {
  it('runs identical in-flight work once and shares the result', async () => {
    const c = new Coalescer<number>();
    let calls = 0;
    const work = async () => {
      calls++;
      await tick();
      return 42;
    };
    const results = await Promise.all([c.run('k', work), c.run('k', work), c.run('k', work)]);
    expect(results).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it('forgets a key once its work settles, so later calls run again', async () => {
    const c = new Coalescer<number>();
    let calls = 0;
    await c.run('k', async () => ++calls);
    await c.run('k', async () => ++calls);
    expect(calls).toBe(2);
  });

  it('shares failures too, then lets the next call retry', async () => {
    const c = new Coalescer<number>();
    const failing = async () => {
      await tick();
      throw new Error('nope');
    };
    await expect(Promise.all([c.run('k', failing), c.run('k', failing)])).rejects.toThrow('nope');
    await expect(c.run('k', async () => 1)).resolves.toBe(1);
  });
});

describe('waitOrAbort', () => {
  it('lets one caller stop waiting without cancelling shared work', async () => {
    const ac = new AbortController();
    let finished = false;
    const shared = (async () => {
      await tick(20);
      finished = true;
      return 'done';
    })();
    const waiting = waitOrAbort(shared, ac.signal);
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await expect(shared).resolves.toBe('done');
    expect(finished).toBe(true);
  });
});
