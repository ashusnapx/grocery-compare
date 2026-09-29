/**
 * Being a good citizen at public scale: every user's comparison funnels
 * through one process, so identical in-flight work is merged and each
 * platform sees a bounded number of simultaneous requests — however many
 * people are comparing at once.
 */

/** A counting semaphore: at most `limit` jobs run at once, the rest queue in order. */
export class Gate {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    try {
      return await job();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

/** Runs identical in-flight work once; every caller with the same key shares the promise. */
export class Coalescer<T> {
  private readonly inflight = new Map<string, Promise<T>>();

  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = work().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

/**
 * Waits for shared work on behalf of one caller. If the caller's signal
 * aborts (their deadline, their disconnect) they stop waiting, but the work
 * itself carries on for everyone else — and lands in the cache.
 */
export function waitOrAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function abortError(): Error {
  const e = new Error('stopped waiting');
  e.name = 'AbortError';
  return e;
}
