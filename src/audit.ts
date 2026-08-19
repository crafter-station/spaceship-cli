import { beginAudit, type AuditLifecycle } from "./cli/foundation/audit-lifecycle.js";
import { tailAudit } from "./cli/foundation/audit-log.js";
import { getAppPaths } from "./cli/foundation/xdg-paths.js";
import { getKillswitchState } from "./cli/safety/killswitch.js";
import { AppError } from "./cli/foundation/error-map.js";

/**
 * Every write leaves a receipt. The pending record is written before the
 * request so a process killed mid-flight is visible as an unfinished attempt
 * rather than as nothing at all.
 */

export const APP_NAME = "spaceship";

/** SPACESHIP_HOME redirects every path, which is how the tests stay off the real home. */
export const paths = () => getAppPaths(APP_NAME);
export const auditDir = (): string => paths().audit;

/**
 * Refuses every write while the killswitch file exists, so a human can stop a
 * running agent out of band without revoking the API key.
 */
export function assertWritesAllowed(): void {
  const state = getKillswitchState(paths().home);
  if (!state.active) return;
  // The block throws a plain Error, which would map to the generic runtime exit
  // code. A caller needs to tell "refused on purpose" from "the CLI broke".
  throw new AppError("killswitch", {
    name: "KillswitchOn",
    human: state.reason
      ? `Writes are frozen: ${state.reason}`
      : "Writes are frozen by the killswitch.",
    hint: `Remove ${paths().home}/KILLSWITCH to resume. Reads and --dry-run still work.`,
  });
}

export type AuditContext = {
  id: string;
  command: string;
  target: string;
  trust: string;
  request: { method: string; path: string; body: unknown };
};

export function auditBegin(ctx: AuditContext): AuditLifecycle {
  return beginAudit(
    auditDir(),
    {
      kind: "mutation",
      command: ctx.command,
      tier: ctx.trust,
      meta: {
        target: ctx.target,
        method: ctx.request.method,
        path: ctx.request.path,
        // The body can carry contact details, so only its shape is recorded.
        body_keys:
          ctx.request.body && typeof ctx.request.body === "object"
            ? Object.keys(ctx.request.body as Record<string, unknown>)
            : [],
      },
    },
    { auditId: ctx.id },
  );
}

export function auditEnd(
  entry: AuditLifecycle,
  result: "ok" | "error" | "blocked",
  meta: Record<string, unknown> = {},
): void {
  if (result === "ok") entry.complete(meta);
  else if (result === "blocked") entry.block(meta);
  else entry.fail(meta);
}

export const readAudit = (count = 20) => tailAudit(auditDir(), count);
