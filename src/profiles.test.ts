import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "./cli/foundation/error-map.js";
import { defaultProfile, isValidProfileName, selectProfile, setDefaultProfile } from "./profiles.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "spaceship-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const env = (vars: Record<string, string> = {}): NodeJS.ProcessEnv => vars;

describe("selectProfile", () => {
  test("falls back to default when nothing names one", () => {
    expect(selectProfile(undefined, env(), home)).toEqual({ name: "default", source: "default" });
  });

  test("--profile beats SPACESHIP_PROFILE, which beats auth use", () => {
    setDefaultProfile("saved", home);
    expect(selectProfile(undefined, env(), home)).toEqual({ name: "saved", source: "config" });
    expect(selectProfile(undefined, env({ SPACESHIP_PROFILE: "shell" }), home)).toEqual({
      name: "shell",
      source: "env",
    });
    expect(selectProfile("typed", env({ SPACESHIP_PROFILE: "shell" }), home)).toEqual({
      name: "typed",
      source: "flag",
    });
  });

  test("auth use default reads as no selection at all", () => {
    setDefaultProfile("default", home);
    expect(selectProfile(undefined, env(), home).source).toBe("default");
  });

  test("a bare --profile is a usage error, not a profile called 'true'", () => {
    expect(() => selectProfile(true, env(), home)).toThrow(AppError);
  });

  test("rejects names that would not survive as a keychain account or a JSON key", () => {
    for (const bad of ["", " ", "a b", "-x", "a/b", "environment"]) {
      expect(isValidProfileName(bad)).toBe(false);
    }
    expect(() => selectProfile("a b", env(), home)).toThrow(/not a valid profile name/);
    expect(() => selectProfile(undefined, env({ SPACESHIP_PROFILE: "a/b" }), home)).toThrow(
      /SPACESHIP_PROFILE/,
    );
  });

  test("accepts the shapes people actually type", () => {
    for (const good of ["work", "crafter.run", "my-org_2", "A1"]) {
      expect(isValidProfileName(good)).toBe(true);
    }
  });
});

describe("defaultProfile", () => {
  test("round-trips through the config file", () => {
    expect(defaultProfile(home)).toBe("default");
    setDefaultProfile("work", home);
    expect(defaultProfile(home)).toBe("work");
  });
});
