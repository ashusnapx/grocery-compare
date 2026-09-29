/**
 * Every way a platform can fail, so the user sees an honest status instead of
 * an empty shelf. Adapters throw these; the search runner maps them to
 * PlatformStatus.
 */

/** The platform's edge refused us: Cloudflare / AWS WAF challenge, 403, 429. */
export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedError';
  }
}

/** The platform did not answer within the deadline. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** The platform does not deliver to this location. */
export class UnserviceableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnserviceableError';
  }
}

/** The platform answered, but not in a shape we can trust (changed API, bad JSON). */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** The adapter for this platform has not been built yet. */
export class NotImplementedError extends Error {
  constructor(platform: string) {
    super(`${platform} adapter is not built yet`);
    this.name = 'NotImplementedError';
  }
}
