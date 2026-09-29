import { BlockedError } from '../errors';

/**
 * Statuses that mean "an edge refused us", never "no results". A 202 is on the
 * list only together with AWS WAF's challenge header: Zepto and Instamart
 * answer a challenge as 202 + `x-amzn-waf-action: challenge` with an empty or
 * HTML body, which would otherwise parse as a successful empty search — a lie
 * the user cannot see.
 */
const BLOCKED_STATUSES = new Set([401, 403, 407, 429, 503]);

export interface MinimalResponse {
  status: number;
  headers: { get(name: string): string | null };
}

export function assertNotBlocked(res: MinimalResponse, host: string): void {
  const waf = res.headers.get('x-amzn-waf-action');
  if (waf) throw new BlockedError(`${host}: AWS WAF ${waf} (HTTP ${res.status})`);

  const cf = res.headers.get('cf-mitigated');
  if (cf) throw new BlockedError(`${host}: Cloudflare ${cf} (HTTP ${res.status})`);

  if (BLOCKED_STATUSES.has(res.status)) {
    throw new BlockedError(`${host}: HTTP ${res.status}`);
  }
}

/** A challenge page served with 200 is still a block. Call on bodies you expected to be JSON. */
export function assertJsonBody(body: string, host: string): void {
  const head = body.trimStart().slice(0, 1);
  if (head !== '{' && head !== '[') {
    const looksLikeChallenge = /captcha|challenge|access denied|attention required|verify you are human/i.test(body.slice(0, 4000));
    throw new BlockedError(
      looksLikeChallenge ? `${host}: challenge page instead of JSON` : `${host}: expected JSON, got ${body.slice(0, 60)}`,
    );
  }
}
