/**
 * Quantities: what the user asked for and what a pack actually holds.
 *
 * This is load-bearing. The optimizer buys "at least what you asked for" and
 * compares cost, so a pack size read wrong is not a missing row — it is a
 * confidently wrong plan. Every rule here therefore refuses rather than
 * guesses: ambiguous text yields null and the listing is left out.
 */
import type { Dim, Quantity, Unit } from './types';

export interface ParsedPack extends Quantity {
  /** "1 kg (4-6 pcs)" → [4, 6]. Lets a count row use a mass listing (lower bound). */
  countRange?: [number, number];
  /** "1 pc (1.8 - 2.5 kg)" → [1800, 2500] grams. */
  massRange?: [number, number];
}

const UNIT_BASE: Record<Unit, { dim: Dim; factor: number }> = {
  g: { dim: 'mass', factor: 1 },
  kg: { dim: 'mass', factor: 1000 },
  ml: { dim: 'volume', factor: 1 },
  L: { dim: 'volume', factor: 1000 },
  pcs: { dim: 'count', factor: 1 },
  dozen: { dim: 'count', factor: 12 },
  pack: { dim: 'pack', factor: 1 },
};

export const UNITS: Unit[] = ['g', 'kg', 'ml', 'L', 'pcs', 'dozen', 'pack'];

export function toBase(amount: number, unit: Unit): Quantity {
  const { dim, factor } = UNIT_BASE[unit];
  return { value: round(amount * factor), dim };
}

export function dimOf(unit: Unit): Dim {
  return UNIT_BASE[unit].dim;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Unit vocabulary
// ---------------------------------------------------------------------------

/** Longest alternatives first so "kgs" is not read as "kg" + "s". */
const UNIT_WORDS: [RegExp, Unit][] = [
  [/^(?:kilograms?|kilos?|kgs?)$/, 'kg'],
  [/^(?:grams?|grammes?|gms?|grm|gr|g)$/, 'g'],
  [/^(?:millilit(?:re|er)s?|mls?)$/, 'ml'],
  [/^(?:lit(?:re|er)s?|ltrs?|lt|l)$/, 'L'],
  [/^(?:dozens?|dz)$/, 'dozen'],
  [/^(?:pieces?|pcs|pc|nos|no|units?|u)$/, 'pcs'],
  [/^(?:packets?|packs?|pkts?|pouch(?:es)?|bottles?|boxes|box)$/, 'pack'],
];

const UNIT_ALT =
  'kilograms?|kilos?|kgs?|grams?|grammes?|gms?|grm|gr|g|millilit(?:re|er)s?|mls?|lit(?:re|er)s?|ltrs?|lt|l|dozens?|dz|pieces?|pcs|pc|nos|units?|packets?|packs?|pkts?|u';

export function unitFromWord(word: string): Unit | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  for (const [re, unit] of UNIT_WORDS) if (re.test(w)) return unit;
  return null;
}

const NUM = '(\\d+(?:\\.\\d+)?)';

// ---------------------------------------------------------------------------
// Listing quantity text
// ---------------------------------------------------------------------------

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function massOrVolume(amount: number, unitWord: string): Quantity | null {
  const unit = unitFromWord(unitWord);
  if (!unit) return null;
  const { dim } = UNIT_BASE[unit];
  if (dim !== 'mass' && dim !== 'volume') return null;
  return toBase(amount, unit);
}

const FULL_RANGE = new RegExp(`${NUM}\\s*(kgs?|kilos?|g|gms?|grams?|ml|mls|l|ltrs?|litres?)\\s*(?:-|–|to)\\s*${NUM}\\s*(kgs?|kilos?|g|gms?|grams?|ml|mls|l|ltrs?|litres?)\\b`);

/** "900 g - 1 kg", "approx. 1 - 1.2 kg"-style ranges with a unit on both sides. */
export function parseRange(raw: string): { dim: Dim; lo: number; hi: number } | null {
  const m = normalise(raw).match(FULL_RANGE);
  if (!m) return null;
  const a = massOrVolume(Number(m[1]), m[2]!);
  const b = massOrVolume(Number(m[3]), m[4]!);
  if (!a || !b || a.dim !== b.dim || b.value < a.value) return null;
  return { dim: a.dim, lo: a.value, hi: b.value };
}

/**
 * Reads a platform's own net-quantity text: "500 g", "2 x 1 kg",
 * "Pack of 3 (100 g each)", "1 kg (4-6 pcs)", "6 pcs", "1 dozen".
 * Returns null for anything ambiguous.
 */
export function parseQuantityText(raw: string): ParsedPack | null {
  let s = normalise(raw);
  if (!s) return null;

  // "900 g - 1000 g": an approximate weight, counted as its midpoint.
  const full = parseRange(s);
  if (full && !/\b(?:pieces?|pcs|pc|nos)\b/.test(s)) {
    return { dim: full.dim, value: round((full.lo + full.hi) / 2) };
  }

  // Ranges come first and are cut out, so "1 pc (1.8 - 2.5 kg)" is not read
  // as 2.5 kg, and "1 kg (4-6 pcs)" is not read as 6 pieces.
  let massRange: [number, number] | undefined;
  let countRange: [number, number] | undefined;

  const massRangeRe = new RegExp(`${NUM}\\s*(?:-|to)\\s*${NUM}\\s*(kgs?|kilos?|g|gms?|grams?)\\b`);
  const mr = s.match(massRangeRe);
  if (mr) {
    const factor = unitFromWord(mr[3]!) === 'kg' ? 1000 : 1;
    massRange = [round(Number(mr[1]) * factor), round(Number(mr[2]) * factor)];
    s = s.replace(mr[0], ' ');
  }
  const countRangeRe = new RegExp(`(\\d+)\\s*(?:-|to)\\s*(\\d+)\\s*(?:pieces?|pcs|pc|nos|units?)\\b`);
  const cr = s.match(countRangeRe);
  if (cr) {
    countRange = [Number(cr[1]), Number(cr[2])];
    s = s.replace(cr[0], ' ');
  }

  const withRanges = (q: Quantity): ParsedPack => ({
    ...q,
    ...(countRange && q.dim === 'mass' ? { countRange } : {}),
    ...(massRange && q.dim === 'count' ? { massRange } : {}),
  });
  // A multipack's piece count is known exactly: "4 x 150 g" is four bars.
  const multi = (one: Quantity, n: number): ParsedPack => ({
    dim: one.dim,
    value: round(one.value * n),
    countRange: countRange ?? [n, n],
  });

  // "250 g + 50 g free" → 300 g.
  const bonus = s.match(new RegExp(`${NUM}\\s*(${UNIT_ALT})\\b\\s*\\+\\s*${NUM}\\s*(${UNIT_ALT})\\b`));
  if (bonus) {
    const a = massOrVolume(Number(bonus[1]), bonus[2]!);
    const b = massOrVolume(Number(bonus[3]), bonus[4]!);
    if (a && b && a.dim === b.dim) return withRanges({ dim: a.dim, value: round(a.value + b.value) });
  }

  // "Pack of 3 (100 g each)", "pack of 2 x 1 kg"
  const packOfEach = s.match(new RegExp(`pack of (\\d+)\\s*(?:\\(|x|-)?\\s*${NUM}\\s*(${UNIT_ALT})\\b`));
  if (packOfEach) {
    const one = massOrVolume(Number(packOfEach[2]), packOfEach[3]!);
    if (one) return multi(one, Number(packOfEach[1]));
  }

  // "2 x 500 g"
  const nxq = s.match(new RegExp(`(\\d+)\\s*x\\s*${NUM}\\s*(${UNIT_ALT})\\b`));
  if (nxq) {
    const one = massOrVolume(Number(nxq[2]), nxq[3]!);
    if (one) return multi(one, Number(nxq[1]));
    const unit = unitFromWord(nxq[3]!);
    if (unit && UNIT_BASE[unit].dim === 'count') {
      return withRanges({ dim: 'count', value: Number(nxq[1]) * toBase(Number(nxq[2]), unit).value });
    }
  }

  // "500 g x 2"
  const qxn = s.match(new RegExp(`${NUM}\\s*(${UNIT_ALT})\\b\\s*x\\s*(\\d+)\\b`));
  if (qxn) {
    const one = massOrVolume(Number(qxn[1]), qxn[2]!);
    if (one) return multi(one, Number(qxn[3]));
  }

  // "1 pack (6 pieces)"
  const packPieces = s.match(/(\d+)\s*(?:packs?|pkts?|packets?)\s*\(\s*(\d+)\s*(?:pieces?|pcs|pc|nos)\s*(?:each)?\s*\)/);
  if (packPieces) return withRanges({ dim: 'count', value: Number(packPieces[1]) * Number(packPieces[2]) });

  // A single mass or volume, e.g. "1 kg - pouch".
  const singles = [...s.matchAll(new RegExp(`${NUM}\\s*(${UNIT_ALT})\\b`, 'g'))];
  const measures = singles
    .map((m) => ({ q: massOrVolume(Number(m[1]), m[2]!), m }))
    .filter((x): x is { q: Quantity; m: RegExpExecArray } => x.q !== null);

  const packOf = s.match(/pack of (\d+)/);
  if (measures.length) {
    // "500 g - pack of 2": 2 × 500 g or 2 × 250 g? Refuse.
    if (packOf) return null;
    const first = measures[0]!.q;
    // Two different measures of the same kind ("500 g 1 kg") contradict each other.
    if (measures.some((x) => x.q.dim === first.dim && x.q.value !== first.value)) return null;
    return withRanges(first);
  }

  // Counts: "6 pcs", "1 dozen", "12 units", "pack of 6".
  const count = singles
    .map((m) => ({ unit: unitFromWord(m[2]!), n: Number(m[1]) }))
    .find((x) => x.unit && UNIT_BASE[x.unit].dim === 'count');
  if (count?.unit) return withRanges(toBase(count.n, count.unit));
  if (packOf) return withRanges({ dim: 'count', value: Number(packOf[1]) });

  return null;
}

// ---------------------------------------------------------------------------
// What the user typed
// ---------------------------------------------------------------------------

export interface AmountText {
  name: string;
  amount: number | null;
  unit: Unit | null;
}

const FRACTIONS: Record<string, string> = { '½': '0.5', '¼': '0.25', '¾': '0.75', '⅓': '0.333', '⅔': '0.667' };

function normaliseAmounts(text: string): string {
  return text
    .replace(/(\d)\s*([½¼¾⅓⅔])/g, (_, d: string, f: string) => String(Number(d) + Number(FRACTIONS[f])))
    .replace(/[½¼¾⅓⅔]/g, (f) => FRACTIONS[f]!)
    .replace(/(\d+)\s*\/\s*(\d+)/g, (_, a: string, b: string) => String(round(Number(a) / Number(b))))
    .replace(/×/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a typed row into name and amount: "atta 5kg", "5 kg atta",
 * "Milk 1L x 2", "eggs 12", "1/2 kg paneer". The name keeps the user's casing.
 */
export function parseAmountText(raw: string): AmountText {
  const s = normaliseAmounts(raw);
  const unitGroup = `(${UNIT_ALT}|dozen|dozens|dz)`;

  // "Milk 1L x 2", "amul butter 100 g x 3"
  let m = s.match(new RegExp(`^(.*?)\\s+${NUM}\\s*${unitGroup}\\s*x\\s*(\\d+)$`, 'i'));
  if (m) {
    const unit = unitFromWord(m[3]!);
    if (unit) return { name: m[1]!.trim(), amount: round(Number(m[2]) * Number(m[4])), unit };
  }

  // "5 kg atta", "2 dozen eggs"
  m = s.match(new RegExp(`^${NUM}\\s*${unitGroup}\\s+(?:of\\s+)?(.+)$`, 'i'));
  if (m) {
    const unit = unitFromWord(m[2]!);
    if (unit) return { name: m[3]!.trim(), amount: Number(m[1]), unit };
  }

  // "atta 5kg", "paneer 250gm", "bread 2 packets"
  m = s.match(new RegExp(`^(.*?)\\s*${NUM}\\s*${unitGroup}$`, 'i'));
  if (m && m[1]!.trim()) {
    const unit = unitFromWord(m[3]!);
    if (unit) return { name: m[1]!.trim(), amount: Number(m[2]), unit };
  }

  // "Maggi x 4", "eggs 12"
  m = s.match(/^(.*?)\s*(?:x\s*)?(\d+(?:\.\d+)?)$/i);
  if (m && m[1]!.trim() && !/\d$/.test(m[1]!.trim())) {
    return { name: m[1]!.trim().replace(/\s*x$/i, ''), amount: Number(m[2]), unit: null };
  }

  return { name: s, amount: null, unit: null };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function trimNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function formatQuantity(q: Quantity): string {
  switch (q.dim) {
    case 'mass':
      return q.value >= 1000 ? `${trimNum(q.value / 1000)} kg` : `${trimNum(q.value)} g`;
    case 'volume':
      return q.value >= 1000 ? `${trimNum(q.value / 1000)} L` : `${trimNum(q.value)} ml`;
    case 'count':
      return q.value === 1 ? '1 pc' : `${trimNum(q.value)} pcs`;
    case 'pack':
      return q.value === 1 ? '1 pack' : `${trimNum(q.value)} packs`;
  }
}

export function formatAmount(amount: number, unit: Unit): string {
  return formatQuantity(toBase(amount, unit));
}
