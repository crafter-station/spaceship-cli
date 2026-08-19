import { AppError } from "./cli/foundation/error-map.js";
import type { ClientOptions, Credentials } from "./client.js";
import { storedApiKey, storedApiSecret } from "./commands/auth.js";

/**
 * Identifiers may be persisted; the secret is read from the environment or the
 * OS keychain and never written into the project's config file.
 */
export function loadCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  // Environment first, so a shell can override stored credentials without
  // changing them; then whatever `auth login` saved.
  const apiKey = env.SPACESHIP_API_KEY?.trim() || storedApiKey() || undefined;
  const apiSecret = env.SPACESHIP_API_SECRET?.trim() || storedApiSecret() || undefined;

  if (!apiKey || !apiSecret) {
    throw new AppError("auth.missing-credentials", {
      name: "MissingCredentials",
      human: "No API credentials found.",
      hint: "Run `spaceship auth login`, or set SPACESHIP_API_KEY and SPACESHIP_API_SECRET. Create a key at spaceship.com/application/api-manager/.",
    });
  }

  return { apiKey, apiSecret };
}

/**
 * SPACESHIP_API_URL redirects the client at a stand-in server. It exists for
 * integration tests and local mocks; production needs no configuration.
 */
export function clientOptions(env: NodeJS.ProcessEnv = process.env): ClientOptions {
  const baseUrl = env.SPACESHIP_API_URL?.trim();
  return baseUrl ? { baseUrl } : {};
}
