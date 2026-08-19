import { CONTRACT_VERSION, EXIT, type ExitCode } from "../contract.js";
import { OPERATIONS, type Operation, type Tier } from "../registry.js";
import { emitResult, type EmitContext } from "../output/envelope.js";
import { grouped } from "../output/table.js";
import { bold, dim, muted, warn, danger, ok as okColor } from "../cli/platform/style.js";

/**
 * The surface as data. An agent introspects here instead of parsing --help,
 * and it lists every operation the CLI knows about, including any not yet
 * implemented, so the drift linter can tell a new endpoint from a changed one.
 */

const TIER_MEANING: Record<Tier, string> = {
  T0: "read only, no gate",
  T1: "reversible write, needs --apply",
  T2: "destructive, needs --apply and confirmation",
  T3: "money or domain loss, needs --apply, --confirm and an audit entry",
};

const TIER_ORDER: Tier[] = ["T0", "T1", "T2", "T3"];

function paintTier(tier: Tier): string {
  if (tier === "T0") return muted(tier);
  if (tier === "T1") return okColor(tier);
  if (tier === "T2") return warn(tier);
  return danger(tier);
}

export function runSchema(ctx: EmitContext, args: { tier?: string }): ExitCode {
  const filtered = args.tier
    ? OPERATIONS.filter((op) => op.tier === args.tier?.toUpperCase())
    : OPERATIONS;

  const payload = {
    contractVersion: CONTRACT_VERSION,
    operationCount: filtered.length,
    tiers: TIER_MEANING,
    operations: filtered,
  };

  emitResult(ctx, payload, {}, (data) => {
    const unique = [...new Map(data.operations.map((op) => [op.command, op])).values()];
    process.stdout.write(
      `${bold("spaceship")} ${muted(`— ${unique.length} commands over ${data.operationCount} API operations, contract v${data.contractVersion}`)}\n\n`,
    );

    // One command mapped to two endpoints (`domains check` covers the single
    // and bulk paths) is one row for a reader, not two.
    const lines = grouped<Operation>(
      unique,
      (op) => op.tier,
      [
        { header: "command", render: (op) => bold(op.command), max: 26 },
        { header: "what it does", render: (op) => op.description, max: 44 },
        { header: "async", render: (op) => (op.async ? dim("--wait") : "") },
      ],
      { order: TIER_ORDER },
    );

    // The tier legend is derived from the same map the rows are grouped by, so
    // it cannot drift from what is displayed.
    for (const line of lines) {
      const tier = TIER_ORDER.find((t) => line.startsWith(t));
      if (tier) {
        process.stdout.write(`${paintTier(tier)} ${muted(TIER_MEANING[tier])}\n`);
        continue;
      }
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write("\n");
  });

  return EXIT.ok;
}
