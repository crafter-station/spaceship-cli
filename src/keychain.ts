import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { paths } from "./audit.js";
import { listProfiles, loadConfig, readProfile, removeProfile, saveConfig } from "./cli/foundation/config.js";
import { DEFAULT_PROFILE, defaultProfile, setDefaultProfile } from "./profiles.js";

/**
 * Where credentials live. The secret goes to the OS keychain and nowhere else.
 * The key is not secret on its own but rides along, so a profile is one thing
 * to rotate and one to revoke. Without a keychain the key falls back to the
 * config file and the secret has to come from the environment.
 *
 * Each profile is its own pair of keychain entries. The default profile keeps
 * the account names the first release used, so an existing login still works.
 */

const SERVICE = "spaceship-cli";

export type CredentialSource = "environment" | "keychain" | "config file";
export type StoredValue = { value: string; source: CredentialSource };

/** Reads one half of a profile's credentials, or null when it is not stored. */
export type CredentialStore = {
  apiKey(profile: string): StoredValue | null;
  apiSecret(profile: string): StoredValue | null;
};

/**
 * The secret-holding side, split out so tests can swap the real keychain for
 * a map instead of touching the machine they run on.
 */
export type Keychain = {
  available(): boolean;
  read(account: string): string | null;
  write(account: string, value: string): boolean;
  delete(account: string): boolean;
};

type StoredConfig = Record<string, unknown> & { apiKey?: string; profile?: string };

/** Keychain account per profile: `api_key` for default, `work/api_key` for the rest. */
export const keychainAccount = (profile: string, half: "api_key" | "api_secret"): string =>
  profile === DEFAULT_PROFILE ? half : `${profile}/${half}`;

// ------------------------------------------------------------ macOS backend

const onMac = (): boolean => platform() === "darwin";

export const macKeychain: Keychain = {
  available: onMac,

  read(account) {
    if (!onMac()) return null;
    const result = spawnSync(
      "security",
      ["find-generic-password", "-s", SERVICE, "-a", account, "-w"],
      { encoding: "utf8" },
    );
    if (result.status !== 0) return null;
    return result.stdout.trim() || null;
  },

  write(account, value) {
    if (!onMac()) return false;
    // -U updates in place when the entry already exists. The value is passed as
    // an argument to `security` only; it is never written to a file or a log.
    const result = spawnSync(
      "security",
      ["add-generic-password", "-s", SERVICE, "-a", account, "-w", value, "-U"],
      { encoding: "utf8" },
    );
    return result.status === 0;
  },

  delete(account) {
    if (!onMac()) return false;
    const result = spawnSync("security", ["delete-generic-password", "-s", SERVICE, "-a", account], {
      encoding: "utf8",
    });
    return result.status === 0;
  },
};

export const hasKeychain = (keychain: Keychain = macKeychain): boolean => keychain.available();

// -------------------------------------------------------------- config file

/** The key's home when there is no keychain: `defaults` for the default profile, its own section otherwise. */
function configKey(profile: string): string | null {
  const entry =
    profile === DEFAULT_PROFILE
      ? loadConfig<StoredConfig>(paths().config)
      : readProfile<StoredConfig>(paths().config, profile);
  return typeof entry?.apiKey === "string" && entry.apiKey !== "" ? entry.apiKey : null;
}

/**
 * Named profiles always get a section in the config file, even an empty one,
 * because the keychain cannot be listed cheaply and `auth status` has to say
 * which profiles exist. The default profile needs no section: its keychain
 * entries predate profiles, and it is looked up by name.
 */
function rememberProfile(profile: string, apiKey: string | null): void {
  if (profile === DEFAULT_PROFILE) {
    if (apiKey) saveConfig(paths().config, { defaults: { apiKey } });
    return;
  }
  saveConfig(paths().config, { profiles: { [profile]: apiKey ? { apiKey } : {} } });
}

// ------------------------------------------------------------------- store

export function makeCredentialStore(keychain: Keychain = macKeychain): CredentialStore {
  return {
    apiKey(profile) {
      const fromKeychain = keychain.read(keychainAccount(profile, "api_key"));
      if (fromKeychain) return { value: fromKeychain, source: "keychain" };
      const fromConfig = configKey(profile);
      return fromConfig ? { value: fromConfig, source: "config file" } : null;
    },
    apiSecret(profile) {
      const fromKeychain = keychain.read(keychainAccount(profile, "api_secret"));
      return fromKeychain ? { value: fromKeychain, source: "keychain" } : null;
    },
  };
}

export const credentialStore: CredentialStore = makeCredentialStore();

/**
 * Stores a verified pair and returns where it landed. Without a keychain only
 * the key is kept; the caller tells the user to export the secret instead.
 */
export function storeCredentials(
  profile: string,
  apiKey: string,
  apiSecret: string,
  keychain: Keychain = macKeychain,
): "keychain" | "config file" {
  const inKeychain =
    keychain.write(keychainAccount(profile, "api_secret"), apiSecret) &&
    keychain.write(keychainAccount(profile, "api_key"), apiKey);
  rememberProfile(profile, inKeychain ? null : apiKey);
  return inKeychain ? "keychain" : "config file";
}

export function forgetCredentials(
  profile: string,
  keychain: Keychain = macKeychain,
): { secretRemoved: boolean } {
  const secretRemoved = keychain.delete(keychainAccount(profile, "api_secret"));
  keychain.delete(keychainAccount(profile, "api_key"));
  if (profile === DEFAULT_PROFILE) saveConfig(paths().config, { defaults: { apiKey: "" } });
  else removeProfile(paths().config, profile);
  // A default pointing at a profile that no longer exists would make every
  // command fail with "no credentials", so it falls back with the removal.
  if (defaultProfile() === profile) setDefaultProfile(DEFAULT_PROFILE);
  return { secretRemoved };
}

/** Every profile with stored credentials, the default first. */
export function storedProfiles(store: CredentialStore = credentialStore): string[] {
  const named = listProfiles(paths().config)
    .filter((name) => name !== DEFAULT_PROFILE)
    .sort();
  const hasDefault = store.apiKey(DEFAULT_PROFILE) !== null;
  return hasDefault ? [DEFAULT_PROFILE, ...named] : named;
}
