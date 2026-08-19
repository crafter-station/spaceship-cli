// cligentic block: next-steps
//
// Post-command guidance for agents and humans. Emit structured "what to do
// next" hints after a command completes so agents can chain operations
// without re-planning from scratch, and humans get visible next actions.
//
// Design rules:
//   1. stderr only. Never stdout — stdout is data territory (see json-mode).
//   2. NDJSON in json mode (one object per line, stream-parseable).
//   3. Formatted block with arrow bullets in human mode.
//   4. Never throws, never exits. Pure emission.
//   5. Each step is { command, description, optional? } — agents key off
//      `command`, humans read `description`.
//
// Usage:
//   import { emit } from "./json-mode";
//   import { emitNextSteps } from "./next-steps";
//
//   program.command("list").action(async (opts) => {
//     const items = await fetchItems();
//     emit(items, opts);
//     emitNextSteps([
//       { command: "myapp show <id>", description: "see details for one item" },
//       { command: "myapp export --format csv", description: "export all items", optional: true },
//     ], opts);
//   });
//
// Agent consumption (Node/Bun pseudocode):
//   const proc = spawn("myapp", ["list", "--json"]);
//   const data = JSON.parse(await readStdout(proc));       // data from emit()
//   const steps = readStderr(proc)
//     .split("\n")
//     .filter(Boolean)
//     .map(line => JSON.parse(line))
//     .filter(obj => obj.type === "next-step");             // hints from emitNextSteps()
//
//   // Agent now has both data (decisions input) and hints (what to do next).
//
// Depends on:
//   - picocolors (for human-mode coloring)
//   - json-mode block (chained via registryDependencies — provides detectMode)

import pc from "picocolors";
import { type EmitOptions, detectMode, shouldColor } from "./json-mode.js";

export type NextStep = {
  /** The literal command the user/agent should run next. */
  command: string;
  /** A short (2-10 word) hint for why this step matters. */
  description: string;
  /** If true, the step is suggested but not required. */
  optional?: boolean;
};

/**
 * Emits a list of next-step hints to stderr.
 *
 * In json mode: one NDJSON object per line, each tagged with `type: "next-step"`
 * so agents can distinguish them from other stderr content.
 *
 * In human mode: a formatted block with arrow bullets (→ for required,
 * ○ for optional) and dim descriptions.
 *
 * Does nothing if the steps array is empty.
 */
export function emitNextSteps(steps: NextStep[], opts: EmitOptions = {}): void {
  if (steps.length === 0) return;

  const mode = detectMode(opts);

  if (mode === "json") {
    for (const step of steps) {
      process.stderr.write(
        `${JSON.stringify({ type: "next-step", ...step })}\n`,
      );
    }
    return;
  }

  // Human mode — formatted block.
  const color = shouldColor();
  const header = color ? pc.bold("Next steps:") : "Next steps:";
  process.stderr.write(`\n${header}\n`);

  for (const step of steps) {
    const marker = step.optional ? "○" : "→";
    const cmd = color ? pc.cyan(step.command) : step.command;
    const desc = color ? pc.dim(step.description) : step.description;
    process.stderr.write(`  ${marker} ${cmd}  ${desc}\n`);
  }

  process.stderr.write("\n");
}

