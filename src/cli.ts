import { parseArgv } from "./cli/foundation/argv.js";
import { printBanner } from "./cli/foundation/banner.js";
import { parseGlobalFlags } from "./cli/foundation/global-flags.js";
import { detectMode } from "./cli/platform/detect.js";
import { bold, dim, muted } from "./cli/platform/style.js";
import { SpaceshipClient } from "./client.js";
import { clientOptions, loadCredentials } from "./credentials.js";
import { EXIT, type ExitCode } from "./contract.js";
import { emitError, type EmitContext } from "./output/envelope.js";
import { runSchema } from "./commands/schema.js";
import { runDomainsList } from "./commands/domains-list.js";
import * as reads from "./commands/reads.js";
import { portfolioLint, portfolioRules } from "./commands/portfolio.js";
import * as writes from "./commands/writes.js";
import * as money from "./commands/money.js";
import type { MutateFlags } from "./mutate.js";
import { commandNames, OPERATIONS } from "./registry.js";
import { AppError } from "./cli/foundation/error-map.js";

const NAME = "spaceship";
const VERSION = "0.1.0";

function helpText(): string {
  const groups = new Map<string, string[]>();
  for (const op of OPERATIONS) {
    const [noun] = op.command.split(" ");
    if (!noun) continue;
    const bucket = groups.get(noun) ?? [];
    if (!bucket.includes(op.command)) bucket.push(op.command);
    groups.set(noun, bucket);
  }

  const lines = [
    `${dim("USAGE")}`,
    `  ${NAME} <noun> <verb> [args] [flags]`,
    "",
    `${dim("COMMANDS")}`,
  ];

  for (const [noun, commands] of groups) {
    lines.push(`  ${bold(noun.padEnd(10))} ${muted(commands.map((c) => c.split(" ").slice(1).join(" ")).filter(Boolean).join(", "))}`);
  }

  lines.push(
    "",
    `${dim("FLAGS")}`,
    `  --json          emit one JSON envelope on stdout (automatic when piped)`,
    `  --apply         perform a write; without it, mutations preview only`,
    `  --dry-run       show what would happen without calling the API`,
    `  --yes           approve a gated write without a prompt`,
    `  --confirm <id>  required for money and delete operations; must match the target`,
    `  --wait          poll an async operation until it settles`,
    `  --help          show this text`,
    "",
    `${dim("DISCOVERY")}`,
    `  ${NAME} schema --json     every operation, its tier, rate limit and scopes`,
    "",
  );
  return lines.join("\n");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<ExitCode> {
  const parsed = parseArgv(argv);
  const flags = parseGlobalFlags(parsed);
  const positional = parsed._;

  // Help and the bare invoke are diagnostics, so they go to stderr and leave
  // stdout clean for data. The banner rides the same stream and only appears
  // when a person is watching: never in JSON mode, never when piped.
  if (parsed.help === true || positional.length === 0) {
    if (detectMode(flags) !== "json") {
      printBanner({
        name: NAME,
        tagline: "agent-first CLI for the Spaceship registrar API",
        version: VERSION,
      });
    }
    process.stderr.write(`${helpText()}\n`);
    return positional.length === 0 && parsed.help !== true ? EXIT.usage : EXIT.ok;
  }

  const command = positional.slice(0, 2).join(" ");
  const isTriple = ["market safepay", "app env"].includes(command);
  const ctx: EmitContext = { command: isTriple ? positional.slice(0, 3).join(" ") : command, flags };

  try {
    if (command === "portfolio rules") {
      return portfolioRules({ ...ctx, command: "portfolio rules" });
    }

    if (positional[0] === "schema") {
      return runSchema({ ...ctx, command: "schema" }, { tier: parsed.tier as string | undefined });
    }

    // Every read command needs credentials, so the client is built once here.
    const rest = positional.slice(2);
    const arg = (index = 0): string | undefined => rest[index];

    const readHandlers: Record<string, (client: SpaceshipClient) => Promise<ExitCode>> = {
      "domains list": (client) =>
        runDomainsList(ctx, client, {
          limit: parsed.limit === undefined ? undefined : Number(parsed.limit),
          all: parsed.all === true,
        }),
      "portfolio lint": (client) =>
        portfolioLint(ctx, client, {
          only: typeof parsed.rule === "string" ? [parsed.rule] : undefined,
        }),
      "domains get": (client) => reads.domainsGet(ctx, client, arg()),
      "domains check": (client) => reads.domainsCheck(ctx, client, rest),
      "dns list": (client) => reads.dnsList(ctx, client, arg()),
      "ns list": (client) => reads.nsList(ctx, client, arg()),
      "ns get": (client) => reads.nsGet(ctx, client, arg(0), arg(1)),
      "transfer status": (client) => reads.transferStatus(ctx, client, arg()),
      "transfer auth-code": (client) => reads.transferAuthCode(ctx, client, arg()),
      "contacts get": (client) => reads.contactsGet(ctx, client, arg()),
      "contacts attrs-get": (client) => reads.contactsAttrsGet(ctx, client, arg()),
      "ops get": (client) => reads.opsGet(ctx, client, arg()),
      "market list": (client) => reads.marketList(ctx, client),
      "market get": (client) => reads.marketGet(ctx, client, arg()),
      "market sold": (client) => reads.marketSold(ctx, client),
      "market verify-records": (client) => reads.marketVerifyRecords(ctx, client),
      "app list": (client) => reads.appList(ctx, client),
      "app get": (client) => reads.appGet(ctx, client, arg()),
      "app logs": (client) => reads.appLogs(ctx, client, arg()),
      "app build-logs": (client) => reads.appBuildLogs(ctx, client, arg()),
      "app metrics": (client) => reads.appMetrics(ctx, client, arg()),
    };

    // Three-word commands: the noun carries two levels before its argument.
    const triple = positional.slice(0, 3).join(" ");
    const tripleHandlers: Record<string, (client: SpaceshipClient) => Promise<ExitCode>> = {
      "market safepay list": (client) => reads.marketSafepayList(ctx, client),
      "market safepay get": (client) => reads.marketSafepayGet(ctx, client, positional[3]),
      "app env get": (client) => reads.appEnvGet(ctx, client, positional[3]),
      "app env set": (client) => writes.appEnvSet(ctx, client, mutateFlags, parsed),
      "app scale": (client) => writes.appScale(ctx, client, mutateFlags, parsed),
      "market safepay create": (client) => money.marketSafepayCreate(ctx, client, mutateFlags, parsed),
    };

    // Writes take the same shape: the parsed argv plus the apply/confirm flags.
    const mutateFlags: MutateFlags = {
      apply: parsed.apply === true,
      dryRun: flags.dryRun === true,
      yes: parsed.yes === true,
      confirm: typeof parsed.confirm === "string" ? parsed.confirm : undefined,
      wait: parsed.wait === true,
      timeoutMs: parsed.timeout === undefined ? undefined : Number(parsed.timeout) * 1000,
    };

    const writeHandlers: Record<string, (client: SpaceshipClient) => Promise<ExitCode>> = {
      "domains autorenew": (client) => writes.domainsAutorenew(ctx, client, mutateFlags, parsed),
      "domains privacy": (client) => writes.domainsPrivacy(ctx, client, mutateFlags, parsed),
      "domains email-protection": (client) => writes.domainsEmailProtection(ctx, client, mutateFlags, parsed),
      "domains nameservers": (client) => writes.domainsNameservers(ctx, client, mutateFlags, parsed),
      "domains contacts": (client) => writes.domainsContacts(ctx, client, mutateFlags, parsed),
      "transfer lock": (client) => writes.transferLock(ctx, client, mutateFlags, parsed),
      "dns set": (client) => writes.dnsSet(ctx, client, mutateFlags, parsed),
      "dns delete": (client) => writes.dnsDelete(ctx, client, mutateFlags, parsed),
      "ns set": (client) => writes.nsSet(ctx, client, mutateFlags, parsed),
      "ns delete": (client) => writes.nsDelete(ctx, client, mutateFlags, parsed),
      "contacts save": (client) => writes.contactsSave(ctx, client, mutateFlags, parsed),
      "contacts attrs-save": (client) => writes.contactsAttrsSave(ctx, client, mutateFlags, parsed),
      "app build": (client) => writes.appBuild(ctx, client, mutateFlags, parsed),
      "app restart": (client) => writes.appRestart(ctx, client, mutateFlags, parsed),
      "domains register": (client) => money.domainsRegister(ctx, client, mutateFlags, parsed),
      "domains renew": (client) => money.domainsRenew(ctx, client, mutateFlags, parsed),
      "domains restore": (client) => money.domainsRestore(ctx, client, mutateFlags, parsed),
      "domains delete": (client) => money.domainsDelete(ctx, client, mutateFlags, parsed),
      "transfer start": (client) => money.transferStart(ctx, client, mutateFlags, parsed),
      "market add": (client) => money.marketAdd(ctx, client, mutateFlags, parsed),
      "market update": (client) => money.marketUpdate(ctx, client, mutateFlags, parsed),
      "market remove": (client) => money.marketRemove(ctx, client, mutateFlags, parsed),
      "market checkout-link": (client) => money.marketCheckoutLink(ctx, client, mutateFlags, parsed),
    };

    const writeHandler = writeHandlers[command];
    if (writeHandler) {
      const client = new SpaceshipClient(loadCredentials(), clientOptions());
      return await writeHandler(client);
    }

    const tripleHandler = tripleHandlers[triple];
    if (tripleHandler) {
      const client = new SpaceshipClient(loadCredentials(), clientOptions());
      return await tripleHandler(client);
    }

    const handler = readHandlers[command];
    if (handler) {
      const client = new SpaceshipClient(loadCredentials(), clientOptions());
      return await handler(client);
    }

    const known = commandNames();
    throw new AppError("usage", {
      name: "UnknownCommand",
      human: `Unknown command: ${command}`,
      hint: known.some((c) => c.startsWith(positional[0] ?? ""))
        ? `Did you mean one of: ${known.filter((c) => c.startsWith(positional[0] ?? "")).slice(0, 4).join(", ")}?`
        : `Run \`${NAME} schema\` to see every command.`,
    });
  } catch (error) {
    return emitError(ctx, error);
  }
}

// Only self-execute when run as a program, so tests can import main().
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? " ")) {
  main().then((code) => {
    process.exitCode = code;
  });
}

export { detectMode };
