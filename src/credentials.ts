import { AppError } from "./cli/foundation/error-map.js";
import type { Credentials } from "./client.js";

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
