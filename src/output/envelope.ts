import { randomUUID } from "node:crypto";
import { detectMode } from "../cli/agent/json-mode.js";
import type { EmitOptions } from "../cli/platform/detect.js";
import { AppError } from "../cli/foundation/error-map.js";
import { danger, dim, muted, warn } from "../cli/platform/style.js";
import { CONTRACT_VERSION, EXIT, type Envelope, type ExitCode, type NextStep, type RateLimitState } from "../contract.js";

/**
 * One envelope per command on stdout. cligentic's `emit` splits arrays into
 * NDJSON, which would break the single-object contract published to agents, so
 * results are always wrapped before they reach it.
 */

export type EmitContext = {
  command: string;
  flags: EmitOptions;
};

export function newRequestId(): string {
  return `spaceship-${randomUUID()}`;
}

export function emitResult<T>(
  ctx: EmitContext,
  result: T,
  extras: { nextSteps?: NextStep[]; rateLimit?: RateLimitState | null; requestId?: string } = {},
  humanRender?: (value: T) => void,
): ExitCode {
  const envelope: Envelope<T> = {
    version: CONTRACT_VERSION,
    command: ctx.command,
    timestamp: new Date().toISOString(),
    requestId: extras.requestId ?? newRequestId(),
    ok: true,
    result,
    ...(extras.nextSteps && extras.nextSteps.length > 0 ? { nextSteps: extras.nextSteps } : {}),
    ...(extras.rateLimit ? { rateLimit: extras.rateLimit } : {}),
  };

  if (detectMode(ctx.flags) === "json") {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return EXIT.ok;
  }

  if (humanRender) humanRender(result);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (extras.nextSteps && extras.nextSteps.length > 0) {
    process.stderr.write("\n");
    for (const step of extras.nextSteps) {
      process.stderr.write(`${dim("next")}  ${step.command}\n`);
      process.stderr.write(`      ${muted(step.reason)}\n`);
    }
  }
  return EXIT.ok;
}

const EXIT_BY_CODE: Record<string, ExitCode> = {
  "auth.rejected": EXIT.auth,
  "auth.missing-credentials": EXIT.auth,
  "auth.missing-scope": EXIT.auth,
  "not-found": EXIT.notFound,
  network: EXIT.network,
  validation: EXIT.usage,
  usage: EXIT.usage,
  "rate-limited": EXIT.rateLimited,
  blocked: EXIT.blocked,
  killswitch: EXIT.blocked,
  "approval/confirm-mismatch": EXIT.blocked,
  "approval/required": EXIT.blocked,
  "approval/declined": EXIT.blocked,
  pending: EXIT.pending,
};

const RETRYABLE = new Set(["network", "rate-limited", "upstream"]);

export function emitError(ctx: EmitContext, error: unknown, requestId?: string): ExitCode {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("runtime", {
          name: "UnexpectedError",
          human: error instanceof Error ? error.message : String(error),
        });

  const exit = EXIT_BY_CODE[appError.code] ?? EXIT.runtime;

  const envelope: Envelope<never> = {
    version: CONTRACT_VERSION,
    command: ctx.command,
    timestamp: new Date().toISOString(),
    requestId: requestId ?? newRequestId(),
    ok: false,
    error: {
      code: appError.code,
      message: appError.human,
      ...(appError.hint ? { hint: appError.hint } : {}),
      retryable: RETRYABLE.has(appError.code),
    },
  };

  if (detectMode(ctx.flags) === "json") {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return exit;
  }

  process.stderr.write(`${danger("error")}  ${appError.human}\n`);
  if (appError.hint) process.stderr.write(`${warn("hint")}   ${appError.hint}\n`);
  return exit;
}
