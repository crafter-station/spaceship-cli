import type { SpaceshipClient } from "./client.js";
import { AppError } from "./cli/foundation/error-map.js";
import { approveGate, type TrustLevel } from "./cli/agent/trust-ladder.js";
import { EXIT, type ExitCode, type NextStep } from "./contract.js";
import { emitResult, newRequestId, type EmitContext } from "./output/envelope.js";
import { bold, danger, dim, muted, warn } from "./cli/platform/style.js";
import { assertWritesAllowed, auditBegin, auditEnd } from "./audit.js";

/**
 * One path for every write. It builds the request first, so `--dry-run` shows
 * the bytes that would actually be sent rather than an echo of the arguments,
 * then gates on the operation's trust tier, then records the attempt before the
 * call and its outcome after.
 */

export type Mutation<T> = {
  command: string;
  trust: TrustLevel;
  /** The subject of the change: a domain, an application, a listing. */
  target: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** One line stating what will change, for the approval prompt and the preview. */
  summary: string;
  /** Extra context a reader needs before approving. */
  details?: Record<string, string | number | boolean | null | undefined>;
  /** Shown when the change is hard to walk back. */
  warning?: string;
  nextSteps?: (result: T) => NextStep[];
  /** Renders the success path for a human. */
  render?: (result: T) => void;
};

export type MutateFlags = {
  apply?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  confirm?: string;
};

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

function renderPreview<T>(mutation: Mutation<T>, willApply: boolean): void {
  line("");
  line(`${willApply ? warn("about to change") : dim("would change")}  ${bold(mutation.target)}`);
  line(`  ${mutation.summary}`);
  for (const [key, value] of Object.entries(mutation.details ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    line(`  ${dim(key.padEnd(14))} ${String(value)}`);
  }
  line(`  ${dim("request".padEnd(14))} ${muted(`${mutation.method} ${mutation.path}`)}`);
  if (mutation.body !== undefined) {
    const encoded = JSON.stringify(mutation.body);
    line(`  ${dim("body".padEnd(14))} ${muted(encoded.length > 160 ? `${encoded.slice(0, 157)}...` : encoded)}`);
  }
  if (mutation.warning) line(`  ${danger(mutation.warning)}`);
  line("");
}

export async function runMutation<T>(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  mutation: Mutation<T>,
): Promise<ExitCode> {
  const requestId = newRequestId();

  // --dry-run stops here, after the request has been fully constructed. Nothing
  // is sent, and what is shown is what would have gone on the wire.
  if (flags.dryRun === true || flags.apply !== true) {
    const preview = {
      wouldApply: true,
      reason: flags.dryRun === true ? "dry run" : "add --apply to perform this change",
      request: { method: mutation.method, path: mutation.path, body: mutation.body ?? null },
      target: mutation.target,
      trust: mutation.trust,
      summary: mutation.summary,
    };
    return emitResult(ctx, preview, { requestId }, () => renderPreview(mutation, false));
  }

  // Checked after the preview so --dry-run still works while writes are frozen.
  assertWritesAllowed();

  const approved = await approveGate(
    { cliName: "spaceship", flags: ctx.flags },
    {
      title: mutation.command,
      summary: `${mutation.summary} on ${mutation.target}`,
      details: mutation.details,
      warning: mutation.warning,
    },
    {
      trust: mutation.trust,
      yes: flags.yes,
      confirm: flags.confirm,
      confirmAgainst: mutation.target,
    },
  );

  if (!approved) {
    throw new AppError("blocked", {
      name: "NotApproved",
      human: `Declined: ${mutation.summary} on ${mutation.target}.`,
      hint: "Nothing was sent.",
    });
  }

  // The pending record is written before the call, so a process killed
  // mid-flight leaves an auditable entry rather than silence.
  const entry = auditBegin({
    id: requestId,
    command: mutation.command,
    target: mutation.target,
    trust: mutation.trust,
    request: { method: mutation.method, path: mutation.path, body: mutation.body ?? null },
  });

  try {
    const response = await client.request<T>(mutation.method, mutation.path, { body: mutation.body });
    auditEnd(entry, "ok", { status: response.status, operationId: response.operationId });

    return emitResult(
      ctx,
      response.data ?? ({ applied: true, target: mutation.target } as unknown as T),
      {
        requestId,
        rateLimit: response.rateLimit,
        nextSteps: mutation.nextSteps?.(response.data),
      },
      (data) => {
        if (mutation.render) mutation.render(data);
        else line(`\n${bold(mutation.target)}  ${mutation.summary}\n`);
      },
    );
  } catch (error) {
    auditEnd(entry, "error", {
      code: error instanceof AppError ? error.code : "runtime",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export { EXIT };
