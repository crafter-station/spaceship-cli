import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { AppError } from "../cli/foundation/error-map.js";
import { promptSecret } from "../cli/agent/prompt-secret.js";
import { loadConfig, saveConfig } from "../cli/foundation/config.js";
import { bold, dim, muted, ok, warn } from "../cli/platform/style.js";
import { SpaceshipClient } from "../client.js";
import { clientOptions } from "../credentials.js";
import { EXIT, type ExitCode } from "../contract.js";
import { emitResult, type EmitContext } from "../output/envelope.js";
import { paths } from "../audit.js";
import type { Paged } from "../types.js";

/**
 * Credentials are an API key and a secret. The key identifies the credential
 * and may be stored in the config file; the secret proves it and goes to the OS
 * keychain, never to a file in a repo.
 */

const SERVICE = "spaceship-cli";
const KEY_ACCOUNT = "api_key";
const SECRET_ACCOUNT = "api_secret";

type StoredConfig = Record<string, unknown> & { apiKey?: string };

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

// --------------------------------------------------------------- keychain

const hasKeychain = (): boolean => platform() === "darwin";

function keychainRead(account: string): string | null {
  if (!hasKeychain()) return null;
  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", SERVICE, "-a", account, "-w"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function keychainWrite(account: string, value: string): boolean {
  if (!hasKeychain()) return false;
  // -U updates in place when the entry already exists. The value is passed as
  // an argument to `security` only; it is never written to a file or a log.
  const result = spawnSync(
    "security",
    ["add-generic-password", "-s", SERVICE, "-a", account, "-w", value, "-U"],
    { encoding: "utf8" },
  );
  return result.status === 0;
}

function keychainDelete(account: string): boolean {
  if (!hasKeychain()) return false;
  const result = spawnSync("security", ["delete-generic-password", "-s", SERVICE, "-a", account], {
    encoding: "utf8",
  });
  return result.status === 0;
}

// ------------------------------------------------------------ stored config

export function storedApiKey(): string | null {
  const fromKeychain = keychainRead(KEY_ACCOUNT);
  if (fromKeychain) return fromKeychain;
  const config = loadConfig<StoredConfig>(paths().config);
  return typeof config.apiKey === "string" && config.apiKey !== "" ? config.apiKey : null;
}

export const storedApiSecret = (): string | null => keychainRead(SECRET_ACCOUNT);

/** Masked for display: enough to recognise the key, not enough to use it. */
const maskKey = (key: string): string =>
  key.length <= 8 ? "•".repeat(key.length) : `${key.slice(0, 4)}${"•".repeat(key.length - 8)}${key.slice(-4)}`;

// ----------------------------------------------------------------- commands

export async function authLogin(ctx: EmitContext, args: Record<string, unknown>): Promise<ExitCode> {
  const flagKey = typeof args.key === "string" ? args.key : undefined;
  const flagSecret = typeof args.secret === "string" ? args.secret : undefined;

  // A secret on the command line lands in shell history and the process table,
  // so it is accepted but called out.
  if (flagSecret) {
    process.stderr.write(
      `${warn("note")}  A secret passed as a flag stays in your shell history. Prefer the prompt.\n`,
    );
  }

  const apiKey = flagKey ?? (await promptSecret("API key: ", { mask: "" }));
  if (!apiKey) {
    throw new AppError("usage", {
      name: "NoTTY",
      human: "Cannot prompt for credentials without a terminal.",
      hint: "Pass --key and --secret, or set SPACESHIP_API_KEY and SPACESHIP_API_SECRET.",
    });
  }

  const apiSecret = flagSecret ?? (await promptSecret("API secret: "));
  if (!apiSecret) {
    throw new AppError("usage", {
      name: "NoTTY",
      human: "Cannot prompt for the secret without a terminal.",
      hint: "Pass --secret, or set SPACESHIP_API_SECRET.",
    });
  }

  // Verified against the API before being stored, so a typo fails here rather
  // than on the next command.
  const client = new SpaceshipClient({ apiKey, apiSecret }, clientOptions());
  const { data } = await client.get<Paged<unknown>>("/v1/domains", { take: 1, skip: 0 });

  // Both halves go to the keychain. The key is not secret on its own, but
  // keeping the pair together means one place to rotate and one to revoke.
  const savedToKeychain = keychainWrite(SECRET_ACCOUNT, apiSecret) && keychainWrite(KEY_ACCOUNT, apiKey);
  if (!savedToKeychain) saveConfig(paths().config, { defaults: { apiKey } });

  return emitResult(
    ctx,
    {
      verified: true,
      apiKey: maskKey(apiKey),
      domains: data.total,
      secretStoredIn: savedToKeychain ? "keychain" : "environment only",
    },
    {
      nextSteps: [{ command: "spaceship domains list", reason: "See what the account holds" }],
    },
    (result) => {
      line(`\n${ok("signed in")}  ${muted(`${result.domains} domain${result.domains === 1 ? "" : "s"} in this account`)}`);
      line(`  ${dim("key")}     ${result.apiKey}`);
      if (savedToKeychain) {
        line(`  ${dim("secret")}  stored in your keychain\n`);
      } else {
        line(`  ${dim("secret")}  ${warn("not stored")}`);
        line(`  ${muted("No OS keychain here. Set SPACESHIP_API_SECRET in your environment.")}\n`);
      }
    },
  );
}

export function authStatus(ctx: EmitContext): ExitCode {
  const envKey = process.env.SPACESHIP_API_KEY;
  const envSecret = process.env.SPACESHIP_API_SECRET;
  const keychainKey = keychainRead(KEY_ACCOUNT);
  const config = loadConfig<StoredConfig>(paths().config);
  const configKey = typeof config.apiKey === "string" && config.apiKey !== "" ? config.apiKey : null;
  const keychainSecret = keychainRead(SECRET_ACCOUNT);

  const apiKey = envKey ?? keychainKey ?? configKey;
  const hasSecret = Boolean(envSecret ?? keychainSecret);

  return emitResult(
    ctx,
    {
      authenticated: Boolean(apiKey) && hasSecret,
      apiKey: apiKey ? maskKey(apiKey) : null,
      keySource: envKey ? "environment" : keychainKey ? "keychain" : configKey ? "config file" : null,
      secretSource: envSecret ? "environment" : keychainSecret ? "keychain" : null,
    },
    {
      nextSteps: apiKey && hasSecret ? [] : [{ command: "spaceship auth login", reason: "Store credentials" }],
    },
    (result) => {
      line("");
      if (!result.authenticated) {
        line(`${warn("not signed in")}`);
        line(`  ${muted("Run")} spaceship auth login`);
        line("");
        return;
      }
      line(`${ok("signed in")}`);
      line(`  ${dim("key")}     ${result.apiKey} ${muted(`(from ${result.keySource})`)}`);
      line(`  ${dim("secret")}  ${muted(`from ${result.secretSource}`)}`);
      line("");
    },
  );
}

export function authLogout(ctx: EmitContext): ExitCode {
  const removed = keychainDelete(SECRET_ACCOUNT);
  keychainDelete(KEY_ACCOUNT);
  saveConfig(paths().config, { defaults: { apiKey: "" } });

  return emitResult(ctx, { cleared: true, secretRemoved: removed }, {}, (result) => {
    line(`\n${ok("signed out")}`);
    if (!result.secretRemoved) {
      line(`  ${muted("No stored secret to remove.")}`);
    }
    if (process.env.SPACESHIP_API_SECRET) {
      // Clearing storage does not unset an exported variable, and saying
      // "signed out" while the next command still works would be a lie.
      line(`  ${warn("SPACESHIP_API_SECRET is still set in this shell.")}`);
    }
    line("");
  });
}

export function authWhoami(ctx: EmitContext): ExitCode {
  return authStatus({ ...ctx, command: "auth whoami" });
}

export { EXIT, bold };
