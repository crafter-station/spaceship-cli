// cligentic block: killswitch
//
// Binary safety gate. If a file exists at ~/.{app}/KILLSWITCH, all write
// operations refuse to execute. That's it. No config, no database, no
// network call. File exists = stopped. File gone = resumed.
//
// Design rules:
//   1. File existence is the sole source of truth. Atomic, no race conditions.
//   2. The file contains a JSON payload with reason + timestamp for debugging.
//   3. Checking the killswitch is a single fs.existsSync call (< 1ms).
//   4. Turning it on/off is idempotent.
//   5. Never throws from isKillswitchOn(). Always returns boolean.
//
// Usage:
//   import { assertKillswitchOff, turnKillswitchOn, turnKillswitchOff, isKillswitchOn } from "./safety/killswitch";
//
//   // Guard a write operation
//   assertKillswitchOff(appHome);  // throws if KILLSWITCH file exists
//   await placeOrder(order);
//
//   // Emergency stop from another terminal
//   turnKillswitchOn(appHome, "suspicious activity detected");
//
//   // Resume after investigation
//   turnKillswitchOff(appHome);

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type KillswitchState = {
  active: boolean;
  reason?: string;
  activatedAt?: string;
};

const KILLSWITCH_FILE = "KILLSWITCH";

function getPath(appHome: string): string {
  return join(appHome, KILLSWITCH_FILE);
}

/**
 * Check if the killswitch is active. Fast (single existsSync call).
 * Never throws.
 */
export function isKillswitchOn(appHome: string): boolean {
  try {
    return existsSync(getPath(appHome));
  } catch {
    return false;
  }
}

/**
 * Read the killswitch state including reason and timestamp.
 * Returns { active: false } if the file doesn't exist or can't be read.
 */
export function getKillswitchState(appHome: string): KillswitchState {
  const path = getPath(appHome);
  if (!existsSync(path)) return { active: false };
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return { active: true, reason: data.reason, activatedAt: data.at };
  } catch {
    return { active: true, reason: "unknown (file exists but unreadable)" };
  }
}

/**
 * Activate the killswitch. Idempotent. Creates the app home directory
 * if it doesn't exist. Writes reason + timestamp to the file.
 */
export function turnKillswitchOn(appHome: string, reason = "manual"): void {
  mkdirSync(appHome, { recursive: true });
  writeFileSync(
    getPath(appHome),
    JSON.stringify({ reason, at: new Date().toISOString() }, null, 2),
  );
}

/**
 * Deactivate the killswitch. Idempotent. No-op if already off.
 */
export function turnKillswitchOff(appHome: string): void {
  const path = getPath(appHome);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

/**
 * Assert that the killswitch is off. If it's on, throws an error with
 * the reason and timestamp. Use this as a guard at the top of any
 * write operation.
 *
 * ```ts
 * assertKillswitchOff(appHome);
 * await dangerousOperation();
 * ```
 */
export function assertKillswitchOff(appHome: string): void {
  const state = getKillswitchState(appHome);
  if (state.active) {
    const since = state.activatedAt ? ` since ${state.activatedAt}` : "";
    const why = state.reason ? `: ${state.reason}` : "";
    throw new Error(
      `Killswitch is ON${since}${why}. All write operations are blocked. ` +
        `Remove ${getPath(appHome)} or run your CLI's killswitch off command to resume.`,
    );
  }
}
