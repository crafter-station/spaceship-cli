import { paths } from "./audit.js";
import { loadConfig, saveConfig } from "./cli/foundation/config.js";
import { AppError } from "./cli/foundation/error-map.js";

/**
 * A profile is a named credential pair, so one machine can hold a personal
 * account and a company account without swapping keys around. `default` is
 * what every command uses until another profile is named.
 */

export const DEFAULT_PROFILE = "default";

/** How the active profile was chosen, from most to least deliberate. */
export type ProfileSource = "flag" | "env" | "config" | "default";

export type ProfileSelection = { name: string; source: ProfileSource };

// A name becomes a keychain account and a JSON key, so it stays to characters
// that survive both without quoting. "environment" is what receipts say when
// SPACESHIP_API_KEY overrides a stored profile, so no profile may claim it.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const RESERVED_PROFILE_NAMES: ReadonlySet<string> = new Set(["environment"]);

export const isValidProfileName = (name: string): boolean =>
  NAME.test(name) && !RESERVED_PROFILE_NAMES.has(name);

export function assertProfileName(name: string, from: string): string {
  if (isValidProfileName(name)) return name;
  throw new AppError("usage", {
    name: "InvalidProfile",
    human: `"${name}" is not a valid profile name (from ${from}).`,
    hint: "Use letters, digits, dots, dashes or underscores, e.g. --profile work.",
  });
}

type ProfileConfig = Record<string, unknown> & { profile?: string };

/** The profile chosen with `auth use`, or `default` when none was. */
export function defaultProfile(configDir: string = paths().config): string {
  const stored = loadConfig<ProfileConfig>(configDir).profile;
  return typeof stored === "string" && stored !== "" ? stored : DEFAULT_PROFILE;
}

export function setDefaultProfile(name: string, configDir: string = paths().config): void {
  saveConfig(configDir, { defaults: { profile: name } });
}

/**
 * Picks the active profile. `--profile` beats SPACESHIP_PROFILE, which beats
 * the one chosen with `auth use`, which beats `default`.
 */
export function selectProfile(
  flag: unknown,
  env: NodeJS.ProcessEnv = process.env,
  configDir: string = paths().config,
): ProfileSelection {
  if (flag === true) {
    throw new AppError("usage", {
      name: "InvalidProfile",
      human: "--profile needs a name.",
      hint: "e.g. --profile work. `spaceship auth status` lists the stored profiles.",
    });
  }
  if (typeof flag === "string") return { name: assertProfileName(flag, "--profile"), source: "flag" };

  const fromEnv = env.SPACESHIP_PROFILE?.trim();
  if (fromEnv) return { name: assertProfileName(fromEnv, "SPACESHIP_PROFILE"), source: "env" };

  const fromConfig = defaultProfile(configDir);
  if (fromConfig !== DEFAULT_PROFILE) {
    return { name: assertProfileName(fromConfig, "the config file"), source: "config" };
  }
  return { name: DEFAULT_PROFILE, source: "default" };
}

/** For a human: where the active profile came from. */
export function describeProfileSource(source: ProfileSource): string {
  switch (source) {
    case "flag":
      return "--profile";
    case "env":
      return "SPACESHIP_PROFILE";
    case "config":
      return "auth use";
    case "default":
      return "default";
  }
}
