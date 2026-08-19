// cligentic block: json-mode
//
// Dual-rendering output helpers for CLIs that serve both humans and agents.
//
// Design rules:
//   1. stdout is data. Only structured JSON in --json mode, formatted in human.
//   2. stderr is logs. Notes, progress, errors.
//   3. Mode detection is implicit. Piped stdout auto-switches to JSON.
//   4. Never call process.exit().
//   5. One call site: emit(value, opts, humanRender?).
//
// Usage:
//   import { detectMode, emit, note, reportError } from "./agent/json-mode";
//
//   program.option("--json", "emit JSON for agents");
//   program.command("list").action(async (opts) => {
//     const items = await fetchItems();
//     emit(items, opts, (data) => {
//       for (const item of data) console.log(`- ${item.name}`);
//     });
//   });

import pc from "picocolors";
import {
  type EmitOptions,
  type OutputMode,
  detectMode,
  shouldColor,
} from "../platform/detect.js";

// Re-export so consumers can import everything from json-mode
export { type EmitOptions, type OutputMode as Mode, detectMode, shouldColor };

/**
 * Emits a value to stdout. JSON in json mode, humanRender callback in human.
 * Arrays emit as NDJSON (one object per line) for agent stream-parsing.
 */
export function emit<T>(value: T, opts: EmitOptions = {}, humanRender?: (value: T) => void): void {
  const mode = detectMode(opts);

  if (mode === "json") {
    if (Array.isArray(value)) {
      for (const item of value) {
        process.stdout.write(`${JSON.stringify(item)}\n`);
      }
    } else {
      process.stdout.write(`${JSON.stringify(value)}\n`);
    }
    return;
  }

  if (humanRender) {
    humanRender(value);
    return;
  }

  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Writes a note to stderr. Suppressed in json mode and quiet mode.
 */
export function note(message: string, opts: EmitOptions = {}): void {
  if (opts.json === true) return;
  if (!process.stdout.isTTY && opts.json !== false) return;
  if (opts.quiet) return;

  const colored = shouldColor() ? pc.dim(message) : message;
  process.stderr.write(`${colored}\n`);
}

/**
 * Writes a success message. JSON to stdout in json mode, colored to stderr in human.
 */
export function emitSuccess(message: string, opts: EmitOptions = {}): void {
  const mode = detectMode(opts);
  if (mode === "json") {
    process.stdout.write(`${JSON.stringify({ ok: true, message })}\n`);
    return;
  }
  const prefix = shouldColor() ? pc.green("✓") : "✓";
  process.stderr.write(`${prefix} ${message}\n`);
}

/**
 * Reports an error without exiting. JSON to stdout in json mode, colored
 * to stderr in human. Returns the structured payload for caller inspection.
 */
export function reportError(
  error: string | Error,
  opts: EmitOptions = {},
): { ok: false; error: string; stack?: string } {
  const message = error instanceof Error ? error.message : error;
  const stack = error instanceof Error ? error.stack : undefined;
  const payload = { ok: false as const, error: message, ...(stack ? { stack } : {}) };

  const mode = detectMode(opts);
  if (mode === "json") {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return payload;
  }

  const prefix = shouldColor() ? pc.red("✗") : "✗";
  process.stderr.write(`${prefix} ${message}\n`);
  if (stack && process.env.DEBUG) {
    process.stderr.write(`${shouldColor() ? pc.dim(stack) : stack}\n`);
  }
  return payload;
}
