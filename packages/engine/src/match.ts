/**
 * Is this listing the thing on the user's list?
 *
 * Three hard rules (spec, "Matching"): the same kind of product, every
 * required word present, and a pack size in a compatible unit. A wrong match
 * is worse than a missing one — it makes the dearer app look cheap — so a
 * listing that fails a soft rule becomes a "possible match" the user must
 * accept, and one that fails a hard rule is dropped.
 */
import { brandByName, findItem, isKindOf, ITEM_BY_KEY, type DictItem } from './dictionary';
import { parseQuantityText, parseRange, type ParsedPack } from './quantity';
import { findSequence, phonetic, tokenize } from './text';
import type { Listing, Match, ParsedRow } from './types';

/**
 * Words that turn a product into a different variant of itself. A listing
 * carrying one the user did not type is only a possible match.
 */
const VARIANT_WORDS = [
  'garlic', 'herb', 'herbs', 'peri', 'piri', 'chipotle', 'strawberry', 'vanilla', 'butterscotch', 'kesar',
  'rose', 'mint', 'pudina', 'flavoured', 'flavored', 'flavour', 'flavor', 'sugarfree', 'diet', 'lite', 'light',
  'unsalted', 'lactose', 'zero', 'mix', 'premix', 'frozen', 'roasted', 'smoked', 'chocolate', 'choco',
  'combo', 'gift', 'hamper', 'sampler', 'jeera', 'kids', 'protein', 'keto', 'sprouted', 'baby',
  'multigrain', 'multigrains', 'fibre', 'fiber', 'gluten',
];
const VARIANT_KEYS = new Map(VARIANT_WORDS.map((w) => [phonetic(w), w]));

/**
 * Kitchen tools and toys named after the food they are for ("Egg Separator",
 * "Nesting Eggs" toy) are never the food. Words a real pack can carry ("tray
 * of 30" eggs, a "5 L container" of oil) are deliberately not here.
 */
const TOOL_WORDS = [
  'compartment', 'nesting', 'toy', 'toys', 'boiler', 'beater', 'whisk', 'separator', 'slicer', 'peeler', 'grater',
  'cutter', 'mould', 'holder', 'organiser', 'organizer', 'dispenser', 'scoop', 'masher', 'chopper', 'squeezer', 'crusher',
];
const TOOL_KEYS = new Set(TOOL_WORDS.map(phonetic));

function containsForm(titleKeys: string[], form: string): boolean {
  const keys = tokenize(form).map(phonetic);
  return keys.length > 0 && findSequence(titleKeys, keys) >= 0;
}

/** All tokens of the form present anywhere — for "Rice Bran Health Oil". */
function containsAllTokens(titleKeys: string[], form: string): boolean {
  const keys = tokenize(form).map(phonetic);
  return keys.length > 0 && keys.every((k) => titleKeys.includes(k));
}

/** Pack size of a listing, in the row's base unit, or null when unknown / incompatible. */
function packQuantityFor(row: ParsedRow, item: DictItem | null, pack: ParsedPack | null): number | null {
  const want = row.quantity.dim;
  if (want === 'pack') return 1;
  if (!pack) return null;
  if (pack.dim === want) return pack.value;

  if (want === 'count') {
    if (pack.countRange) return pack.countRange[0];
    // A bar of soap, a cauliflower: one pack without a stated count is one piece.
    if (item?.discrete && (pack.dim === 'mass' || pack.dim === 'volume')) return 1;
    return null;
  }
  if (want === 'mass' && pack.dim === 'count' && pack.massRange) return pack.massRange[0] * pack.value;

  const density = item?.density;
  if (density) {
    if (want === 'mass' && pack.dim === 'volume') return Math.round(pack.value * density);
    if (want === 'volume' && pack.dim === 'mass') return Math.round(pack.value / density);
  }
  return null;
}

export function matchListing(row: ParsedRow, listing: Listing): Match | null {
  const titleKeys = tokenize(`${listing.title} ${listing.brand ?? ''}`).map(phonetic);
  const rowItem = row.itemKey ? (ITEM_BY_KEY[row.itemKey] ?? null) : null;
  const rowKeys = new Set(tokenize(row.text).map(phonetic));

  // 0. A tool or toy for the food, unless that is what was asked for.
  if (titleKeys.some((k) => TOOL_KEYS.has(k) && !rowKeys.has(k))) return null;

  // 1. Same kind of product.
  // Brackets usually hold a translation ("Spring Onion (Eerulli Soppu)"), which
  // must not decide the type; they only count when the rest names nothing.
  const outside = listing.title.replace(/\([^)]*\)/g, ' ');
  const listingType =
    findItem(tokenize(outside).map(phonetic))?.value ?? findItem(tokenize(listing.title).map(phonetic))?.value ?? null;
  if (rowItem) {
    if (listingType && !isKindOf(listingType.key, rowItem.key)) {
      // The title may name the row's item non-contiguously ("Rice Bran Health
      // Oil") while a more generic type ("oil") ends last.
      const generic = isKindOf(rowItem.key, listingType.key);
      if (!generic || !row.headForms.some((f) => containsAllTokens(titleKeys, f))) return null;
    }
    if (!listingType && !row.headForms.some((f) => containsForm(titleKeys, f))) return null;
  } else {
    if (!row.head || !titleKeys.includes(phonetic(row.head))) return null;
  }

  // 2. A locked brand must be the listing's brand.
  if (row.brandLocked && row.brand) {
    const forms = brandByName(row.brand)?.forms ?? [row.brand];
    const brandKeys = tokenize(listing.brand ?? '').map(phonetic);
    const ok = forms.some((f) => containsForm(brandKeys, f) || containsForm(titleKeys, f));
    if (!ok) return null;
  }

  // 3. Pack size in the row's unit.
  let pack = parseQuantityText(listing.quantityText);
  // "Onion (Approx. 900 g - 1000 g)" sold as "900 g": the title's range is the honest size.
  const range = parseRange(listing.title);
  if (range && pack && pack.dim === range.dim && Math.abs(pack.value - range.lo) < 0.5) {
    pack = { ...pack, value: (range.lo + range.hi) / 2 };
  }
  const packQuantity = packQuantityFor(row, rowItem, pack);

  // Soft rules: required words and unrequested variants.
  const missing = row.required.filter((w) => !titleKeys.includes(phonetic(w)));
  const variants = [...new Set(titleKeys.filter((k) => VARIANT_KEYS.has(k) && !rowKeys.has(k)))].map((k) => VARIANT_KEYS.get(k)!);
  // A variant word that is itself the row's product ("mint" for a mint row) is not a variant.
  const realVariants = variants.filter((v) => !row.headForms.some((f) => tokenize(f).map(phonetic).includes(phonetic(v))));

  let reason: string | null = null;
  if (missing.length) reason = `doesn’t say “${missing.join(' ')}”`;
  else if (realVariants.length) reason = `${realVariants.join(', ')} variant`;

  return {
    listing,
    packQuantity: packQuantity && packQuantity > 0 ? packQuantity : null,
    confidence: reason ? 'possible' : 'confident',
    reason: reason ?? (packQuantity ? null : pack ? 'sold in a different unit' : 'pack size unreadable'),
  };
}
