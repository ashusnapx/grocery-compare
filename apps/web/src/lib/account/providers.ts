/**
 * Apps whose official MCP servers let a shopper sign in from another app.
 * Zepto answers browsers directly (CORS); Swiggy does not, so its calls go
 * through /api/account/relay, which forwards to these fixed endpoints only
 * and keeps nothing. Tokens live in the shopper's browser.
 */
export type AccountPlatform = 'zepto' | 'instamart';
export type ProviderTarget = 'register' | 'token' | 'mcp';

export interface AccountProvider {
  platformId: AccountPlatform;
  name: string;
  issuer: string;
  authorize: string;
  token: string;
  register: string;
  /** RFC 8707 resource indicator, when the server declares one. */
  resource: string | null;
  mcpUrl: string;
  scopes: string[];
  /** Asked for instead when the preferred scopes are refused. */
  fallbackScopes: string[];
  direct: boolean;
}

export const ACCOUNT_PROVIDERS: Record<AccountPlatform, AccountProvider> = {
  zepto: {
    platformId: 'zepto',
    name: 'Zepto',
    issuer: 'https://auth.zepto.co.in',
    authorize: 'https://auth.zepto.co.in/authorize',
    token: 'https://auth.zepto.co.in/token',
    register: 'https://auth.zepto.co.in/register',
    resource: 'https://mcp.zepto.co.in',
    mcpUrl: 'https://mcp.zepto.co.in/mcp',
    // Read-only: catalog search. No cart, checkout or order rights.
    scopes: ['tools:read', 'dev.ucp.shopping.catalog.search:read'],
    fallbackScopes: ['tools:read'],
    direct: true,
  },
  instamart: {
    platformId: 'instamart',
    name: 'Instamart',
    issuer: 'https://mcp.swiggy.com/auth',
    authorize: 'https://mcp.swiggy.com/auth/authorize',
    token: 'https://mcp.swiggy.com/auth/token',
    register: 'https://mcp.swiggy.com/auth/register',
    resource: null,
    mcpUrl: 'https://mcp.swiggy.com/im',
    scopes: ['mcp:tools'],
    fallbackScopes: ['mcp:tools'],
    direct: false,
  },
};

export function isAccountPlatform(id: string): id is AccountPlatform {
  return Object.hasOwn(ACCOUNT_PROVIDERS, id);
}

export function targetUrl(p: AccountProvider, target: ProviderTarget): string {
  return target === 'mcp' ? p.mcpUrl : target === 'token' ? p.token : p.register;
}

/** A POST to one of the provider's endpoints: straight from the browser when allowed, else via our relay. */
export function callProvider(p: AccountProvider, target: ProviderTarget, headers: Record<string, string>, body: string, signal?: AbortSignal): Promise<Response> {
  const url = p.direct ? targetUrl(p, target) : `/api/account/relay?provider=${p.platformId}&target=${target}`;
  return fetch(url, { method: 'POST', headers, body, signal, credentials: 'omit' });
}
