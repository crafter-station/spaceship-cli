import { describe, expect, test } from "bun:test";
import { AppError } from "./cli/foundation/error-map.js";
import { accountLabel, loadCredentials, resolveCredentials } from "./credentials.js";
import type { CredentialStore } from "./keychain.js";
import type { ProfileSelection, ProfileSource } from "./profiles.js";

/** A store with fixed contents, so no test touches the machine's keychain. */
const store = (profiles: Record<string, { key: string; secret?: string }>): CredentialStore => ({
  apiKey: (profile) => {
    const entry = profiles[profile];
    return entry ? { value: entry.key, source: "keychain" } : null;
  },
  apiSecret: (profile) => {
    const entry = profiles[profile];
    return entry?.secret ? { value: entry.secret, source: "keychain" } : null;
  },
});

const stored = store({ default: { key: "dk", secret: "ds" }, work: { key: "wk", secret: "ws" } });
const env = (vars: Record<string, string> = {}): NodeJS.ProcessEnv => vars;
const select = (name: string, source: ProfileSource): ProfileSelection => ({ name, source });
const exported = env({ SPACESHIP_API_KEY: "ek", SPACESHIP_API_SECRET: "es" });

const caught = (run: () => unknown): AppError => {
  try {
    run();
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected a throw");
};

describe("loadCredentials", () => {
  test("uses the stored default when nothing else is set", () => {
    expect(loadCredentials(select("default", "default"), env(), stored)).toEqual({
      apiKey: "dk",
      apiSecret: "ds",
      account: "default",
    });
  });

  test("the environment overrides the stored default", () => {
    expect(loadCredentials(select("default", "default"), exported, stored)).toEqual({
      apiKey: "ek",
      apiSecret: "es",
      account: "environment",
    });
  });

  test("the environment also overrides a profile picked by SPACESHIP_PROFILE or auth use", () => {
    for (const source of ["env", "config"] as const) {
      expect(loadCredentials(select("work", source), exported, stored).account).toBe("environment");
    }
  });

  test("--profile on the command line wins over the environment", () => {
    // An exported personal key must not silently redirect a write that named
    // the company profile.
    expect(loadCredentials(select("work", "flag"), exported, stored)).toEqual({
      apiKey: "wk",
      apiSecret: "ws",
      account: "work",
    });
  });

  test("--profile default reaches the stored default past the environment", () => {
    expect(loadCredentials(select("default", "flag"), exported, stored).account).toBe("default");
  });

  test("blank variables count as unset", () => {
    const blank = env({ SPACESHIP_API_KEY: "  ", SPACESHIP_API_SECRET: "" });
    expect(loadCredentials(select("default", "default"), blank, stored).account).toBe("default");
  });

  test("a missing named profile fails naming the profile and the login command", () => {
    const error = caught(() => loadCredentials(select("nope", "flag"), env(), stored));
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("auth.missing-credentials");
    expect(error.human).toContain('"nope"');
    expect(error.hint).toContain("auth login --profile nope");
  });

  test("a missing default keeps the message that also mentions the variables", () => {
    const error = caught(() => loadCredentials(select("default", "default"), env(), store({})));
    expect(error.code).toBe("auth.missing-credentials");
    expect(error.hint).toContain("SPACESHIP_API_KEY");
  });
});

describe("accountLabel", () => {
  test("one half from the environment marks the whole call as environment", () => {
    const resolved = resolveCredentials(
      select("default", "default"),
      env({ SPACESHIP_API_SECRET: "es" }),
      stored,
    );
    expect(resolved.keySource).toBe("keychain");
    expect(resolved.secretSource).toBe("environment");
    expect(accountLabel(resolved)).toBe("environment");
  });

  test("reports the profile name when both halves are stored", () => {
    expect(accountLabel(resolveCredentials(select("work", "env"), env(), stored))).toBe("work");
  });
});
