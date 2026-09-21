import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  forgetCredentials,
  type Keychain,
  keychainAccount,
  makeCredentialStore,
  storeCredentials,
  storedProfiles,
} from "./keychain.js";
import { defaultProfile, setDefaultProfile } from "./profiles.js";

let home: string;
const originalHome = process.env.SPACESHIP_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "spaceship-test-"));
  process.env.SPACESHIP_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.SPACESHIP_HOME;
  else process.env.SPACESHIP_HOME = originalHome;
});

/** An in-memory keychain, so the tests never touch the machine's real one. */
const fakeKeychain = (): Keychain & { entries: Map<string, string> } => {
  const entries = new Map<string, string>();
  return {
    entries,
    available: () => true,
    read: (account) => entries.get(account) ?? null,
    write: (account, value) => {
      entries.set(account, value);
      return true;
    },
    delete: (account) => entries.delete(account),
  };
};

const noKeychain: Keychain = {
  available: () => false,
  read: () => null,
  write: () => false,
  delete: () => false,
};

const configFile = () => JSON.parse(readFileSync(join(home, "config.json"), "utf8"));

describe("keychainAccount", () => {
  test("the default profile keeps the accounts the first release used", () => {
    expect(keychainAccount("default", "api_key")).toBe("api_key");
    expect(keychainAccount("default", "api_secret")).toBe("api_secret");
  });

  test("named profiles get their own accounts", () => {
    expect(keychainAccount("work", "api_key")).toBe("work/api_key");
    expect(keychainAccount("work", "api_secret")).toBe("work/api_secret");
  });
});

describe("with a keychain", () => {
  test("stores both halves per profile and reads them back", () => {
    const keychain = fakeKeychain();
    expect(storeCredentials("work", "wk", "ws", keychain)).toBe("keychain");
    const store = makeCredentialStore(keychain);
    expect(store.apiKey("work")).toEqual({ value: "wk", source: "keychain" });
    expect(store.apiSecret("work")).toEqual({ value: "ws", source: "keychain" });
    expect(store.apiKey("default")).toBeNull();
  });

  test("a named profile leaves an index entry in the config file, but no key", () => {
    storeCredentials("work", "wk", "ws", fakeKeychain());
    expect(configFile().profiles).toEqual({ work: {} });
  });

  test("the default profile writes nothing to the config file", () => {
    storeCredentials("default", "dk", "ds", fakeKeychain());
    expect(existsSync(join(home, "config.json"))).toBe(false);
  });

  test("lists the default first, then named profiles alphabetically", () => {
    const keychain = fakeKeychain();
    storeCredentials("zeta", "k", "s", keychain);
    storeCredentials("alpha", "k", "s", keychain);
    storeCredentials("default", "k", "s", keychain);
    expect(storedProfiles(makeCredentialStore(keychain))).toEqual(["default", "alpha", "zeta"]);
  });

  test("a default logged in before profiles existed is still listed", () => {
    const keychain = fakeKeychain();
    keychain.entries.set("api_key", "k");
    keychain.entries.set("api_secret", "s");
    expect(storedProfiles(makeCredentialStore(keychain))).toEqual(["default"]);
  });

  test("forgetting a profile removes its entries, its index, and its claim on the default", () => {
    const keychain = fakeKeychain();
    storeCredentials("work", "wk", "ws", keychain);
    storeCredentials("other", "k", "s", keychain);
    setDefaultProfile("work");

    expect(forgetCredentials("work", keychain)).toEqual({ secretRemoved: true });
    expect(keychain.entries.has("work/api_key")).toBe(false);
    expect(keychain.entries.has("work/api_secret")).toBe(false);
    expect(configFile().profiles).toEqual({ other: {} });
    expect(defaultProfile()).toBe("default");
    expect(storedProfiles(makeCredentialStore(keychain))).toEqual(["other"]);
  });

  test("forgetting the default leaves named profiles alone", () => {
    const keychain = fakeKeychain();
    storeCredentials("default", "dk", "ds", keychain);
    storeCredentials("work", "wk", "ws", keychain);
    forgetCredentials("default", keychain);
    expect(storedProfiles(makeCredentialStore(keychain))).toEqual(["work"]);
    expect(makeCredentialStore(keychain).apiSecret("work")).toEqual({ value: "ws", source: "keychain" });
  });

  test("forgetting a profile that was never stored is harmless", () => {
    expect(forgetCredentials("ghost", fakeKeychain())).toEqual({ secretRemoved: false });
  });
});

describe("without a keychain", () => {
  test("keeps the key in the config file and reports the secret as not stored", () => {
    expect(storeCredentials("default", "dk", "ds", noKeychain)).toBe("config file");
    expect(configFile().defaults.apiKey).toBe("dk");
    const store = makeCredentialStore(noKeychain);
    expect(store.apiKey("default")).toEqual({ value: "dk", source: "config file" });
    expect(store.apiSecret("default")).toBeNull();
  });

  test("a named profile keeps its key in its own section and never borrows the default's", () => {
    storeCredentials("default", "dk", "ds", noKeychain);
    storeCredentials("work", "wk", "ws", noKeychain);
    expect(configFile().profiles.work).toEqual({ apiKey: "wk" });
    const store = makeCredentialStore(noKeychain);
    expect(store.apiKey("work")).toEqual({ value: "wk", source: "config file" });
    expect(store.apiKey("other")).toBeNull();
  });

  test("the secret never lands in the config file", () => {
    storeCredentials("work", "wk", "top-secret", noKeychain);
    expect(readFileSync(join(home, "config.json"), "utf8")).not.toContain("top-secret");
  });
});
