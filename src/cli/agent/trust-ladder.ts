// cligentic block: trust-ladder
//
// Approval gate and preview renderer for T2/T3 CLI actions.

import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stderr as defaultStderr } from "node:process";
import { type EmitOptions, detectMode } from "./json-mode.js";
import { AppError } from "../foundation/error-map.js";

export type TrustLevel = "T0" | "T1" | "T2" | "T3";

export type TrustPreview = {
  title: string;
  summary: string;
  details?: Record<string, string | number | boolean | null | undefined>;
  warning?: string;
};

export type ApprovalContext = {
  cliName?: string;
  flags?: EmitOptions & { noInput?: boolean };
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  stderr?: NodeJS.WritableStream & { isTTY?: boolean };
};

export type ApprovalOptions = {
  trust: TrustLevel;
  yes?: boolean;
  confirm?: string;
  confirmAgainst?: string;
};

export async function approveGate(
  ctx: ApprovalContext,
  preview: TrustPreview,
  opts: ApprovalOptions,
): Promise<boolean> {
  if (opts.trust !== "T2" && opts.trust !== "T3") return true;

  if (opts.trust === "T3") {
    const expected = opts.confirmAgainst;
    if (!opts.confirm || !expected || opts.confirm !== expected) {
      throw new AppError("approval/confirm-mismatch", {
        name: "ApprovalConfirmMismatch",
        human: "Confirmation value does not match the target id.",
        hint: "Pass --yes --confirm <id> for T3 commands.",
      });
    }
  }

  if (opts.yes === true) return true;

  const flags = ctx.flags ?? {};
  const input = ctx.stdin ?? defaultStdin;
  const output = ctx.stderr ?? defaultStderr;
  const json = detectMode(flags) === "json";
  const noInput = flags.noInput === true;
  const inputTty = input.isTTY === true;
  const outputTty = output.isTTY === true;

  if (json || noInput || !inputTty || !outputTty) {
    const cli = ctx.cliName ?? "this CLI";
    throw new AppError("approval/required", {
      name: "ApprovalRequired",
      human: `Approval is required before ${cli} can run this operation.`,
      hint: opts.trust === "T3" ? "Pass --yes --confirm <id>." : "Pass --yes.",
    });
  }

  output.write(`${preview.title}\n\n${renderPreview(preview)}\n\n`);
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Continue? [y/N] ");
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

export function renderPreview(preview: TrustPreview, opts: { labelWidth?: number } = {}): string {
  const labelWidth = opts.labelWidth ?? 14;
  const rows = Object.entries(preview.details ?? {}).map(([key, value]) => {
    const lines = String(value ?? "").split("\n");
    const [first = "", ...rest] = lines;
    const label = `${key}:`.padEnd(labelWidth);
    const body = [first, ...rest.map((line) => `${" ".repeat(labelWidth)}${line}`)].join("\n");
    return `${label}${body}`;
  });

  return [
    preview.summary,
    ...(rows.length > 0 ? ["", ...rows] : []),
    ...(preview.warning ? ["", preview.warning] : []),
  ].join("\n");
}
