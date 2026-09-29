/**
 * Signing in to an app's official MCP server from this browser: OAuth 2.1
 * authorization code with PKCE, as a public client (dynamic registration).
 * The app's own page asks for the phone number and OTP; jhola never sees
 * them. Tokens are kept in this browser only.
 */
import { track } from '@/lib/analytics';
import { load, save } from '@/lib/storage';
import { ACCOUNT_PROVIDERS, callProvider, type AccountPlatform, type AccountProvider } from './providers';

interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  clientId: string;
}

interface Pending {
  platformId: AccountPlatform;
  state: string;
  verifier: string;
  scopes: string;
  clientId: string;
  redirectUri: string;
  returnTo: string;
}

interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

const PENDING_KEY = 'account:pending';
const tokensKey = (id: AccountPlatform) => `account:${id}:tokens`;
const clientKey = (id: AccountPlatform) => `account:${id}:client`;

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const randomString = (bytes: number) => base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
async function codeChallenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export const redirectUri = () => `${window.location.origin}/callback`;

async function clientIdFor(p: AccountProvider, redirect: string): Promise<string> {
  const cached = load<{ id: string; redirect: string } | null>(clientKey(p.platformId), null);
  if (cached?.redirect === redirect) return cached.id;
  const res = await callProvider(
    p,
    'register',
    { 'content-type': 'application/json', accept: 'application/json' },
    JSON.stringify({
      client_name: 'jhola — grocery price comparison',
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  );
  const body = (await res.json().catch(() => ({}))) as { client_id?: string; error_description?: string };
  if (!res.ok || !body.client_id) throw new Error(body.error_description ?? `${p.name} didn’t let jhola register (HTTP ${res.status})`);
  save(clientKey(p.platformId), { id: body.client_id, redirect });
  return body.client_id;
}

/** Sends the browser to the app's own sign-in page. */
export async function startSignIn(platformId: AccountPlatform, opts: { scopes?: string[]; returnTo?: string } = {}): Promise<void> {
  const p = ACCOUNT_PROVIDERS[platformId];
  const redirect = redirectUri();
  const clientId = await clientIdFor(p, redirect);
  const verifier = randomString(48);
  const state = randomString(16);
  const scopes = (opts.scopes ?? p.scopes).join(' ');
  save(PENDING_KEY, { platformId, state, verifier, scopes, clientId, redirectUri: redirect, returnTo: opts.returnTo ?? '/' } satisfies Pending);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    scope: scopes,
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: 'S256',
  });
  if (p.resource) params.set('resource', p.resource);
  track('login_start', { method: platformId });
  window.location.assign(`${p.authorize}?${params}`);
}

function keepTokens(p: AccountProvider, answer: TokenAnswer, clientId: string, previous: Tokens | null): string {
  const tokens: Tokens = {
    accessToken: answer.access_token!,
    refreshToken: answer.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: Date.now() + (answer.expires_in ?? 3600) * 1000,
    clientId,
  };
  save(tokensKey(p.platformId), tokens);
  window.dispatchEvent(new Event('jhola:accounts'));
  return tokens.accessToken;
}

/** Completes the sign-in on /callback. Resolves to where the shopper started, or navigates away to retry. */
export async function finishSignIn(params: URLSearchParams): Promise<{ platformId: AccountPlatform; returnTo: string }> {
  const pending = load<Pending | null>(PENDING_KEY, null);
  save(PENDING_KEY, null);
  if (!pending || params.get('state') !== pending.state) throw new Error('That sign-in link has expired — tap Log in again.');
  const p = ACCOUNT_PROVIDERS[pending.platformId];

  const error = params.get('error');
  if (error === 'invalid_scope' && pending.scopes !== p.fallbackScopes.join(' ')) {
    await startSignIn(p.platformId, { scopes: p.fallbackScopes, returnTo: pending.returnTo });
    return new Promise(() => {});
  }
  if (error) throw new Error(params.get('error_description') ?? `${p.name} said “${error}”.`);
  const iss = params.get('iss');
  if (iss && iss !== p.issuer) throw new Error('The sign-in answer came from the wrong server, so it was ignored.');
  const code = params.get('code');
  if (!code) throw new Error(`${p.name} sent no sign-in code back.`);

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    client_id: pending.clientId,
    code_verifier: pending.verifier,
  });
  if (p.resource) form.set('resource', p.resource);
  const res = await callProvider(p, 'token', { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, form.toString());
  const answer = (await res.json().catch(() => ({}))) as TokenAnswer;
  if (!res.ok || !answer.access_token) throw new Error(answer.error_description ?? `${p.name} didn’t accept the sign-in (HTTP ${res.status}).`);
  keepTokens(p, answer, pending.clientId, null);
  track('login', { method: p.platformId });
  return { platformId: p.platformId, returnTo: pending.returnTo };
}

export function isSignedIn(platformId: AccountPlatform): boolean {
  return load<Tokens | null>(tokensKey(platformId), null) !== null;
}

export function signOut(platformId: AccountPlatform): void {
  if (isSignedIn(platformId)) track('logout', { method: platformId });
  save(tokensKey(platformId), null);
  window.dispatchEvent(new Event('jhola:accounts'));
}

// One refresh at a time per app: refresh tokens may be single-use.
const refreshing = new Map<AccountPlatform, Promise<string | null>>();

/** A valid access token, refreshed when about to expire; null when signed out. */
export async function accessToken(platformId: AccountPlatform): Promise<string | null> {
  const tokens = load<Tokens | null>(tokensKey(platformId), null);
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) {
    signOut(platformId);
    return null;
  }
  let flight = refreshing.get(platformId);
  if (!flight) {
    const p = ACCOUNT_PROVIDERS[platformId];
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: tokens.clientId });
    if (p.resource) form.set('resource', p.resource);
    flight = callProvider(p, 'token', { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, form.toString())
      .then(async (res) => {
        const answer = (await res.json().catch(() => ({}))) as TokenAnswer;
        if (!res.ok || !answer.access_token) {
          signOut(platformId);
          return null;
        }
        return keepTokens(p, answer, tokens.clientId, tokens);
      })
      .catch(() => null)
      .finally(() => refreshing.delete(platformId));
    refreshing.set(platformId, flight);
  }
  return flight;
}
