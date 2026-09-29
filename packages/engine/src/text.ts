/**
 * Text normalisation shared by row parsing and matching.
 *
 * Indian grocery names arrive in many spellings — "masoori"/"masuri",
 * "jeera"/"zeera", "aashirvaad"/"ashirwad", "chilli"/"chillies". `phonetic`
 * folds a word to a key so those spellings compare equal. It is only ever
 * used for comparison, never shown to anyone.
 */

export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(' ') : [];
}

export function singular(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}i`;
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (w.endsWith('ss')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

export function phonetic(word: string): string {
  let w = singular(word.toLowerCase());
  if (/^\d+$/.test(w)) return w;
  w = w
    .replace(/ch/g, 'x')
    .replace(/ph/g, 'f')
    .replace(/sh/g, 's')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/th/g, 't')
    .replace(/dh/g, 'd')
    .replace(/bh/g, 'b')
    .replace(/jh/g, 'j')
    .replace(/ck/g, 'k')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/q/g, 'k')
    .replace(/iya/g, 'ia')
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'i')
    .replace(/ii/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/uu/g, 'u')
    .replace(/(.)\1+/g, '$1')
    .replace(/y$/, 'i');
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export function phoneticTokens(s: string): string[] {
  return tokenize(s).map(phonetic);
}

/** Words that carry no product meaning in a shopping list. */
export const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'for', 'with', 'in', 'to', 'some', 'any', 'my', 'me', 'get', 'buy', 'need',
  'ka', 'ki', 'ke', 'aur',
]);

/** Descriptors a shopper adds that should not narrow the match. */
export const SOFT_WORDS = new Set([
  'fresh', 'pure', 'best', 'good', 'quality', 'local', 'desi', 'regular', 'normal', 'loose', 'brand', 'branded',
  'packet', 'pack', 'packs', 'bottle', 'jar', 'pouch', 'box', 'big', 'small', 'medium', 'large', 'cheap', 'cheapest',
  'daily', 'everyday', 'kitchen', 'home', 'item', 'items', 'new',
]);

/** Positions of a token sequence inside another, compared phonetically. */
export function findSequence(haystack: string[], needle: string[], from = 0): number {
  outer: for (let i = from; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
