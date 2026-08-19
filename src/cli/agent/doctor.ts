// cligentic block: doctor
//
// Health-check pattern. Run named checks sequentially, emit structured results.
// Integrates with json-mode for dual output.
//
// Usage:
//   import { runDoctor, renderDoctor } from "./agent/doctor";
//
//   const result = await runDoctor([
//     async () => {
//       const ok = await ping();
//       return { name: "api-reachable", ok, detail: ok ? "200 OK" : "timeout" };
//     },
//   ]);
//   renderDoctor(result, opts);

import { type EmitOptions, detectMode, emit } from "./json-mode.js";

export type DoctorCheck = { name: string; ok: boolean; detail: string };

export type DoctorResult = { ok: boolean; checks: DoctorCheck[] };

/**
 * Runs checks sequentially. Each check is isolated — a thrown error is
 * caught and recorded as a failed check so the rest still run.
 */
export async function runDoctor(
  checks: Array<() => Promise<DoctorCheck>>,
): Promise<DoctorResult> {
  const results: DoctorCheck[] = [];

  for (const check of checks) {
    try {
      results.push(await check());
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ name: "unknown", ok: false, detail });
    }
  }

  return { ok: results.every((c) => c.ok), checks: results };
}

/**
 * Renders a DoctorResult to stdout.
 * JSON mode: emits the structured result via emit().
 * Human mode: prints [OK] / [FAIL] per check, then a summary line.
 */
export function renderDoctor(result: DoctorResult, opts: EmitOptions = {}): void {
  const mode = detectMode(opts);

  if (mode === "json") {
    emit(result, opts);
    return;
  }

  for (const check of result.checks) {
    const badge = check.ok ? "[OK]  " : "[FAIL]";
    process.stdout.write(`${badge} ${check.name}: ${check.detail}\n`);
  }

  const total = result.checks.length;
  const passed = result.checks.filter((c) => c.ok).length;
  process.stdout.write(`\n${passed}/${total} checks passed\n`);
}
