/**
 * Reads the fees out of a bill — text the user pasted, or text recognised
 * on their own device from a screenshot of their last order. This is how
 * jhola learns what an app charges *this* user (fees differ by account)
 * without anyone logging in anywhere: the bill never leaves the device, and
 * the numbers become a FeeOverride saved in the browser.
 *
 * OCR mangles "₹" into "%", "Rs", "Z" and friends, and puts distances on the
 * delivery line ("2.1 kms"), so amounts are the last money-like number on a
 * line that isn't a distance or a weight.
 */
import type { FeeOverride, PlatformId } from './types';

export interface BillReading {
  platformId: PlatformId | null;
  itemTotal?: number;
  deliveryFee?: number;
  /** A delivery line marked FREE (usually a struck-through fee). */
  deliveryFree?: boolean;
  handlingFee?: number;
  smallCartFee?: number;
  smallCartBelow?: number;
  platformFee?: number;
  packagingFee?: number;
  lateNightFee?: number;
  surgeFee?: number;
  freeDeliveryAbove?: number;
}

const PLATFORM_WORDS: [RegExp, PlatformId][] = [
  [/\bblinkit\b/, 'blinkit'],
  [/\bzepto\b/, 'zepto'],
  [/\b(?:instamart|swiggy)\b/, 'instamart'],
  [/\b(?:bigbasket|bb ?now)\b/, 'bigbasket'],
  [/\bjio ?mart\b/, 'jiomart'],
  [/\bd ?mart\b/, 'dmart'],
];

const CURRENCY = String.raw`(?:₹|rs\.?|inr|%|¥)?\s*`;
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const EXPLICIT = /(?:₹|rs\.?|inr|%|¥)\s*$/i;
/** Digits OCR commonly produces for an unrecognised "₹". */
const RUPEE_LOOKALIKES = new Set(['3', '2', '7']);

function num(s: string): number {
  return Number(s.replace(/,/g, ''));
}

interface Amount {
  raw: string;
  value: number;
  /** A currency sign was read right before the number, so its first digit is real. */
  explicit: boolean;
}

/** The last amount on a line, skipping distances and weights ("2.1 kms", "500 g"). */
function lastAmount(line: string): Amount | undefined {
  const re = new RegExp(`${CURRENCY}${AMOUNT}(?!\\s*(?:km|kms|m\\b|kg|g\\b|gm|ml|l\\b|pcs|items?\\b|%))`, 'gi');
  let found: Amount | undefined;
  for (const m of line.matchAll(re)) {
    const numberStart = m.index! + m[0].length - m[1]!.length;
    found = { raw: m[1]!, value: num(m[1]!), explicit: EXPLICIT.test(line.slice(0, numberStart)) };
  }
  return found;
}

type Kind = 'item' | 'delivery' | 'handling' | 'small' | 'platform' | 'packaging' | 'late' | 'surge' | 'total' | 'above' | 'more';

interface Entry {
  kind: Kind;
  amount: Amount;
}

function classify(line: string): Kind | null {
  if (new RegExp(`free delivery (?:on |for )?(?:orders |items )?(?:above|over|of) `).test(line)) return 'above';
  if (/add (?:items )?(?:worth )?.*(?:to get|for|to unlock) free delivery/.test(line)) return 'more';
  if (/\bitems? total\b|\bbasket (?:value|total)\b|\bsub ?total\b/.test(line)) return 'item';
  if (/\b(?:grand total|to pay|total payable|amount payable|net payable|bill total|order total)\b/.test(line)) return 'total';
  if (/\bsmall cart (?:fee|charges?)\b/.test(line)) return 'small';
  if (/\bhandling (?:fee|charges?)\b/.test(line)) return 'handling';
  if (/\bpackag(?:ing|e) (?:fee|charges?)\b/.test(line)) return 'packaging';
  if (/\blate ?night (?:fee|charges?)\b/.test(line)) return 'late';
  if (/\b(?:surge|rain|high demand) (?:fee|charges?)\b/.test(line)) return 'surge';
  if (/\b(?:platform|convenience) fee\b/.test(line)) return 'platform';
  if (/\bdelivery (?:fee|charges?|partner fee)\b/.test(line)) return 'delivery';
  return null;
}

export function parseBillText(raw: string): BillReading {
  const text = raw.toLowerCase().replace(/ /g, ' ');
  const reading: BillReading = { platformId: null };
  for (const [re, id] of PLATFORM_WORDS) {
    if (re.test(text)) {
      reading.platformId = id;
      break;
    }
  }

  const entries: Entry[] = [];
  let deliveryFree = false;
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/\s+/g, ' ').trim();
    const kind = line ? classify(line) : null;
    if (!kind) continue;
    if (kind === 'delivery' && /\bfree\b/.test(line)) {
      deliveryFree = true;
      continue;
    }
    if (kind === 'small') {
      const below = line.match(new RegExp(`below ${CURRENCY}${AMOUNT}`));
      if (below) {
        reading.smallCartBelow = num(below[1]!);
        line = line.replace(below[0], ' ');
      }
    }
    if (kind === 'above' || kind === 'more') {
      const m = line.match(new RegExp(kind === 'above' ? `(?:above|over|of) ${CURRENCY}${AMOUNT}` : `(?:worth |add )${CURRENCY}${AMOUNT}`));
      if (m) {
        const numberStart = m.index! + m[0].length - m[1]!.length;
        entries.push({ kind, amount: { raw: m[1]!, value: num(m[1]!), explicit: EXPLICIT.test(line.slice(0, numberStart)) } });
      }
      continue;
    }
    const amount = lastAmount(line);
    if (amount) entries.push({ kind, amount });
  }

  // --- "₹" read as a digit ---------------------------------------------------
  // Tesseract often turns an unrecognised ₹ into a leading 3 (or 2, 7): "₹25"
  // becomes "325". The bill's own arithmetic decides: if items + fees only add
  // up to the grand total once that digit is dropped, it was a misread.
  const bare = entries.filter((e) => !e.amount.explicit && e.amount.raw.replace(/[,.]/g, '').length >= 2);
  const firstDigits = bare.map((e) => e.amount.raw[0]!);
  const suspect = [...new Set(firstDigits)].sort((a, b) => firstDigits.filter((d) => d === b).length - firstDigits.filter((d) => d === a).length)[0];
  const strip = (a: Amount) =>
    suspect && RUPEE_LOOKALIKES.has(suspect) && !a.explicit && a.raw[0] === suspect && a.raw.replace(/[,.]/g, '').length >= 2 ? num(a.raw.slice(1)) : a.value;

  const PARTS: Kind[] = ['item', 'delivery', 'handling', 'small', 'platform', 'packaging', 'late', 'surge'];
  const partsSum = (useStrip: boolean) =>
    entries.filter((e) => PARTS.includes(e.kind)).reduce((sum, e) => sum + (useStrip ? strip(e.amount) : e.amount.value), 0);
  const total = entries.find((e) => e.kind === 'total');
  let misread = false;
  if (suspect && RUPEE_LOOKALIKES.has(suspect)) {
    if (total) {
      const targets = [total.amount.value, strip(total.amount)];
      const fits = (v: number) => targets.some((t) => Math.abs(t - v) <= 1);
      misread = !fits(partsSum(false)) && fits(partsSum(true));
    } else {
      const FEES: Kind[] = ['delivery', 'handling', 'small', 'platform', 'packaging', 'late', 'surge'];
      misread = entries.some((e) => FEES.includes(e.kind) && e.amount.value > 100 && strip(e.amount) <= 100);
    }
  }
  const valueOf = (a: Amount) => Math.round((misread ? strip(a) : a.value) * 100) / 100;

  let addMore: number | undefined;
  for (const e of entries) {
    const v = valueOf(e.amount);
    switch (e.kind) {
      case 'item':
        reading.itemTotal = v;
        break;
      case 'delivery':
        reading.deliveryFee = v;
        break;
      case 'handling':
        reading.handlingFee = v;
        break;
      case 'small':
        reading.smallCartFee = v;
        break;
      case 'platform':
        reading.platformFee = v;
        break;
      case 'packaging':
        reading.packagingFee = v;
        break;
      case 'late':
        reading.lateNightFee = v;
        break;
      case 'surge':
        reading.surgeFee = v;
        break;
      case 'above':
        reading.freeDeliveryAbove = v;
        break;
      case 'more':
        addMore = v;
        break;
      case 'total':
        break;
    }
  }
  if (deliveryFree) {
    reading.deliveryFree = true;
    delete reading.deliveryFee;
  }
  if (addMore !== undefined && reading.itemTotal !== undefined && reading.freeDeliveryAbove === undefined) {
    reading.freeDeliveryAbove = Math.round((reading.itemTotal + addMore) * 100) / 100;
  }
  return reading;
}

/** The fee override a bill implies. Only what the bill actually shows is set. */
export function billToOverride(r: BillReading, platformId: PlatformId): FeeOverride {
  const o: FeeOverride = { platformId };
  if (r.deliveryFee !== undefined && r.deliveryFee > 0 && !r.deliveryFree) o.deliveryFee = r.deliveryFee;
  if (r.freeDeliveryAbove !== undefined) o.freeDeliveryAbove = r.freeDeliveryAbove;
  if (r.handlingFee !== undefined) o.handlingFee = r.handlingFee;
  if (r.smallCartFee !== undefined) o.smallCartFee = r.smallCartFee;
  if (r.smallCartBelow !== undefined) o.smallCartBelow = r.smallCartBelow;
  return o;
}
