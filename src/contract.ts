/**
 * The JSON contract. This is the API agents depend on, so it is written before
 * the code that fills it and changed only with a version bump.
 *
 * Every command emits exactly one Envelope on stdout in JSON mode.
 */

export const CONTRACT_VERSION = "1";

export type Envelope<T = unknown> = {
  /** Contract version. Bumped only on a breaking shape change. */
  version: string;
  /** Command as invoked: "domains list" */
  command: string;
  /** ISO 8601, UTC */
  timestamp: string;
  /** Correlates the CLI run with the API's spaceship-operation-id */
  requestId: string;
  ok: boolean;
  /** Present when ok is true */
  result?: T;
  /** Present when ok is false */
  error?: EnvelopeError;
  /** What the caller can run next, already substituted */
  nextSteps?: NextStep[];
  /** Present when the API answered with a rate-limit budget */
  rateLimit?: RateLimitState;
};

export type EnvelopeError = {
  /** Stable, dot-separated: "auth.missing-credentials" */
  code: string;
  /** One sentence, no trailing period stripped */
  message: string;
  /** What to do about it */
  hint?: string;
  /** Spaceship's own error code, when the failure came from the API */
  upstreamCode?: string;
  /** True when retrying the same call could succeed */
  retryable: boolean;
};

export type NextStep = {
  /** Runnable, with values already substituted */
  command: string;
  /** Why you would run it */
  reason: string;
};

export type RateLimitState = {
  limit: number;
  remaining: number;
  /** ISO 8601 */
  resetsAt: string;
};

/**
 * Exit codes. Zero is success; user error and system failure are
 * distinguishable so a caller can branch without parsing text.
 */
export const EXIT = {
  ok: 0,
  /** Unexpected failure inside the CLI */
  runtime: 1,
  /** Bad arguments, missing required flag, unknown command */
  usage: 2,
  /** Missing or rejected credentials */
  auth: 3,
  /** The target does not exist */
  notFound: 4,
  /** Network unreachable, DNS failure, timeout */
  network: 5,
  /** Refused by a trust gate or the killswitch */
  blocked: 6,
  /** Rate limited by the API */
  rateLimited: 7,
  /** An async operation was still pending when --wait timed out */
  pending: 8,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
