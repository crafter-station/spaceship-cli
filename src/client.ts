import { AppError } from "./cli/foundation/error-map.js";
import type { RateLimitState } from "./contract.js";

export const BASE_URL = "https://spaceship.dev/api";

export type Credentials = { apiKey: string; apiSecret: string };

/**
 * Only the callable part of fetch, so a test double does not have to implement
 * the runtime's extra statics (Bun adds `preconnect`).
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ClientOptions = {
  baseUrl?: string;
  /** Attempts on a 429 or 5xx before giving up. The API documents Retry-After. */
  maxRetries?: number;
  fetchImpl?: FetchLike;
};

export type ApiResponse<T> = {
  data: T;
  /** From the spaceship-operation-id header, for correlating with support */
  operationId: string | null;
  /** From the spaceship-async-operationid header on a 202 */
  asyncOperationId: string | null;
  rateLimit: RateLimitState | null;
  status: number;
};

/** RFC 7807, which is what Spaceship returns on every error. */
type ProblemDetails = {
  detail?: string;
  title?: string;
  errors?: { field?: string; details?: string }[];
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function readRateLimit(headers: Headers): RateLimitState | null {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (limit === null || remaining === null || reset === null) return null;
  return {
    limit: Number(limit),
    remaining: Number(remaining),
    resetsAt: new Date(Number(reset) * 1000).toISOString(),
  };
}

/**
 * Retry-After is seconds in this API. Falls back to exponential backoff with
 * jitter so a fleet of agents does not retry in lockstep.
 */
function retryDelayMs(headers: Headers, attempt: number): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  const backoff = Math.min(2 ** attempt * 500, 8000);
  return backoff + Math.random() * 250;
}

function problemToError(status: number, body: ProblemDetails, upstream: string | null): AppError {
  const fieldErrors = (body.errors ?? [])
    .map((e) => (e.field ? `${e.field}: ${e.details ?? ""}`.trim() : e.details))
    .filter(Boolean)
    .join("; ");
  const detail = body.detail ?? body.title ?? `HTTP ${status}`;
  const message = fieldErrors ? `${detail} (${fieldErrors})` : detail;

  if (status === 401) {
    return new AppError("auth.rejected", {
      name: "AuthRejected",
      human: message,
      hint: "Check SPACESHIP_API_KEY and SPACESHIP_API_SECRET, or run `spaceship auth login`.",
    });
  }
  if (status === 403) {
    return new AppError("auth.missing-scope", {
      name: "MissingScope",
      human: message,
      hint: "Your API key lacks a required scope. Add it at spaceship.com/application/api-manager/.",
    });
  }
  if (status === 404) {
    return new AppError("not-found", { name: "NotFound", human: message });
  }
  if (status === 422 || status === 400) {
    return new AppError("validation", {
      name: "ValidationFailed",
      human: message,
      hint: "Run the command with --dry-run to inspect the request the CLI would send.",
    });
  }
  if (status === 429) {
    return new AppError("rate-limited", {
      name: "RateLimited",
      human: message,
      hint: "The CLI already retried with the API's Retry-After. Wait for the window to reset.",
    });
  }
  return new AppError(upstream ?? "upstream", {
    name: "UpstreamError",
    human: message,
  });
}

export class SpaceshipClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly doFetch: FetchLike;

  constructor(
    private readonly credentials: Credentials,
    options: ClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.maxRetries = options.maxRetries ?? 3;
    this.doFetch = options.fetchImpl ?? fetch;
  }

  async request<T>(
    method: string,
    path: string,
    init: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<ApiResponse<T>> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let lastError: AppError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: Response;
      try {
        response = await this.doFetch(url, {
          method,
          headers: {
            "X-API-Key": this.credentials.apiKey,
            "X-API-Secret": this.credentials.apiSecret,
            Accept: "application/json",
            ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });
      } catch (cause) {
        throw new AppError(
          "network",
          {
            name: "NetworkError",
            human: `Could not reach ${url.host}.`,
            hint: "Check your connection. The CLI reached no further than DNS or TCP.",
          },
          cause,
        );
      }

      const rateLimit = readRateLimit(response.headers);
      const operationId = response.headers.get("spaceship-operation-id");
      const asyncOperationId = response.headers.get("spaceship-async-operationid");

      if (response.ok) {
        const text = await response.text();
        return {
          data: (text === "" ? null : JSON.parse(text)) as T,
          operationId,
          asyncOperationId,
          rateLimit,
          status: response.status,
        };
      }

      const upstreamCode = response.headers.get("spaceship-error-code");
      let problem: ProblemDetails = {};
      try {
        problem = (await response.json()) as ProblemDetails;
      } catch {
        // A non-JSON error body is still an error; the status carries the meaning.
      }
      lastError = problemToError(response.status, problem, upstreamCode);

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === this.maxRetries) throw lastError;
      await sleep(retryDelayMs(response.headers, attempt));
    }

    throw lastError ?? new AppError("runtime", { name: "Unreachable", human: "Retry loop ended without a result." });
  }

  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<ApiResponse<T>> {
    return this.request<T>("GET", path, { query });
  }

  post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("POST", path, { body });
  }

  put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("PUT", path, { body });
  }

  patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("PATCH", path, { body });
  }

  delete<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("DELETE", path, { body });
  }
}
