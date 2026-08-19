import type { SpaceshipClient } from "./client.js";
import { AppError } from "./cli/foundation/error-map.js";
import type { AsyncOperation } from "./types.js";

/**
 * Register, renew, restore and transfer answer 202 with an operation id and
 * finish later. Handing that loop to the caller means every agent writes its
 * own backoff and gets the terminal states subtly wrong, so `--wait` lives here.
 *
 * The status endpoint allows 60 requests per user per 300 seconds, which is one
 * every five seconds. The interval below stays inside that budget even with a
 * few operations in flight.
 */

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 300_000;

export type WaitOutcome = {
  operationId: string;
  operation: AsyncOperation;
  /** False when the timeout elapsed while the operation was still pending. */
  settled: boolean;
  attempts: number;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForOperation(
  client: SpaceshipClient,
  operationId: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    /** Called on every poll so a human sees progress rather than a frozen line. */
    onPoll?: (operation: AsyncOperation, attempt: number) => void;
    now?: () => number;
  } = {},
): Promise<WaitOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const deadline = now() + timeoutMs;

  let attempts = 0;
  let last: AsyncOperation | null = null;

  while (true) {
    const { data } = await client.get<AsyncOperation>(
      `/v1/async-operations/${encodeURIComponent(operationId)}`,
    );
    attempts++;
    last = data;
    options.onPoll?.(data, attempts);

    if (data.status === "success" || data.status === "failed") {
      return { operationId, operation: data, settled: true, attempts };
    }

    if (now() >= deadline) {
      return { operationId, operation: data, settled: false, attempts };
    }

    await sleep(intervalMs);
  }
}

/**
 * A 202 without the header would leave the caller with no way to follow the
 * operation, so it is an error rather than a silent success.
 */
export function requireOperationId(asyncOperationId: string | null, command: string): string {
  if (asyncOperationId) return asyncOperationId;
  throw new AppError("upstream", {
    name: "MissingOperationId",
    human: `${command} was accepted but returned no operation id.`,
    hint: "The change may still be in progress. Check `spaceship domains get <domain>` before retrying.",
  });
}
