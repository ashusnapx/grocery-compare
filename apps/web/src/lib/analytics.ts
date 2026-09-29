/**
 * Google Analytics 4. What is sent is about how jhola is used, never who uses
 * it: no names, phone numbers, addresses, coordinates or pincodes (GA derives
 * a city from the visit itself), and typed text is reduced to the grocery item
 * it names with digits removed. Google signals and ad personalisation are off.
 * A shopper can switch analytics off on the privacy page; that choice lives in
 * their browser.
 */
import { itemFor } from '@gc/engine';
import { SITE } from './site';

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? SITE.gaId;
export const OPT_OUT_KEY = 'jhola:analytics-off';
/** Set by our own browser checks that want to be counted (automated browsers are otherwise left out). */
export const TEST_KEY = 'jhola:ga-test';

type Value = string | number | boolean | undefined | null;
export type EventParams = Record<string, Value | Record<string, Value>[]>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

/** Switched off by the shopper, or an automated browser (tests, bots) that hasn't asked to be counted. */
export function analyticsOff(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1' || (navigator.webdriver === true && localStorage.getItem(TEST_KEY) !== '1');
  } catch {
    return navigator.webdriver === true;
  }
}

export function setAnalyticsOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // Storage blocked: the choice holds for this page only.
  }
  (window as unknown as Record<string, boolean>)[`ga-disable-${GA_ID}`] = off;
}

// Events from before the tag has loaded (it loads after hydration) wait here, briefly.
const pending: [string, EventParams][] = [];
let flushing: number | null = null;

function flush() {
  if (!window.gtag) return;
  for (const [event, params] of pending.splice(0)) window.gtag('event', event, params);
  if (flushing !== null) window.clearInterval(flushing);
  flushing = null;
}

/** Sends one GA4 event; a no-op without an ID or when switched off. */
export function track(event: string, params: EventParams = {}): void {
  if (!GA_ID || typeof window === 'undefined' || analyticsOff()) return;
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')) as EventParams;
  if (window.gtag) {
    window.gtag('event', event, clean);
    return;
  }
  if (pending.length < 50) pending.push([event, clean]);
  if (flushing === null) {
    const started = Date.now();
    flushing = window.setInterval(() => {
      if (window.gtag || Date.now() - started > 15_000) flush();
    }, 400);
  }
}

export function setUserProperties(props: Record<string, string | number | boolean>): void {
  if (!GA_ID || typeof window === 'undefined' || !window.gtag || analyticsOff()) return;
  window.gtag('set', 'user_properties', props);
}

/** What a typed row or query is about, safe to report: the dictionary item, else the words without digits. */
export function itemLabel(text: string): string {
  const known = itemFor(text);
  if (known) return known.key;
  return text
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\s&'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** A typed search as reported: the words (brand included), lower-cased, digits and symbols removed. */
export function searchLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\s&'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** Rupees rounded to paise, as GA expects for `value` and money metrics. */
export const money = (n: number) => Math.round(n * 100) / 100;
