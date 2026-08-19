import { AppError } from "./cli/foundation/error-map.js";
import type { ClientOptions, Credentials } from "./client.js";

/**
 * Identifiers may be persisted; the secret is read from the environment or the
 * OS keychain and never written into the project's config file.
 */
export function loadCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  const apiKey = env.SPACESHIP_API_KEY?.trim();
  const apiSecret = env.SPACESHIP_API_SECRET?.trim();

  if (!apiKey || !apiSecret) {
    throw new AppError("auth.missing-credentials", {
      name: "MissingCredentials",
      human: "No API credentials found.",
      hint: "Set SPACESHIP_API_KEY and SPACESHIP_API_SECRET, or run `spaceship auth login`. Create a key at spaceship.com/application/api-manager/.",
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
