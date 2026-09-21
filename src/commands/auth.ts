import { AppError } from "../cli/foundation/error-map.js";
import { promptSecret } from "../cli/agent/prompt-secret.js";
import { bold, dim, muted, ok, warn } from "../cli/platform/style.js";
import { SpaceshipClient } from "../client.js";
import { accountLabel, clientOptions, resolveCredentials } from "../credentials.js";
import type { ExitCode } from "../contract.js";
import { forgetCredentials, hasKeychain, storeCredentials, storedProfiles } from "../keychain.js";
import { emitResult, type EmitContext } from "../output/envelope.js";
import {
  assertProfileName,
  DEFAULT_PROFILE,
  describeProfileSource,
  type ProfileSelection,
  setDefaultProfile,
} from "../profiles.js";
import type { Paged } from "../types.js";

/**
 * Credentials are an API key and a secret, kept per profile. The key
 * identifies the credential, the secret proves it, and both go to the OS
 * keychain, never to a file in a repo. Every command here acts on the active
 * profile, so `auth login --profile work` and `auth logout --profile work`
 * touch that one and nothing else.
 */

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

/** Masked for display: enough to recognise the key, not enough to use it. */
const maskKey = (key: string): string =>
  key.length <= 8 ? "•".repeat(key.length) : `${key.slice(0, 4)}${"•".repeat(key.length - 8)}${key.slice(-4)}`;

/** The flag to repeat so the next command lands on the same profile. */
const profileFlag = (profile: ProfileSelection): string =>
  profile.source === "flag" ? ` --profile ${profile.name}` : "";

const describeProfile = (profile: ProfileSelection): string =>
  profile.source === "default" ? profile.name : `${profile.name} ${muted(`(${describeProfileSource(profile.source)})`)}`;

// ----------------------------------------------------------------- commands

export async function authLogin(
  ctx: EmitContext,
  args: Record<string, unknown>,
  profile: ProfileSelection,
): Promise<ExitCode> {
  // A second profile needs a second secret somewhere, and the config file is
  // not that place. Better to say so before asking the user to paste anything.
  if (profile.name !== DEFAULT_PROFILE && !hasKeychain()) {
    throw new AppError("usage", {
      name: "NoKeychain",
      human: "Named profiles need an OS keychain to hold each secret, and this platform has none.",
      hint: "Use SPACESHIP_API_KEY and SPACESHIP_API_SECRET per shell instead.",
    });
  }

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

  const savedToKeychain = storeCredentials(profile.name, apiKey, apiSecret) === "keychain";

  return emitResult(
    ctx,
    {
      verified: true,
      profile: profile.name,
      apiKey: maskKey(apiKey),
      domains: data.total,
      secretStoredIn: savedToKeychain ? "keychain" : "environment only",
    },
    {
      nextSteps: [
        { command: `spaceship domains list${profileFlag(profile)}`, reason: "See what the account holds" },
        ...(profile.source === "flag"
          ? [{ command: `spaceship auth use ${profile.name}`, reason: "Make it the default for every command" }]
          : []),
      ],
    },
    (result) => {
      line(`\n${ok("signed in")}  ${muted(`${result.domains} domain${result.domains === 1 ? "" : "s"} in this account`)}`);
      line(`  ${dim("profile")}  ${result.profile}`);
      line(`  ${dim("key")}      ${result.apiKey}`);
      if (savedToKeychain) {
        line(`  ${dim("secret")}   stored in your keychain\n`);
      } else {
        line(`  ${dim("secret")}   ${warn("not stored")}`);
        line(`  ${muted("No OS keychain here. Set SPACESHIP_API_SECRET in your environment.")}\n`);
      }
    },
  );
}

export function authStatus(ctx: EmitContext, profile: ProfileSelection): ExitCode {
  const resolved = resolveCredentials(profile);
  const account = accountLabel(resolved);
  const profiles = storedProfiles();
  const authenticated = Boolean(resolved.apiKey && resolved.apiSecret);

  // A profile picked by SPACESHIP_PROFILE or `auth use` loses to credentials
  // in the environment. Saying so beats letting the user believe it is in play.
  const overridden = authenticated && account === "environment" && profile.source !== "default";

  return emitResult(
    ctx,
    {
      authenticated,
      profile: profile.name,
      profileSource: profile.source,
      account,
      apiKey: resolved.apiKey ? maskKey(resolved.apiKey) : null,
      keySource: resolved.keySource,
      secretSource: resolved.secretSource,
      profiles,
    },
    {
      nextSteps: authenticated
        ? []
        : [{ command: `spaceship auth login${profileFlag(profile)}`, reason: "Store credentials" }],
    },
    (result) => {
      line("");
      if (!result.authenticated) {
        line(`${warn("not signed in")}`);
        line(`  ${dim("profile")}  ${describeProfile(profile)}`);
        line(`  ${muted("Run")} spaceship auth login${profileFlag(profile)}`);
        if (result.profiles.length > 0) line(`  ${dim("stored")}   ${muted(result.profiles.join(", "))}`);
        line("");
        return;
      }
      line(`${ok("signed in")}`);
      line(`  ${dim("profile")}  ${describeProfile(profile)}`);
      line(`  ${dim("key")}      ${result.apiKey} ${muted(`(from ${result.keySource})`)}`);
      line(`  ${dim("secret")}   ${muted(`from ${result.secretSource}`)}`);
      if (result.profiles.length > 0) line(`  ${dim("stored")}   ${muted(result.profiles.join(", "))}`);
      if (overridden) {
        line(
          `  ${warn("note")}     SPACESHIP_API_KEY is set, so the environment wins over profile "${profile.name}". Pass --profile ${profile.name} to use the stored one.`,
        );
      }
      line("");
    },
  );
}

export function authWhoami(ctx: EmitContext, profile: ProfileSelection): ExitCode {
  return authStatus({ ...ctx, command: "auth whoami" }, profile);
}

export function authLogout(ctx: EmitContext, profile: ProfileSelection): ExitCode {
  const { secretRemoved } = forgetCredentials(profile.name);

  return emitResult(ctx, { cleared: true, profile: profile.name, secretRemoved }, {}, (result) => {
    line(`\n${ok("signed out")}  ${muted(`profile ${result.profile}`)}`);
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

/** Makes a stored profile the one every command uses until changed. */
export function authUse(ctx: EmitContext, name: string | undefined): ExitCode {
  if (!name) {
    throw new AppError("usage", {
      name: "MissingProfile",
      human: "auth use needs a profile name.",
      hint: "`spaceship auth status` lists the stored profiles.",
    });
  }
  assertProfileName(name, "auth use");

  // `default` is always allowed: it is how a user gets back to plain behaviour
  // even after the profile they were using has been logged out.
  const profiles = storedProfiles();
  if (name !== DEFAULT_PROFILE && !profiles.includes(name)) {
    throw new AppError("not-found", {
      name: "UnknownProfile",
      human: `No profile "${name}" is stored.`,
      hint:
        profiles.length > 0
          ? `Stored: ${profiles.join(", ")}. Add one with \`spaceship auth login --profile ${name}\`.`
          : `Add it with \`spaceship auth login --profile ${name}\`.`,
    });
  }

  setDefaultProfile(name);
  const envWins = Boolean(process.env.SPACESHIP_API_KEY || process.env.SPACESHIP_API_SECRET);

  return emitResult(
    ctx,
    { profile: name },
    { nextSteps: [{ command: "spaceship auth status", reason: "Confirm which credentials are in play" }] },
    () => {
      line(`\n${ok("using")}  ${bold(name)} ${muted("for every command until changed")}`);
      if (envWins) {
        line(
          `  ${warn("SPACESHIP_API_KEY is set in this shell and still wins.")} ${muted(`Unset it, or pass --profile ${name}.`)}`,
        );
      }
      line("");
    },
  );
}
