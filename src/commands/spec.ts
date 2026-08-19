import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../cli/foundation/error-map.js";
import { atomicWrite } from "../cli/foundation/atomic-write.js";
import { bold, danger, dim, muted, ok, warn } from "../cli/platform/style.js";
import { EXIT, type ExitCode } from "../contract.js";
import { emitResult, type EmitContext } from "../output/envelope.js";
import { table } from "../output/table.js";
import { fetchSpec } from "../spec/extract.js";
import { canonical, normalize } from "../spec/normalize.js";
import { diffSpecs, type Change, type Severity } from "../spec/diff.js";

/**
 * Two files are kept. `raw.json` is the document Spaceship served, which is the
 * evidence when something breaks and the claim is "the API changed". The diff
 * runs over the normalized view derived from it.
 */

const specDir = (): string => {
  // Walks up from this module to the package root, so the same code resolves
  // whether it runs from src/ during development or dist/ once built.
  let dir = fileURLToPath(new URL(".", import.meta.url));
  for (let depth = 0; depth < 5; depth++) {
    if (existsSync(join(dir, "spec", "raw.json"))) return join(dir, "spec");
    dir = join(dir, "..");
  }
  return join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "spec");
};

const rawPath = (): string => join(specDir(), "raw.json");

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

export const hashOf = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex").slice(0, 16);

function readSnapshot(): Record<string, unknown> {
  const path = rawPath();
  if (!existsSync(path)) {
    throw new AppError("spec.missing", {
      name: "NoSnapshot",
      human: "No spec snapshot on disk.",
      hint: "Run `spaceship spec snapshot` to record the current API surface.",
    });
  }
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export async function specSnapshot(
  ctx: EmitContext,
  args: { url?: string; write?: boolean } = {},
): Promise<ExitCode> {
  const fetched = await fetchSpec({ url: args.url });
  const normalized = normalize(fetched.spec);
  const hash = hashOf(normalized);

  const previous = existsSync(rawPath()) ? hashOf(normalize(readSnapshot())) : null;
  const changed = previous !== null && previous !== hash;

  if (args.write !== false) {
    atomicWrite(rawPath(), `${JSON.stringify(fetched.spec, null, 2)}\n`);
  }

  return emitResult(
    ctx,
    {
      hash,
      previousHash: previous,
      changed,
      operations: Object.keys(normalized.operations).length,
      lastModified: fetched.lastModified,
      fetchedAt: fetched.fetchedAt,
      written: args.write !== false,
    },
    {
      nextSteps: changed ? [{ command: "spaceship spec diff", reason: "See what moved" }] : [],
    },
    (result) => {
      line(`\n${ok("snapshot")}  ${muted(`${result.operations} operations`)}`);
      line(`  ${dim("hash")}      ${result.hash}`);
      if (result.lastModified) line(`  ${dim("modified")}  ${result.lastModified}`);
      line(
        `  ${dim("status")}    ${result.changed ? warn("differs from the previous snapshot") : muted("unchanged")}\n`,
      );
    },
  );
}

const paint: Record<Severity, (t: string) => string> = {
  breaking: danger,
  warning: warn,
  info: muted,
};

export async function specDiff(
  ctx: EmitContext,
  args: { url?: string } = {},
): Promise<ExitCode> {
  const snapshot = normalize(readSnapshot());
  const fetched = await fetchSpec({ url: args.url });
  const live = normalize(fetched.spec);

  const report = diffSpecs(snapshot, live);
  const exit = report.counts.breaking > 0 ? EXIT.runtime : EXIT.ok;

  emitResult(
    ctx,
    {
      ...report,
      snapshotHash: hashOf(snapshot),
      liveHash: hashOf(live),
      lastModified: fetched.lastModified,
    },
    {
      nextSteps: report.changed
        ? [{ command: "spaceship spec snapshot", reason: "Record the new surface once the changes are handled" }]
        : [],
    },
    (result) => {
      if (!result.changed) {
        line(`\n${ok("no drift")}  ${muted("the live spec matches the snapshot")}\n`);
        return;
      }

      // Grouped by severity so the first thing read is what breaks.
      line("");
      for (const severity of ["breaking", "warning", "info"] as const) {
        const group = result.changes.filter((change: Change) => change.severity === severity);
        if (group.length === 0) continue;

        line(`${paint[severity](severity)} ${muted(`(${group.length})`)}`);
        for (const row of table(group, [
          { header: "what", render: (c) => bold(c.subject), max: 42 },
          { header: "change", render: (c) => c.detail, max: 46 },
          { header: "affects", render: (c) => (c.commands.length > 0 ? muted(c.commands.join(", ")) : "") },
        ])) {
          line(`  ${row}`);
        }
        line("");
      }

      const { breaking, warning, info } = result.counts;
      const parts = [
        breaking > 0 ? danger(`${breaking} breaking`) : "",
        warning > 0 ? warn(`${warning} warning`) : "",
        info > 0 ? muted(`${info} info`) : "",
      ].filter(Boolean);
      line(`${parts.join(muted(" · "))}\n`);
      if (breaking > 0) {
        line(`${muted("Breaking changes affect commands this CLI ships. Fix them before releasing.")}\n`);
      }
    },
  );

  return exit;
}

export { EXIT };
