/**
 * Reading an app's official MCP answers as listings. Money is taken when its
 * unit is clear: UCP amounts are paise, Google-style money is units + nanos,
 * "₹54" is rupees, and a bare number is rupees (Swiggy documents rupees). The
 * comparison checks account prices against the other apps before using them,
 * so a unit mix-up (100×) is caught rather than trusted.
 */
import { parseQuantityText, PLATFORMS, type Listing } from '@gc/engine';

type Obj = Record<string, unknown>;

export interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: string; description?: string; items?: unknown }>; required?: string[] };
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const first = (o: Obj, keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '');

const NAME_KEYS = ['displayName', 'display_name', 'title', 'name', 'product_name', 'productName'];
const PRICE_KEYS = ['offerPrice', 'offer_price', 'discountedSellingPrice', 'sellingPrice', 'selling_price', 'finalPrice', 'final_price', 'price'];
const MRP_KEYS = ['mrp', 'MRP', 'list_price', 'listPrice', 'compare_at_price', 'originalPrice', 'original_price'];
const QTY_KEYS = ['quantityDescription', 'quantity_description', 'quantityText', 'quantity_text', 'packSize', 'packsize', 'pack_size', 'unitOfMeasure', 'weight', 'net_quantity', 'unit', 'size', 'quantity'];
const ID_KEYS = ['spinId', 'spin_id', 'variant_id', 'variantId', 'skuId', 'sku', 'id', 'productVariantId', 'productId', 'product_id'];
const STOCK_KEYS = ['isInStockAndAvailable', 'inStock', 'in_stock', 'isAvail', 'available', 'isAvailable', 'is_available'];

/** Rupees from a money value; null when there is none. */
/** Apps whose JSON money is plain paise (seen in Zepto's MCP answers: ×100 against every other app). */
const PAISE_APPS = new Set<Listing['platformId']>(['zepto']);

export function rupees(v: unknown, plainDivisor = 1): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round((v / plainDivisor) * 100) / 100 : null;
  if (typeof v === 'string') {
    const m = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/i.exec(v) ?? /^\s*([\d,]+(?:\.\d+)?)\s*$/.exec(v);
    const n = m ? Number(m[1]!.replace(/,/g, '')) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (!isObj(v)) return null;
  if (typeof v.amount === 'number' && (v.currency === undefined || v.currency === 'INR')) return v.amount / 100;
  if (v.units !== undefined && Number.isFinite(Number(v.units))) return Math.round((Number(v.units) + Number(v.nanos ?? 0) / 1e9) * 100) / 100;
  return null;
}

function priceOf(o: Obj, d: number): number | null {
  for (const k of PRICE_KEYS) {
    const v = o[k];
    const direct = rupees(v, d);
    if (direct !== null) return direct;
    if (isObj(v)) {
      const inner = rupees(first(v, ['offerPrice', 'offer_price', 'sellingPrice', 'selling_price', 'value']), d);
      if (inner !== null) return inner;
    }
  }
  return isObj(o.price_range) ? rupees(o.price_range.min, d) : null;
}

function mrpOf(o: Obj, d: number): number | null {
  for (const k of MRP_KEYS) {
    const r = rupees(o[k], d);
    if (r !== null) return r;
  }
  return isObj(o.price) ? rupees(first(o.price, ['mrp', 'MRP', 'list_price']), d) : null;
}

const QTY_RE = /(\d+(?:\.\d+)?\s*(?:x\s*\d+(?:\.\d+)?\s*)?(?:kg|g|gm|gms|grams?|ml|l|ltr|litres?|liters?|pcs?|pieces?|pack|units?)\b)/i;
const looksLikeSize = (s: string | null): s is string => !!s && /\d/.test(s) && /[a-z]/i.test(s) && parseQuantityText(s) !== null;

function quantityOf(objs: Obj[], title: string): string {
  for (const o of objs) {
    for (const k of QTY_KEYS) if (looksLikeSize(text(o[k]))) return text(o[k])!;
    for (const k of ['options', 'selected_options', 'selectedOptions']) {
      const opts = o[k];
      if (!Array.isArray(opts)) continue;
      for (const opt of opts) {
        const s = isObj(opt) ? text(first(opt, ['value', 'label', 'name'])) : text(opt);
        if (looksLikeSize(s)) return s;
      }
    }
  }
  return QTY_RE.exec(title)?.[1] ?? '';
}

/** Where an app keeps product photos given as bare paths (Zepto's CDN, as its own site loads them). */
const IMAGE_BASES: Partial<Record<Listing['platformId'], string>> = {
  zepto: 'https://cdn.zeptonow.com/production/tr:w-400,ar-1-1,pr-true,f-auto,q-80/',
};

function imageOf(o: Obj, platformId?: Listing['platformId']): string | null {
  const base = platformId ? IMAGE_BASES[platformId] : undefined;
  const absolute = (s: string | null) => (!s ? null : /^https?:\/\//.test(s) ? s : base && /\.(?:jpe?g|png|webp|avif)$|^cms\//i.test(s) ? `${base}${s.replace(/^\/+/, '')}` : null);
  const direct = absolute(text(first(o, ['imageUrl', 'image_url', 'image', 'thumbnail', 'imagePath'])));
  if (direct) return direct;
  for (const k of ['media', 'images']) {
    const list = o[k];
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      const url = absolute(isObj(m) ? text(first(m, ['url', 'src', 'image_url', 'path'])) : text(m));
      if (url) return url;
    }
  }
  return null;
}

function inStockOf(o: Obj): boolean | null {
  if (isObj(o.availability) && typeof o.availability.available === 'boolean') return o.availability.available;
  for (const k of STOCK_KEYS) if (typeof o[k] === 'boolean') return o[k] as boolean;
  if (isObj(o.inventory) && typeof o.inventory.inStock === 'boolean') return o.inventory.inStock;
  return null;
}

/** Product objects anywhere in an answer, each with its variants (or itself). */
function productsIn(data: unknown, depth = 0): { product: Obj; variant: Obj | null }[] {
  if (depth > 7) return [];
  if (Array.isArray(data)) return data.flatMap((d) => productsIn(d, depth + 1));
  if (!isObj(data)) return [];
  const variants = first(data, ['variations', 'variants']);
  if (text(first(data, NAME_KEYS)) && Array.isArray(variants) && variants.some(isObj)) {
    return variants.filter(isObj).map((variant) => ({ product: data, variant }));
  }
  if (text(first(data, NAME_KEYS)) && priceOf(data, 1) !== null) return [{ product: data, variant: null }];
  return Object.values(data).flatMap((v) => productsIn(v, depth + 1));
}

/** JSON a text answer carries inside prose: fenced blocks, else its outermost {…} or […]. */
function embeddedJson(text: string): unknown[] {
  const found: unknown[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    try {
      found.push(JSON.parse(m[1]!));
    } catch {
      // not JSON after all
    }
  }
  if (found.length) return found;
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = text.indexOf(open);
    const b = text.lastIndexOf(close);
    if (a < 0 || b <= a) continue;
    try {
      return [JSON.parse(text.slice(a, b + 1))];
    } catch {
      // keep looking
    }
  }
  return [];
}

/** The JSON inside an answer: structured content, JSON sent as text, or JSON inside prose. Prose also stays as a string. */
export function dataOf(result: ToolResult): unknown[] {
  const out: unknown[] = [];
  if (result.structuredContent !== undefined) out.push(result.structuredContent);
  for (const c of result.content ?? []) {
    if (c.type !== 'text' || !c.text) continue;
    try {
      out.push(JSON.parse(c.text));
    } catch {
      const inner = embeddedJson(c.text);
      out.push(...inner);
      if (!inner.length) out.push(c.text);
    }
  }
  return out;
}

/** "1. Amul Butter 100 g — ₹58 (MRP ₹60) [id: 123]" style lines, for answers written for a chat assistant. */
function proseListings(platformId: Listing['platformId'], prose: string, now: string): Listing[] {
  const out: Listing[] = [];
  for (const raw of prose.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim();
    const price = /(?:₹|rs\.?\s?)\s*([\d,]+(?:\.\d+)?)/i.exec(line);
    if (!price || price.index < 3) continue;
    const title = line.slice(0, price.index).replace(/[-–—:|,(\s]+$/, '').trim();
    if (!/[a-z]/i.test(title)) continue;
    const mrp = /mrp\s*:?\s*(?:₹|rs\.?\s?)\s*([\d,]+(?:\.\d+)?)/i.exec(line);
    const id = /\b(?:id|sku|product ?id|variant ?id)\s*[:=#]\s*([\w-]{3,})/i.exec(line);
    const value = Number(price[1]!.replace(/,/g, ''));
    const mrpValue = mrp ? Number(mrp[1]!.replace(/,/g, '')) : null;
    out.push({
      platformId,
      listingId: (id?.[1] ?? `${title}|${value}`).slice(0, 128),
      title: title.slice(0, 300),
      brand: null,
      quantityText: QTY_RE.exec(line)?.[1] ?? '',
      price: value,
      mrp: mrpValue && mrpValue >= value ? mrpValue : null,
      inStock: !/out of stock|unavailable|sold out/i.test(line),
      productUrl: PLATFORMS[platformId].homepage,
      imageUrl: null,
      category: null,
      fetchedAt: now,
    });
  }
  return out;
}

export function toListings(platformId: Listing['platformId'], result: ToolResult, now = new Date().toISOString()): Listing[] {
  if (result.isError) return [];
  const d = PAISE_APPS.has(platformId) ? 100 : 1;
  const out: Listing[] = [];
  const seen = new Set<string>();
  const parts = dataOf(result);
  for (const { product, variant } of parts.flatMap((p) => (typeof p === 'string' ? [] : productsIn(p)))) {
    const v = variant ?? product;
    const name = text(first(product, NAME_KEYS))!;
    const variantName = variant ? text(first(variant, NAME_KEYS)) : null;
    // A variant's own name is usually the full product name (Swiggy); a bare size (UCP) is appended.
    const title =
      variantName && !/^default/i.test(variantName)
        ? /^\d/.test(variantName) || looksLikeSize(variantName) && variantName.length < 16
          ? `${name} ${variantName}`
          : variantName
        : name;
    const price = priceOf(v, d) ?? priceOf(product, d);
    if (!price) continue;
    const mrp = mrpOf(v, d) ?? mrpOf(product, d);
    // Instamart's cart needs both ids of a variation, so they travel together as the listing id.
    const spin = text(v.spinId);
    const sku = text(v.skuId);
    const listingId = spin && sku ? `${spin}~${sku}` : (text(first(v, ID_KEYS)) ?? text(first(product, ID_KEYS)) ?? `${title}|${price}`);
    if (seen.has(listingId)) continue;
    seen.add(listingId);
    out.push({
      platformId,
      listingId: listingId.slice(0, 128),
      title: title.slice(0, 300),
      brand: (text(first(product, ['brand', 'brandName', 'brand_name'])) ?? text(first(v, ['brandName', 'brand', 'brand_name'])))?.slice(0, 120) ?? null,
      quantityText: quantityOf(variant ? [variant, product] : [product], title).slice(0, 80),
      price,
      mrp: mrp && mrp >= price ? mrp : null,
      inStock: inStockOf(v) ?? inStockOf(product) ?? true,
      productUrl: (text(first(v, ['url', 'product_url', 'productUrl'])) ?? text(first(product, ['url', 'product_url', 'productUrl'])) ?? productPage(platformId, product, v, title) ?? PLATFORMS[platformId].homepage).slice(0, 1000),
      imageUrl: (imageOf(v, platformId) ?? imageOf(product, platformId))?.slice(0, 1000) ?? null,
      category: null,
      fetchedAt: now,
    });
  }
  if (out.length === 0) for (const p of parts) if (typeof p === 'string') out.push(...proseListings(platformId, p, now));
  return out.slice(0, 40);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';

/** The app's own product page (one tap to add there), built the way the apps build theirs. */
function productPage(platformId: Listing['platformId'], product: Obj, v: Obj, title: string): string | null {
  if (platformId === 'instamart') {
    const id = text(first(product, ['productId', 'product_id'])) ?? text(first(v, ['productId', 'product_id']));
    return id ? `https://www.swiggy.com/instamart/item/${encodeURIComponent(id)}` : null;
  }
  if (platformId === 'zepto') {
    const pv = text(first(v, ['productVariantId', 'variantId', 'pvid'])) ?? (isObj(v.productVariant) ? text(v.productVariant.id) : null);
    return pv ? `https://www.zepto.com/pn/${slug(title)}/pvid/${encodeURIComponent(pv)}` : null;
  }
  return null;
}

/** What is in a cart answer: each variation's ids and quantity; null when items are there but unreadable. */
export function cartItemsIn(result: ToolResult): { spinId: string; skuId: string | null; quantity: number }[] | null {
  const items: { spinId: string; skuId: string | null; quantity: number }[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (isObj(v)) {
      const spinId = text(v.spinId);
      const quantity = Number(first(v, ['quantity', 'qty', 'count']));
      if (spinId && Number.isFinite(quantity) && quantity > 0) items.push({ spinId, skuId: text(v.skuId), quantity });
      else Object.values(v).forEach((x) => walk(x, depth + 1));
    }
  };
  const parts = dataOf(result);
  parts.forEach((p) => typeof p !== 'string' && walk(p, 0));
  // Words saying there are items, with none readable: better to leave the cart alone.
  const mentionsItems = parts.some((p) => (typeof p === 'string' ? p : JSON.stringify(p)).match(/"?(?:items|cartItems|lineItems)"?\s*[:=]\s*\[\s*\{/));
  return items.length === 0 && mentionsItems ? null : items;
}

/** Saved addresses in an answer: id plus whatever text describes it (never logged). */
export function addressesIn(result: ToolResult): { id: string; text: string }[] {
  const found: { id: string; text: string }[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (isObj(v)) {
      const id = text(first(v, ['id', 'addressId', 'address_id', 'userAddressId']));
      const words = Object.values(v).filter((x) => typeof x === 'string' || typeof x === 'number').join(' ');
      if (id && /\d{6}|[a-z]{4,}/i.test(words) && Object.keys(v).length >= 2) found.push({ id, text: words });
      else Object.values(v).forEach((x) => walk(x, depth + 1));
    }
  };
  for (const part of dataOf(result)) {
    if (typeof part === 'string') {
      // "1. Home — 12, 5th Cross, Koramangala 560034 (id: abc123)"
      for (const line of part.split(/\r?\n/)) {
        const id = /\b(?:id|address ?id)\s*[:=#]\s*([\w-]{3,})/i.exec(line);
        if (id) found.push({ id: id[1]!, text: line });
      }
    } else walk(part, 0);
  }
  return found;
}

/**
 * The address for the delivery place: one that mentions its pincode, else the
 * one sharing most words with its area/city label ("Kothrud, Pune"), else the
 * account's first.
 */
export function pickAddress(addresses: { id: string; text: string }[], pincode: string, label?: string): { id: string; matched: boolean } | null {
  const hit = addresses.find((a) => a.text.includes(pincode));
  if (hit) return { id: hit.id, matched: true };
  const words = (label ?? '').toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 4);
  const scored = addresses
    .map((a) => ({ a, n: words.filter((w) => a.text.toLowerCase().includes(w)).length }))
    .sort((x, y) => y.n - x.n)[0];
  if (scored && scored.n > 0) return { id: scored.a.id, matched: true };
  return addresses[0] ? { id: addresses[0].id, matched: false } : null;
}

/** Argument values for a tool, filled from its input schema. */
export function argsFor(tool: ToolInfo, known: { query?: string; queries?: string[]; addressId?: string; orderId?: string }): Record<string, unknown> {
  const props = tool.inputSchema?.properties ?? {};
  const args: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(props)) {
    const k = key.toLowerCase();
    if (known.queries && schema.type === 'array' && /quer|search|term|item|product|name/.test(k)) args[key] = known.queries;
    else if (known.query !== undefined && schema.type !== 'array' && /^(query|q|search_?query|searchterm|keyword|term|text|search)$/.test(k)) args[key] = known.query;
    else if (known.addressId && /address_?id|^id$/.test(k)) args[key] = known.addressId;
    else if (known.orderId && /order_?(id|code|number)|^id$/.test(k)) args[key] = known.orderId;
  }
  if (known.query !== undefined && !Object.values(args).includes(known.query) && !known.queries) args.query = known.query;
  return args;
}

const FEE_KEY = /fee|charge|delivery|handling|small.?cart|surge|platform|packag|tip|total|to.?pay|amount|discount|saving|free|above|below|minimum|threshold/i;
const PRIVATE_KEY = /address|phone|mobile|email|name|landmark|street|flat|house|lat|lng|lon|pincode|contact|location|coordinates/i;

/**
 * An answer as bill text for parseBillText: its prose as written, and its
 * JSON as "field: value" lines. Zepto's JSON money is in paise (a ₹25 fee is
 * 2500): no grocery fee reaches ₹500, so fee-like fields above that mean paise,
 * and then every money field in that answer is.
 */
export function answerText(result: ToolResult, platformId?: Listing['platformId']): string {
  const lines: string[] = [];
  const pairs: [string, number | string][] = [];
  const walk = (v: unknown, key: string, depth: number) => {
    if (depth > 8 || PRIVATE_KEY.test(key)) return;
    if (Array.isArray(v)) v.forEach((x) => walk(x, key, depth + 1));
    else if (isObj(v)) {
      // A bill line as {label: "Delivery fee", value: 30} (or name/title + amount/price).
      const label = text(first(v, ['label', 'name', 'title', 'displayName', 'type', 'key']));
      const amount = first(v, ['value', 'amount', 'price', 'finalValue', 'displayValue', 'charge', 'fee']);
      if (label && amount !== undefined && FEE_KEY.test(label) && (typeof amount === 'number' || typeof amount === 'string' || isObj(amount))) {
        const money = isObj(amount) ? rupees(amount) : amount;
        if (money !== null) pairs.push([label, money as number | string]);
        return;
      }
      const money = rupees(v);
      if (money !== null && FEE_KEY.test(key)) pairs.push([key, money]);
      else for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
    } else if ((typeof v === 'number' || typeof v === 'string') && FEE_KEY.test(key)) pairs.push([key, v]);
    // A message about fees ("Add ₹54 more for free delivery") counts whatever its field is called.
    else if (typeof v === 'string' && /free delivery|delivery (?:fee|charge)|handling|small cart|more for free/i.test(v)) lines.push(v.slice(0, 200));
  };
  for (const part of dataOf(result)) {
    if (typeof part === 'string') lines.push(part);
    else walk(part, '', 0);
  }
  const feeValues = pairs.filter(([k, v]) => typeof v === 'number' && /fee|charge/i.test(k)).map(([, v]) => v as number);
  const paise = (platformId !== undefined && PAISE_APPS.has(platformId)) || feeValues.some((v) => v > 500);
  for (const [k, v] of pairs) {
    const words = k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
    lines.push(`${words} ${typeof v === 'number' ? `₹${paise ? v / 100 : v}` : v}`);
  }
  return lines.join('\n');
}

/** Order ids in an order-history answer, newest first as listed. */
export function orderIdsIn(result: ToolResult): string[] {
  const ids: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (isObj(v)) {
      const id = text(first(v, ['orderId', 'order_id', 'orderCode', 'order_code', 'orderNumber', 'id']));
      if (id && Object.keys(v).some((k) => /status|total|amount|placed|date|time/i.test(k))) ids.push(id);
      else Object.values(v).forEach((x) => walk(x, depth + 1));
    }
  };
  for (const part of dataOf(result)) {
    if (typeof part === 'string') {
      for (const m of part.matchAll(/\border\s*(?:id|code|no\.?|number|#)\s*[:=#]?\s*([A-Z0-9][\w-]{4,})/gi)) ids.push(m[1]!);
    } else walk(part, 0);
  }
  return [...new Set(ids)];
}
