/**
 * Understanding what the user typed: brand, product type, required words,
 * search text — plus the paste-a-list parser and autocomplete.
 */
import { ITEMS, findBrand, findItem, itemForms, ITEM_BY_KEY, type DictItem } from './dictionary';
import { parseAmountText, toBase, unitFromWord } from './quantity';
import { normalizeText, phonetic, SOFT_WORDS, STOPWORDS, tokenize } from './text';
import type { ListRow, ParsedRow, Unit } from './types';

export function parseRow(row: ListRow): ParsedRow {
  // The text field may still carry an amount ("atta 5kg") if the UI did not split it.
  const name = parseAmountText(row.text).name || row.text;
  const words = tokenize(name);
  const keys = words.map(phonetic);

  const brandHit = findBrand(keys);
  let itemHit = findItem(keys);
  let item: DictItem | null = itemHit?.value ?? null;

  // A brand-only row ("maggi", "horlicks") means the brand's product.
  if (!item && brandHit?.value.implies) item = ITEM_BY_KEY[brandHit.value.implies] ?? null;

  const inBrand = (i: number) => !!brandHit && i >= brandHit.start && i < brandHit.end;
  const inItem = (i: number) => !!itemHit && i >= itemHit.start && i < itemHit.end;
  const isFiller = (w: string) => STOPWORDS.has(w) || SOFT_WORDS.has(w) || /^\d+(\.\d+)?$/.test(w) || !!unitFromWord(w);

  let head: string;
  let headForms: string[];
  if (item) {
    head = item.key;
    headForms = itemForms(item);
  } else {
    const candidates = words.filter((w, i) => !inBrand(i) && !isFiller(w));
    head = candidates[candidates.length - 1] ?? words[words.length - 1] ?? '';
    headForms = [head];
    const headIndex = words.lastIndexOf(head);
    itemHit = headIndex >= 0 ? { value: null as never, start: headIndex, end: headIndex + 1, form: head } : null;
  }

  const required = words.filter((w, i) => !inBrand(i) && !inItem(i) && !isFiller(w));
  const brand = brandHit?.value.name ?? null;
  const brandLocked = !!brand && !row.anyBrand;

  const productWord = item ? item.search : head;
  const searchParts = [...(brandLocked ? [normalizeText(brand!)] : []), ...required, productWord];
  const searchText = dedupeWords(searchParts.join(' '));
  const original = dedupeWords(normalizeText(name));

  return {
    id: row.id,
    text: row.text,
    quantity: toBase(row.amount, row.unit),
    brand,
    brandLocked,
    head,
    headForms,
    itemKey: item?.key ?? null,
    required,
    searchText,
    fallbackSearchText: original && original !== searchText ? original : null,
  };
}

function dedupeWords(s: string): string {
  const seen = new Set<string>();
  return s
    .split(' ')
    .filter((w) => w && !seen.has(w) && seen.add(w))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Defaults, paste, autocomplete
// ---------------------------------------------------------------------------

export function itemFor(text: string): DictItem | null {
  const keys = tokenize(text).map(phonetic);
  const hit = findItem(keys);
  if (hit) return hit.value;
  const brand = findBrand(keys);
  return brand?.value.implies ? (ITEM_BY_KEY[brand.value.implies] ?? null) : null;
}

/** The usual amount for an item, e.g. eggs → 12 pcs, atta → 5 kg; unknown items → 1 pack. */
export function defaultAmount(text: string): { amount: number; unit: Unit } {
  const item = itemFor(text);
  return item ? { amount: item.amount, unit: item.unit } : { amount: 1, unit: 'pack' };
}

/**
 * Completes a typed row: splits "atta 5kg" into name and amount, and fills in
 * the usual amount when none was typed. A bare count ("eggs 12") takes the
 * item's usual unit.
 */
export function completeRow(text: string): { text: string; amount: number; unit: Unit } {
  const parsed = parseAmountText(text);
  const name = parsed.name.replace(/[\s:–—,-]+$/, '').trim() || text.trim();
  const fallback = defaultAmount(name);
  if (parsed.amount !== null && parsed.unit) return { text: name, amount: parsed.amount, unit: parsed.unit };
  if (parsed.amount !== null) return { text: name, amount: parsed.amount, unit: fallback.unit };
  return { text: name, ...fallback };
}

const BULLET = /^\s*(?:\d+\s*[.)]\s+|[-*•·●▪▫◦‣⁃–—>✅✔☑☐□]+\s*)/u;

/** Turns a pasted list (WhatsApp note, one item per line or comma) into rows. */
export function parsePastedList(text: string): Omit<ListRow, 'id'>[] {
  const out: Omit<ListRow, 'id'>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.replace(BULLET, '').trim();
    if (!cleaned || /:\s*$/.test(cleaned) || !/\p{L}/u.test(cleaned)) continue;
    for (const piece of cleaned.split(/[,;]+(?!\d{3}\b)/)) {
      const p = piece.replace(BULLET, '').trim();
      if (!p || !/\p{L}/u.test(p)) continue;
      const done = completeRow(p);
      out.push({ ...done, anyBrand: false });
    }
  }
  return out;
}

export interface Suggestion {
  key: string;
  name: string;
  emoji: string;
  amount: number;
  unit: Unit;
  /** The alias that matched, when it was not the name ("pyaz" for Onion). */
  matched: string | null;
}

/** Autocomplete over the dictionary: English and Hinglish, prefix first. */
export function suggest(query: string, limit = 8): Suggestion[] {
  const q = normalizeText(query);
  if (q.length < 2) return [];
  const qp = phonetic(q.replace(/ /g, ''));
  const scored: { s: Suggestion; score: number }[] = [];

  for (const item of ITEMS) {
    let best = 0;
    let matched: string | null = null;
    for (const form of itemForms(item)) {
      const f = normalizeText(form);
      let score = 0;
      if (f === q) score = 100;
      else if (f.startsWith(q)) score = 80 - Math.min(20, f.length - q.length);
      else if (f.split(' ').some((w) => w.startsWith(q))) score = 60;
      else if (phonetic(f.replace(/ /g, '')).startsWith(qp)) score = 50;
      else if (f.includes(q)) score = 30;
      if (form !== item.key && form !== item.name.toLowerCase()) score -= 5;
      if (score > best) {
        best = score;
        matched = form === item.key || form === item.name.toLowerCase() ? null : form;
      }
    }
    if (best > 0) {
      scored.push({
        s: { key: item.key, name: item.name, emoji: item.emoji, amount: item.amount, unit: item.unit, matched },
        score: best,
      });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || a.s.name.length - b.s.name.length)
    .slice(0, limit)
    .map((x) => x.s);
}
