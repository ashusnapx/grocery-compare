import type { Browser, BrowserContext, Page, Response } from 'playwright';
import { BlockedError, TimeoutError } from '../errors';
import { assertNotBlocked } from './detect';

/**
 * A small pool of real Chromium pages, for platforms whose search sits behind
 * a JavaScript challenge (AWS WAF on Zepto and Instamart). A page loads the
 * platform's own site once, which lets the challenge run exactly as it would
 * for a person, and then searches run as `fetch` calls *inside that page* —
 * same origin, same cookies, same browser.
 *
 * Sessions are keyed (typically platform + store area) and recycled after
 * SESSION_TTL_MS, after SESSION_IDLE_MS without use, or whenever a caller
 * reports that the session went bad (dropSession / withSession).
 *
 * What was measured on 2026-09-27 (Zepto + Instamart, residential IP,
 * Bengaluru), and why the launch looks the way it does:
 *  - Playwright's default headless build (chromium-headless-shell) announces
 *    itself: UA "HeadlessChrome", a "HeadlessChrome" client-hint brand,
 *    SwiftShader WebGL, zero plugins. Zepto's WAF challenge *passes* and
 *    issues a token, and the very next page load is refused with a bare 429.
 *  - The full Chromium build in new headless mode (`channel: 'chromium'`) has
 *    real GPU WebGL, plugins and `window.chrome`, and differs from a headed
 *    browser only in its UA string. With that one string corrected (a
 *    context-level override, which also reaches workers) both sites load and
 *    their searches answer 200 headless. Nothing else is spoofed.
 *  - The UA override does not set client-hint brands; new headless reports
 *    "Chromium" + "Not_A Brand", which is what a genuine Chromium sends.
 *  - Viewport and screen are set together so innerWidth never exceeds
 *    screen.width, an inconsistency a fingerprint check can see.
 *
 * `BROWSER_HEADLESS=false` runs the same thing headed, for diagnosis.
 */

const SESSION_TTL_MS = Number(process.env.BROWSER_SESSION_TTL_MS ?? 30 * 60 * 1000);
const SESSION_IDLE_MS = Number(process.env.BROWSER_SESSION_IDLE_MS ?? 15 * 60 * 1000);
/** Each session is a browser context + page (~150–250 MB on these sites). */
const MAX_SESSIONS = Number(process.env.BROWSER_MAX_SESSIONS ?? 6);
/** In-page fetches allowed at once per page; search.ts sends up to 4 per platform. */
const PAGE_CONCURRENCY = Number(process.env.BROWSER_PAGE_CONCURRENCY ?? 4);
const SETUP_TIMEOUT_MS = Number(process.env.BROWSER_SETUP_TIMEOUT_MS ?? 30_000);
const SWEEP_EVERY_MS = 60_000;
/** A retired session with fetches still in flight is closed after this grace. */
const RETIRE_GRACE_MS = 20_000;
const HEADLESS = process.env.BROWSER_HEADLESS !== 'false';

/** Where the page's untouched `fetch` is kept; sites wrap window.fetch (Zepto: Faro tracing). */
const NATIVE_FETCH_KEY = '__gcNativeFetch';

const VIEWPORT = { width: 1440, height: 789 };
const SCREEN = { width: 1440, height: 900 };

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

let browserPromise: Promise<Browser> | null = null;
let userAgent: string | null = null;
let sweeper: NodeJS.Timeout | null = null;

/**
 * A current desktop Chrome UA for the launched build, e.g. "… Chrome/153.0.0.0
 * Safari/537.36". The platform token follows the host OS so that it agrees
 * with navigator.platform, which the override does not change.
 */
function userAgentFor(version: string): string {
  const major = version.split('.')[0] || '140';
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

async function launch(): Promise<Browser> {
  // Loaded here, not at the top: hosts that never launch a browser (the web app
  // running searches in-process) never load Playwright either.
  const { chromium } = await import('playwright');
  const args = ['--disable-blink-features=AutomationControlled'];
  try {
    // The full Chromium build; headless here means Chrome's new headless mode.
    return await chromium.launch({ headless: HEADLESS, channel: 'chromium', args });
  } catch (e) {
    // Only chromium-headless-shell is installed. It still launches, but it is
    // the build the WAF refused; say so instead of failing silently later.
    console.warn(`[browser] full Chromium unavailable (${(e as Error).message.split('\n')[0]}); falling back to the headless shell, which AWS WAF has refused`);
    return chromium.launch({ headless: HEADLESS, args });
  }
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch()
      .then((b) => {
        userAgent = process.env.BROWSER_USER_AGENT || userAgentFor(b.version());
        b.on('disconnected', () => {
          // Crash or external kill: forget everything so the next caller relaunches.
          browserPromise = null;
          sessions.clear();
        });
        return b;
      })
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  sweeper ??= setInterval(sweep, SWEEP_EVERY_MS).unref();
  return browserPromise;
}

// ---------------------------------------------------------------------------
// Per-page concurrency
// ---------------------------------------------------------------------------

class Limiter {
  private active = 0;
  private waiting: (() => void)[] = [];
  private idleWaiters: (() => void)[] = [];
  constructor(private readonly max: number) {}

  get inFlight(): number {
    return this.active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
      if (this.active === 0 && this.waiting.length === 0) this.idleWaiters.splice(0).forEach((f) => f());
    }
  }

  idle(): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
}

const limiters = new WeakMap<Page, Limiter>();
function limiterFor(page: Page): Limiter {
  let l = limiters.get(page);
  if (!l) {
    l = new Limiter(PAGE_CONCURRENCY);
    limiters.set(page, l);
  }
  return l;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionOptions {
  /** Unique per platform + location, e.g. "zepto:12.935,77.624". */
  key: string;
  /** Called once with a fresh page: navigate, set location, wait for the site to settle. */
  setup: (page: Page, context: BrowserContext) => Promise<void>;
  locale?: string;
  geolocation?: { latitude: number; longitude: number };
  /**
   * Stops *this caller* waiting for setup (e.g. the comparison's deadline).
   * Setup itself carries on, so the session is warm for the next request.
   */
  signal?: AbortSignal;
}

interface Session {
  key: string;
  createdAt: number;
  lastUsedAt: number;
  context: BrowserContext | null;
  page: Page | null;
  ready: Promise<Page>;
  retired: boolean;
}

const sessions = new Map<string, Session>();

function isUsable(s: Session): boolean {
  if (s.retired) return false;
  if (Date.now() - s.createdAt >= SESSION_TTL_MS) return false;
  return !s.page || !s.page.isClosed();
}

/** Returns a ready page for `key`, creating (and setting up) one if needed. */
export async function getSessionPage(opts: SessionOptions): Promise<Page> {
  let s = sessions.get(opts.key);
  if (s && !isUsable(s)) {
    retire(s);
    s = undefined;
  }
  s ??= createSession(opts);
  s.lastUsedAt = Date.now();
  return opts.signal ? raceSignal(s.ready, opts.signal, `${opts.key}: session setup`) : s.ready;
}

function createSession(opts: SessionOptions): Session {
  const s: Session = {
    key: opts.key,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    context: null,
    page: null,
    ready: Promise.resolve(null as unknown as Page),
    retired: false,
  };
  // Registered before the first await, so concurrent callers share this one.
  sessions.set(opts.key, s);
  s.ready = (async () => {
    evictForRoom(s);
    const browser = await getBrowser();
    const context = await browser.newContext({
      locale: opts.locale ?? 'en-IN',
      timezoneId: 'Asia/Kolkata',
      viewport: VIEWPORT,
      screen: SCREEN,
      userAgent: userAgent ?? undefined,
      geolocation: opts.geolocation,
      permissions: opts.geolocation ? ['geolocation'] : [],
    });
    s.context = context;
    if (s.retired) {
      // Retired while the context was being created: retire() had nothing to close yet.
      await context.close().catch(() => undefined);
      throw new Error(`${opts.key}: session dropped during setup`);
    }
    // Keep the browser's own fetch before any site script wraps it.
    await context.addInitScript((key: string) => {
      if (!Object.prototype.hasOwnProperty.call(window, key)) {
        Object.defineProperty(window, key, { value: window.fetch.bind(window), enumerable: false });
      }
    }, NATIVE_FETCH_KEY);
    const page = await context.newPage();
    s.page = page;
    page.on('crash', () => retire(s));
    await withDeadline(opts.setup(page, context), SETUP_TIMEOUT_MS, `${opts.key}: session setup`);
    if (s.retired) throw new Error(`${opts.key}: session dropped during setup`);
    return page;
  })();
  s.ready.catch(() => retire(s));
  return s;
}

/** Removes a session from the pool and closes it once its in-flight fetches finish. */
function retire(s: Session): void {
  if (sessions.get(s.key) === s) sessions.delete(s.key);
  if (s.retired) return;
  s.retired = true;
  const close = () => void s.context?.close().catch(() => undefined);
  if (!s.page || s.page.isClosed()) return close();
  const grace = new Promise<void>((resolve) => setTimeout(resolve, RETIRE_GRACE_MS).unref());
  void Promise.race([limiterFor(s.page).idle(), grace]).then(close);
}

function evictForRoom(keep: Session): void {
  const others = [...sessions.values()].filter((s) => s !== keep);
  if (others.length < MAX_SESSIONS) return;
  others.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  for (const s of others.slice(0, others.length - MAX_SESSIONS + 1)) retire(s);
}

function sweep(): void {
  const now = Date.now();
  for (const s of sessions.values()) {
    const busy = s.page ? limiterFor(s.page).inFlight > 0 : true;
    if (!busy && (now - s.lastUsedAt >= SESSION_IDLE_MS || !isUsable(s))) retire(s);
  }
}

/**
 * Drops the session for `key`. With `onlyIfPage`, drops it only if it is still
 * the session that page belongs to — so when several concurrent searches all
 * see the same challenge, the first one recycles the session and the others
 * join the replacement instead of tearing it down again.
 */
export async function dropSession(key: string, onlyIfPage?: Page): Promise<void> {
  const s = sessions.get(key);
  if (!s) return;
  if (onlyIfPage && s.page !== onlyIfPage) return;
  retire(s);
}

/**
 * Runs `fn` with the session's page. If it fails with BlockedError (a challenge
 * or refusal mid-session) or because the page died, the session is recycled
 * once — a fresh page re-runs setup, and so the challenge — and `fn` is
 * retried. A second failure throws. Rate limits are not retried (see
 * RateLimitedError).
 */
export async function withSession<T>(
  opts: SessionOptions,
  fn: (page: Page) => Promise<T>,
  shouldRetry: (e: unknown) => boolean = isRecoverableBySession,
): Promise<T> {
  const page = await getSessionPage(opts);
  try {
    return await fn(page);
  } catch (e) {
    if (!shouldRetry(e) || opts.signal?.aborted) throw e;
    await dropSession(opts.key, page);
    return fn(await getSessionPage(opts));
  }
}

// ---------------------------------------------------------------------------
// Getting through the challenge
// ---------------------------------------------------------------------------

export interface OpenOptions {
  /** Resolves true once the real site (not the challenge page) is ready. Polled. */
  ready: () => Promise<boolean>;
  timeoutMs?: number;
}

/**
 * Navigates to `url` and waits until `ready()` holds. AWS WAF answers the first
 * load with 202 + `x-amzn-waf-action: challenge` and a script that earns the
 * `aws-waf-token` cookie and reloads; that is expected and waited through. A
 * main-document answer of 4xx/5xx after that, or Chrome's error page, is a
 * refusal and throws BlockedError at once instead of waiting out the timeout.
 */
export async function openThroughChallenge(page: Page, url: string, opts: OpenOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const host = new URL(url).host;
  let refusal: string | null = null;
  const onResponse = (res: Response) => {
    if (res.request().frame() !== page.mainFrame() || res.request().resourceType() !== 'document') return;
    const waf = res.headers()['x-amzn-waf-action'];
    if (waf === 'challenge' && res.status() === 202) return; // the challenge page itself
    if (waf) refusal = `${host}: AWS WAF ${waf} (HTTP ${res.status()})`;
    else if (res.status() >= 400) refusal = `${host}: page load refused (HTTP ${res.status()})`;
  };
  page.on('response', onResponse);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch((e: Error) => {
      if (/timeout/i.test(e.message)) throw new TimeoutError(`${host}: page did not load within ${timeoutMs} ms`);
      // ERR_HTTP_RESPONSE_CODE_FAILURE and friends: the response handler says why.
      if (!refusal) throw e;
    });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (refusal) throw new BlockedError(refusal);
      if (page.url().startsWith('chrome-error://')) throw new BlockedError(`${host}: page load failed after the challenge`);
      if (await opts.ready().catch(() => false)) return;
      if (Date.now() > deadline) throw new TimeoutError(`${host}: site not ready within ${timeoutMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    page.off('response', onResponse);
  }
}

/** Cookie name → decoded value for one origin of the page's context. */
export async function cookieJar(context: BrowserContext, origin: string): Promise<Record<string, string>> {
  const jar: Record<string, string> = {};
  for (const c of await context.cookies(origin)) {
    try {
      jar[c.name] = decodeURIComponent(c.value);
    } catch {
      jar[c.name] = c.value;
    }
  }
  return jar;
}

// ---------------------------------------------------------------------------
// In-page fetch
// ---------------------------------------------------------------------------

export interface PageFetchResult {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface PageFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  credentials?: 'include' | 'same-origin' | 'omit';
  /** Node-side only: stop waiting when the caller gives up. */
  signal?: AbortSignal;
}

/**
 * The request never produced a readable response: a network error, or — the
 * common case on these sites — an edge refusal sent without CORS headers, which
 * the browser reports only as "Failed to fetch". The real status is not
 * visible to page scripts, so callers usually treat this as a block.
 */
export class BrowserFetchError extends Error {
  constructor(
    message: string,
    /** The page itself went away (closed, crashed, navigated); a fresh session is the fix, not a block. */
    readonly pageClosed = false,
  ) {
    super(message);
    this.name = 'BrowserFetchError';
  }
}

/**
 * The platform said "slow down" (HTTP 429, or an in-body 429). Still a
 * BlockedError for status purposes, but withSession does NOT recycle the
 * session for it: a fresh session would only dodge the limit, and the spec
 * says back off, then report blocked.
 */
export class RateLimitedError extends BlockedError {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedError';
  }
}

/** withSession's default: recycle for a challenge/refusal or a dead page, never for a rate limit. */
export function isRecoverableBySession(e: unknown): boolean {
  if (e instanceof RateLimitedError) return false;
  return e instanceof BlockedError || (e instanceof BrowserFetchError && e.pageClosed);
}

/**
 * Runs `fetch` inside the page, so the request carries the page's origin,
 * cookies (including any WAF token) and the real browser's network stack.
 * Uses the browser's own fetch, not the site's instrumented wrapper. At most
 * PAGE_CONCURRENCY run at once per page.
 */
export async function pageFetch(
  page: Page,
  url: string,
  init: PageFetchInit = {},
  timeoutMs = 10_000,
): Promise<PageFetchResult> {
  const host = new URL(url, 'https://invalid.local').host;
  const { signal, ...wire } = init;
  return limiterFor(page).run(async () => {
    if (signal?.aborted) throw new TimeoutError(`${host}: gave up before sending`);
    if (page.isClosed()) throw new BrowserFetchError(`${host}: session page is closed`, true);
    const run = page.evaluate(
      async ({ url, init, timeoutMs, nativeKey }) => {
        const w = window as unknown as Record<string, typeof fetch>;
        const f = w[nativeKey] ?? window.fetch.bind(window);
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        try {
          const r = await f(url, { ...init, credentials: init.credentials ?? 'include', signal: ac.signal });
          const headers: Record<string, string> = {};
          r.headers.forEach((v, k) => {
            headers[k] = v;
          });
          return { ok: true as const, status: r.status, headers, text: await r.text() };
        } catch (e) {
          return { ok: false as const, error: String(e), timedOut: ac.signal.aborted };
        } finally {
          clearTimeout(timer);
        }
      },
      { url, init: wire, timeoutMs, nativeKey: NATIVE_FETCH_KEY },
    );
    let res: Awaited<typeof run>;
    try {
      // The in-page abort normally fires first; this is the backstop for a hung page.
      res = await withDeadline(signal ? raceSignal(run, signal, host) : run, timeoutMs + 2000, host);
    } catch (e) {
      if (e instanceof TimeoutError) throw e;
      // A closed page, or a navigation that destroyed the execution context mid-request.
      throw new BrowserFetchError(`${host}: ${(e as Error).message.split('\n')[0]}`, true);
    }
    if (!res.ok) {
      if (res.timedOut) throw new TimeoutError(`${host}: no answer within ${timeoutMs} ms`);
      throw new BrowserFetchError(`${host}: ${res.error}`);
    }
    return { status: res.status, headers: res.headers, text: res.text };
  });
}

/** Throws BlockedError when an in-page response is an edge refusal (WAF challenge, 403, 429 …). */
export function assertPageResponseNotBlocked(res: PageFetchResult, host: string): void {
  assertNotBlocked({ status: res.status, headers: { get: (name) => res.headers[name.toLowerCase()] ?? null } }, host);
}

// ---------------------------------------------------------------------------
// Helpers and shutdown
// ---------------------------------------------------------------------------

async function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${what}: no answer within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function raceSignal<T>(p: Promise<T>, signal: AbortSignal, what: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new TimeoutError(`${what}: deadline passed`));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TimeoutError(`${what}: deadline passed`));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export async function closeBrowser(): Promise<void> {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
  const all = [...sessions.values()];
  sessions.clear();
  await Promise.all(
    all.map(async (s) => {
      s.retired = true;
      await s.context?.close().catch(() => undefined);
    }),
  );
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close().catch(() => undefined);
  }
}
