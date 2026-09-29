/**
 * Searching on a shopper's own signed-in account, for one comparison. The
 * access token arrives with the request and is used only while it runs —
 * never stored or logged, like everything else about the shopper.
 *
 * Both apps keep state per MCP session, so every call of one comparison
 * shares a session: pick the saved address that matches the delivery
 * pincode, then search.
 *   Zepto:     list_saved_addresses → select_saved_address → search_products
 *   Instamart: get_addresses → search_products { addressId, query }
 */
import { createHash } from 'node:crypto';
import { parseBillText, type BillReading, type FeeHints, type GeoLocation, type Listing, type MembershipId } from '@gc/engine';
import { ACCOUNT_PROVIDERS, type AccountPlatform } from '@/lib/account/providers';
import { addressesIn, answerText, argsFor, cartItemsIn, orderIdsIn, pickAddress, toListings, type ToolInfo, type ToolResult } from '@/lib/account/parse';

const PROTOCOL = '2025-06-18';
const CONCURRENCY = 2;

export class AccountError extends Error {
  constructor(
    message: string,
    readonly kind: 'signed_out' | 'rate_limited' | 'unsupported' | 'no_address' | 'failed',
  ) {
    super(message);
  }
}

class Mcp {
  private session: string | null = null;
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly signal: AbortSignal,
  ) {}

  private async post(message: object): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL,
    };
    if (this.session) headers['mcp-session-id'] = this.session;
    const res = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(message), signal: this.signal });
    if (res.status === 401 || res.status === 403) throw new AccountError('signed out', 'signed_out');
    if (res.status === 429) throw new AccountError('the app asked us to slow down', 'rate_limited');
    this.session = res.headers.get('mcp-session-id') ?? this.session;
    return res;
  }

  async request<T>(method: string, params: object): Promise<T> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: '2.0', id, method, params });
    if (!res.ok) throw new AccountError(`${method}: HTTP ${res.status}`, 'failed');
    const type = res.headers.get('content-type') ?? '';
    let msg: { id?: number; result?: unknown; error?: { message?: string } } | undefined;
    if (type.includes('text/event-stream')) {
      for (const block of (await res.text()).split(/\r?\n\r?\n/)) {
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        try {
          const parsed = JSON.parse(data) as typeof msg;
          if (parsed?.id === id) msg = parsed;
        } catch {
          // keep-alive or comment
        }
      }
    } else {
      msg = (await res.json()) as typeof msg;
    }
    if (!msg) throw new AccountError(`${method}: no answer`, 'failed');
    if (msg.error) throw new AccountError(`${method}: ${msg.error.message ?? 'error'}`, 'failed');
    return msg.result as T;
  }

  async start(): Promise<ToolInfo[]> {
    await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'jhola', version: '0.1' } });
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => undefined);
    return (await this.request<{ tools?: ToolInfo[] }>('tools/list', {})).tools ?? [];
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.request<ToolResult>('tools/call', { name, arguments: args });
    const words = (result.content ?? []).map((c) => c.text ?? '').join(' ');
    if (/too many requests|rate limit|slow down/i.test(words)) throw new AccountError('the app asked us to slow down', 'rate_limited');
    if (result.isError && /sign ?in|log ?in|unauthori[sz]ed|expired/i.test(words)) throw new AccountError('signed out', 'signed_out');
    return result;
  }
}

export interface AccountFees {
  /** Fee facts from the shopper's own account, applied like the apps' live hints. */
  hints: FeeHints;
  memberships: MembershipId[];
  /** Shopper-safe: where the fees were read ("your last order"), never its contents. */
  source: string | null;
}

export interface AccountSearch {
  listings: Record<string, Listing[]>;
  /** Short, shopper-safe account notes (no address text). */
  note: string;
  fees: AccountFees;
}

const dev = process.env.NODE_ENV !== 'production';
function log(platformId: AccountPlatform, message: string) {
  if (dev) console.log(`[account:${platformId}] ${message}`);
}

const MEMBERSHIP_WORDS: [RegExp, MembershipId][] = [
  [/zepto\s*(?:pass|club|super\s*saver\s*pass)|\bpass\s+(?:member|active|benefit|applied)/i, 'zepto_club'],
  [/swiggy\s*one/i, 'swiggy_one'],
];
const FEES_TTL_MS = 30 * 60 * 1000;
// Per sign-in (a hash of the token, never the token), for half an hour: no database.
const feesCache = new Map<string, { at: number; fees: AccountFees }>();

/** Bill facts to fee hints: what a past bill says about fees that still apply (not a one-off surge or late-night charge). */
function hintsFrom(r: BillReading): FeeHints {
  const h: FeeHints = {};
  if (r.deliveryFee && r.deliveryFee > 0 && !r.deliveryFree) h.deliveryFee = r.deliveryFee;
  if (r.freeDeliveryAbove) h.freeDeliveryAbove = r.freeDeliveryAbove;
  if (r.handlingFee !== undefined) h.handlingFee = r.handlingFee;
  if (r.smallCartFee !== undefined) h.smallCartFee = r.smallCartFee;
  if (r.smallCartBelow) h.smallCartBelow = r.smallCartBelow;
  if (r.packagingFee !== undefined) h.packagingFee = r.packagingFee;
  if (r.platformFee !== undefined) h.platformFee = r.platformFee;
  return h;
}

/** Only fee-looking lines, never addresses or names: for the development log. */
function feeLines(text: string): string {
  return text
    .split('\n')
    .filter((l) => /fee|charge|delivery|handling|small|surge|total|pass|club|one|member|free|above/i.test(l) && !/address|phone|mobile|name|flat|street|road|landmark/i.test(l))
    .map((l) => l.trim().slice(0, 90))
    .slice(0, 12)
    .join(' | ');
}

/**
 * The shopper's own fees, read (never written) from their account: the
 * store's current rules, the live cart's bill (Instamart's cart is the
 * account's own; Zepto's MCP cart is not), the latest orders' bills, and any
 * membership they mention. Newer and more specific sources win field by field.
 */
async function readAccountFees(mcp: Mcp, tools: ToolInfo[], platformId: AccountPlatform, cacheKey: string): Promise<AccountFees> {
  const hit = feesCache.get(cacheKey);
  if (hit && Date.now() - hit.at < FEES_TTL_MS) return hit.fees;
  const tool = (name: string) => tools.find((t) => t.name === name);
  const read = async (name: string, args: Record<string, unknown> = {}) => {
    const t = tool(name);
    if (!t) return '';
    try {
      return answerText(await mcp.call(t.name, args), platformId);
    } catch {
      return '';
    }
  };

  const sources: { text: string; source: string }[] = [];
  if (platformId === 'instamart') sources.push({ text: await read('get_cart'), source: 'your cart' });
  const history = tool('list_order_history') ?? tool('get_orders');
  if (history) {
    try {
      const list = await mcp.call(history.name, argsFor(history, {}));
      const detail = tool('get_order_detail') ?? tool('get_order_details');
      const ids = orderIdsIn(list).slice(0, 3);
      if (detail && ids.length) {
        for (const id of ids) sources.push({ text: await read(detail.name, argsFor(detail, { orderId: id })), source: 'your last orders' });
      } else {
        sources.push({ text: answerText(list, platformId), source: 'your last orders' });
      }
    } catch {
      // No order history to read: fine, other sources may speak.
    }
  }
  sources.push({ text: await read('get_location_serviceability'), source: 'your store' });
  const profile = await read('get_user_details');

  const hints: FeeHints = {};
  const used: string[] = [];
  for (const { text, source } of sources) {
    if (!text) continue;
    const found = hintsFrom(parseBillText(text));
    let added = false;
    for (const [k, v] of Object.entries(found) as [keyof FeeHints, number][]) {
      if (hints[k] === undefined) {
        hints[k] = v;
        added = true;
      }
    }
    if (added && !used.includes(source)) used.push(source);
    if (dev && text) log(platformId, `fee text from ${source}: ${feeLines(text) || '(no fee lines)'}`);
  }
  const all = [profile, ...sources.map((s) => s.text)].join('\n');
  const memberships = MEMBERSHIP_WORDS.filter(([re]) => re.test(all)).map(([, id]) => id);
  const fees: AccountFees = { hints, memberships, source: used.length ? used.join(' & ') : null };
  log(platformId, `fees: ${JSON.stringify(hints)} memberships: ${memberships.join(',') || 'none'} from ${fees.source ?? 'nothing readable'}`);
  feesCache.set(cacheKey, { at: Date.now(), fees });
  return fees;
}

// Forget stale sign-ins so the map stays small.
setInterval(() => {
  for (const [k, v] of feesCache) if (Date.now() - v.at > FEES_TTL_MS) feesCache.delete(k);
}, FEES_TTL_MS).unref?.();

/** Searches every query on the shopper's own account. Throws AccountError when the account can't be used. */
export async function searchAccount(
  platformId: AccountPlatform,
  token: string,
  queries: { itemId: string; text: string }[],
  location: GeoLocation,
  signal: AbortSignal,
  onProgress: () => void,
): Promise<AccountSearch> {
  const mcp = new Mcp(ACCOUNT_PROVIDERS[platformId].mcpUrl, token, signal);
  const tools = await mcp.start();
  const tool = (name: string) => tools.find((t) => t.name === name);
  log(platformId, `tools: ${tools.map((t) => t.name).join(', ')}`);

  const search = tool('search_products') ?? tool('search_catalog') ?? tools.find((t) => /^search/.test(t.name) && !/multiple/.test(t.name));
  if (!search) throw new AccountError('no search tool', 'unsupported');

  // The saved address for this pincode sets the store (and so the prices).
  const listTool = tool('list_saved_addresses') ?? tool('get_addresses');
  let addressId: string | undefined;
  let matched = false;
  if (listTool) {
    const picked = pickAddress(addressesIn(await mcp.call(listTool.name, {})), location.pincode, location.label);
    if (!picked) throw new AccountError('no saved address in the app', 'no_address');
    addressId = picked.id;
    matched = picked.matched;
    const select = tool('select_saved_address');
    if (select) {
      const selected = await mcp.call(select.name, argsFor(select, { addressId }));
      if (selected.isError) throw new AccountError('the app refused the saved address', 'no_address');
    }
    log(platformId, `address: ${matched ? 'matches the delivery place' : 'first saved (none matches the delivery place)'}`);
  }

  // Fees are read alongside the searches, in the same session (so at the selected address).
  const cacheKey = createHash('sha256').update(`${platformId}:${token}`).digest('hex');
  const feesReading = readAccountFees(mcp, tools, platformId, cacheKey).catch((): AccountFees => ({ hints: {}, memberships: [], source: null }));

  const listings: Record<string, Listing[]> = {};
  let next = 0;
  let found = 0;
  let firstRaw: string | null = null;
  const worker = async () => {
    while (next < queries.length && !signal.aborted) {
      const q = queries[next++]!;
      const result = await mcp.call(search.name, argsFor(search, { query: q.text, addressId }));
      firstRaw ??= JSON.stringify(result).slice(0, 600);
      listings[q.itemId] = toListings(platformId, result);
      if (listings[q.itemId]!.length) found++;
      onProgress();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(platformId, `searched ${queries.length}: ${found} with products`);
  if (found === 0) {
    if (dev && firstRaw) log(platformId, `sample answer (unreadable): ${firstRaw}`);
    // An all-empty answer is how a throttled account looks too, so it must not read as "out of stock".
    throw new AccountError('no products came back', 'failed');
  }
  return { listings, note: matched ? 'your saved address' : 'your first saved address', fees: await feesReading };
}

/**
 * The shopper's first name from their own account, for a greeting. Zepto
 * answers get_user_details; apps without such a tool give null.
 */
export async function profileName(platformId: AccountPlatform, token: string, signal: AbortSignal): Promise<string | null> {
  const mcp = new Mcp(ACCOUNT_PROVIDERS[platformId].mcpUrl, token, signal);
  const tools = await mcp.start();
  const tool = tools.find((t) => t.name === 'get_user_details') ?? tools.find((t) => /^(get_)?(user|profile|account)(_details|_info|_profile)?$/.test(t.name));
  if (!tool) return null;
  const result = await mcp.call(tool.name, {});
  const pick = (v: unknown, depth = 0): string | null => {
    if (depth > 5 || v === null || typeof v !== 'object') return null;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === 'string' && /^(first_?name|firstName|name|full_?name|fullName|user_?name|userName)$/.test(k)) return x;
    }
    for (const x of Object.values(v as Record<string, unknown>)) {
      const found = pick(x, depth + 1);
      if (found) return found;
    }
    return null;
  };
  let name = pick(result.structuredContent);
  for (const c of result.content ?? []) {
    if (name || !c.text) break;
    try {
      name = pick(JSON.parse(c.text));
    } catch {
      name = /\bname\s*[:=]\s*([^\n,|;]+)/i.exec(c.text)?.[1]?.trim() ?? null;
    }
  }
  const first = name?.replace(/[^\p{L}\s'.-]/gu, '').trim().split(/\s+/)[0];
  if (!first || first.length < 2 || /^(user|customer|guest|null|undefined)$/i.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** For the /connect check page: the tools, which address was used, and one search raw and read. */
export async function checkAccount(platformId: AccountPlatform, token: string, query: string, pincode: string, signal: AbortSignal) {
  const mcp = new Mcp(ACCOUNT_PROVIDERS[platformId].mcpUrl, token, signal);
  const tools = await mcp.start();
  const listTool = tools.find((t) => t.name === 'list_saved_addresses' || t.name === 'get_addresses');
  let address: 'matched' | 'first' | 'none' | 'not needed' = 'not needed';
  let addressId: string | undefined;
  if (listTool) {
    const picked = pickAddress(addressesIn(await mcp.call(listTool.name, {})), pincode);
    address = picked ? (picked.matched ? 'matched' : 'first') : 'none';
    addressId = picked?.id;
    const select = tools.find((t) => t.name === 'select_saved_address');
    if (select && addressId) await mcp.call(select.name, argsFor(select, { addressId }));
  }
  const search = tools.find((t) => t.name === 'search_products') ?? tools.find((t) => t.name === 'search_catalog') ?? tools.find((t) => /^search/.test(t.name));
  const result = search ? await mcp.call(search.name, argsFor(search, { query, addressId })) : null;
  return {
    tools: tools.map((t) => ({ name: t.name, params: Object.keys(t.inputSchema?.properties ?? {}), description: t.description?.slice(0, 160) ?? '' })),
    address,
    search: search?.name ?? null,
    raw: result ? JSON.stringify(result, null, 2).slice(0, 6000) : null,
    listings: result ? toListings(platformId, result) : [],
  };
}


/**
 * Puts the plan's items into the shopper's own Instamart cart, keeping what is
 * already there: the app's update_cart replaces the whole cart, so the current
 * one is read first and merged (the larger quantity wins). When the current
 * cart can't be read, nothing is changed. Zepto is not offered: its MCP cart
 * never reaches the shopper's app (zeptonow/mcp#62).
 */
export async function addToAccountCart(
  platformId: AccountPlatform,
  token: string,
  location: GeoLocation,
  items: { listingId: string; quantity: number }[],
  signal: AbortSignal,
): Promise<{ added: number; unavailable: number; note: string }> {
  if (platformId !== 'instamart') throw new AccountError('this app has no cart for other apps', 'unsupported');
  const mcp = new Mcp(ACCOUNT_PROVIDERS[platformId].mcpUrl, token, signal);
  const tools = await mcp.start();
  const tool = (name: string) => tools.find((t) => t.name === name);
  const list = tool('get_addresses');
  const getCart = tool('get_cart');
  const update = tool('update_cart');
  if (!list || !getCart || !update) throw new AccountError('cart tools missing', 'unsupported');

  const picked = pickAddress(addressesIn(await mcp.call(list.name, {})), location.pincode, location.label);
  if (!picked) throw new AccountError('no saved address in the app', 'no_address');

  const current = cartItemsIn(await mcp.call(getCart.name, argsFor(getCart, { addressId: picked.id })));
  if (current === null) throw new AccountError('your cart could not be read, so it was left as it is', 'failed');

  const merged = new Map<string, { spinId: string; skuId: string | null; quantity: number }>();
  for (const c of current) merged.set(c.spinId, c);
  for (const it of items) {
    const [spinId, skuId = null] = it.listingId.split('~');
    if (!spinId) continue;
    const prev = merged.get(spinId);
    merged.set(spinId, { spinId, skuId: skuId ?? prev?.skuId ?? null, quantity: Math.max(prev?.quantity ?? 0, it.quantity) });
  }

  const props = update.inputSchema?.properties ?? {};
  const addressKey = Object.keys(props).find((k) => /address_?id/i.test(k)) ?? 'selectedAddressId';
  const result = await mcp.call(update.name, {
    [addressKey]: picked.id,
    items: [...merged.values()].map(({ spinId, skuId, quantity }) => ({ spinId, ...(skuId ? { skuId } : {}), quantity })),
  });
  if (result.isError) throw new AccountError('the app refused the cart', 'failed');
  const answer = JSON.stringify(dataOfResult(result));
  const unavailable = (answer.match(/removedOutOfStockItems"\s*:\s*\[([^\]]*)\]/)?.[1]?.match(/\{/g) ?? []).length;
  log(platformId, `cart: ${items.length} added (${merged.size} in cart), ${unavailable} unavailable`);
  return { added: items.length - unavailable, unavailable, note: picked.matched ? 'your saved address' : 'your first saved address' };
}

function dataOfResult(result: ToolResult): unknown {
  return result.structuredContent ?? (result.content ?? []).map((c) => c.text ?? '').join('\n');
}
