import { AppError } from "./cli/foundation/error-map.js";
import type { ClientOptions, Credentials, SpaceshipClient } from "./client.js";
import type { RateLimitState } from "./contract.js";
import { credentialStore, type CredentialSource, type CredentialStore } from "./keychain.js";
import { DEFAULT_PROFILE, type ProfileSelection } from "./profiles.js";
import type { Paged } from "./types.js";

export type ResolvedCredentials = {
  profile: ProfileSelection;
  apiKey: string | null;
  keySource: CredentialSource | null;
  apiSecret: string | null;
  secretSource: CredentialSource | null;
};

const DEFAULT_SELECTION: ProfileSelection = { name: DEFAULT_PROFILE, source: "default" };

/**
 * Finds both halves without judging whether they are enough, so `doctor` and
 * `auth status` can report what is set and where it came from.
 *
 * SPACESHIP_API_KEY and SPACESHIP_API_SECRET override stored credentials, so a
 * shell or a CI job can pick an account without touching the keychain. The one
 * thing they do not override is `--profile`: a flag typed on this command is a
 * clearer statement of intent than a variable exported some time ago, and a
 * write landing on the wrong account is the failure that matters here.
 */
export function resolveCredentials(
  profile: ProfileSelection = DEFAULT_SELECTION,
  env: NodeJS.ProcessEnv = process.env,
  store: CredentialStore = credentialStore,
): ResolvedCredentials {
  const explicit = profile.source === "flag";
  const envKey = explicit ? "" : (env.SPACESHIP_API_KEY?.trim() ?? "");
  const envSecret = explicit ? "" : (env.SPACESHIP_API_SECRET?.trim() ?? "");

  const key = envKey ? { value: envKey, source: "environment" as const } : store.apiKey(profile.name);
  const secret = envSecret
    ? { value: envSecret, source: "environment" as const }
    : store.apiSecret(profile.name);

  return {
    profile,
    apiKey: key?.value ?? null,
    keySource: key?.source ?? null,
    apiSecret: secret?.value ?? null,
    secretSource: secret?.source ?? null,
  };
}

/**
 * One word for previews and receipts: the profile a call is made as, or
 * "environment" when the variables won over whatever profile was selected.
 */
export function accountLabel(resolved: ResolvedCredentials): string {
  return resolved.keySource === "environment" || resolved.secretSource === "environment"
    ? "environment"
    : resolved.profile.name;
}

export type LoadedCredentials = Credentials & { account: string };

export function loadCredentials(
  profile: ProfileSelection = DEFAULT_SELECTION,
  env: NodeJS.ProcessEnv = process.env,
  store: CredentialStore = credentialStore,
): LoadedCredentials {
  const resolved = resolveCredentials(profile, env, store);

  if (!resolved.apiKey || !resolved.apiSecret) {
    if (profile.source !== "default") {
      throw new AppError("auth.missing-credentials", {
        name: "MissingCredentials",
        human: `No stored credentials for profile "${profile.name}".`,
        hint: `Run \`spaceship auth login --profile ${profile.name}\`. \`spaceship auth status\` lists the profiles that are stored.`,
      });
    }
    throw new AppError("auth.missing-credentials", {
      name: "MissingCredentials",
      human: "No API credentials found.",
      hint: "Run `spaceship auth login`, or set SPACESHIP_API_KEY and SPACESHIP_API_SECRET. Create a key at spaceship.com/application/api-manager/.",
    });
  }

  return { apiKey: resolved.apiKey, apiSecret: resolved.apiSecret, account: accountLabel(resolved) };
}

export type Verification = {
  /** How many domains the account holds, or null when the key may not list them. */
  domains: number | null;
  /** The API authenticated the key but refused the domains:read scope. */
  scoped: boolean;
  rateLimit: RateLimitState | null;
};

/**
 * Proves a pair against the API. A 403 counts as proof: the API authenticated
 * the key and only refused the scope, which is what a key issued for one job
 * (DNS only, say) looks like. A wrong key or secret is a 401 and still fails.
 */
export async function verifyCredentials(client: SpaceshipClient): Promise<Verification> {
  try {
    const { data, rateLimit } = await client.get<Paged<unknown>>("/v1/domains", { take: 1, skip: 0 });
    return { domains: data.total, scoped: false, rateLimit };
  } catch (error) {
    if (error instanceof AppError && error.code === "auth.missing-scope") {
      return { domains: null, scoped: true, rateLimit: null };
    }
    throw error;
  }
}

/**
 * SPACESHIP_API_URL redirects the client at a stand-in server. It exists for
 * integration tests and local mocks; production needs no configuration.
 */
export function clientOptions(env: NodeJS.ProcessEnv = process.env): ClientOptions {
  const baseUrl = env.SPACESHIP_API_URL?.trim();
  return baseUrl ? { baseUrl } : {};
}
