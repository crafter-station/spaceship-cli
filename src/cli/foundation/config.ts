// cligentic block: config
//
// Profile-aware config loader. Reads JSON config from the app's config
// directory with support for multiple profiles (dev, staging, production).
//
// Precedence: env vars > CLI flags > profile config > default config.
//
// Usage:
//   import { loadConfig, saveConfig } from "./foundation/config";
//
//   const config = loadConfig<MyConfig>(paths.config, "production");
//   // reads ~/.config/myapp/config.json, merges profile "production"

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./atomic-write.js";

export type ConfigFile<T> = {
  defaults?: Partial<T>;
  profiles?: Record<string, Partial<T>>;
};

/**
 * Loads config from a JSON file at {configDir}/config.json.
 * Merges: defaults <- profile overrides <- env overrides.
 *
 * Returns the defaults if no config file exists (never throws for missing file).
 */
export function loadConfig<T extends Record<string, unknown>>(
  configDir: string,
  profile?: string,
): T {
  const filePath = join(configDir, "config.json");

  let file: ConfigFile<T> = {};
  if (existsSync(filePath)) {
    try {
      file = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      // corrupted config, start fresh
    }
  }

  const defaults = (file.defaults ?? {}) as T;
  const profileOverrides = profile && file.profiles?.[profile]
    ? file.profiles[profile]
    : {};

  return { ...defaults, ...profileOverrides } as T;
}

/**
 * Saves config to {configDir}/config.json using atomic write.
 * Merges the update into the existing file (preserves other profiles).
 */
export function saveConfig<T extends Record<string, unknown>>(
  configDir: string,
  update: ConfigFile<T>,
): void {
  const filePath = join(configDir, "config.json");

  let existing: ConfigFile<T> = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      // corrupted, overwrite
    }
  }

  const merged: ConfigFile<T> = {
    defaults: { ...existing.defaults, ...update.defaults } as Partial<T>,
    profiles: { ...existing.profiles, ...update.profiles },
  };

  atomicWriteJson(filePath, merged);
}

/**
 * Lists available profile names from the config file.
 */
export function listProfiles(configDir: string): string[] {
  const filePath = join(configDir, "config.json");
  if (!existsSync(filePath)) return [];
  try {
    const file = JSON.parse(readFileSync(filePath, "utf8"));
    return Object.keys(file.profiles ?? {});
  } catch {
    return [];
  }
}
