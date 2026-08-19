import { describe, expect, test } from "bun:test";
import { OPERATIONS } from "./registry.js";

const cliSource = await Bun.file(new URL("./cli.ts", import.meta.url)).text();

describe("command wiring", () => {
  test("every T0 operation has a handler, so --help cannot promise what is unrouted", () => {
    const t0 = [...new Set(OPERATIONS.filter((op) => op.tier === "T0").map((op) => op.command))];
    const unwired = t0.filter((command) => !cliSource.includes(`"${command}":`));
    expect(unwired).toEqual([]);
  });

  test("the registry stays at 50 operations", () => {
    expect(OPERATIONS).toHaveLength(50);
  });

  test("every operation carries the scopes its call needs", () => {
    expect(OPERATIONS.filter((op) => op.scopes.length === 0)).toEqual([]);
  });

  test("only the two endpoints the spec leaves undocumented lack a rate limit", () => {
    const missing = OPERATIONS.filter((op) => op.rateLimit === null).map((op) => op.path);
    expect(missing.sort()).toEqual([
      "/v1/domains/{domain}",
      "/v1/domains/{domain}/personal-nameservers/{currentHost}",
    ]);
  });

  test("money and domain-loss operations are all T3", () => {
    const risky = OPERATIONS.filter(
      (op) => op.path.includes("sellerhub") && op.method !== "GET",
    );
    expect(risky.every((op) => op.tier === "T3")).toBe(true);
    expect(OPERATIONS.find((op) => op.command === "domains delete")?.tier).toBe("T3");
  });
});

describe("no phantom commands", () => {
  test("every command an error hint tells the user to run actually exists", async () => {
    // A hint naming a command that was never built is worse than no hint: the
    // user follows it and hits "Unknown command". This is how `auth login`
    // shipped in V0 as advice with no implementation behind it.
    const sources = await Promise.all(
      [
        "./client.ts",
        "./credentials.ts",
        "./mutate.ts",
        "./async-ops.ts",
        "./commands/reads.ts",
        "./commands/writes.ts",
        "./commands/money.ts",
        "./commands/auth.ts",
        "./commands/portfolio.ts",
        "./commands/domains-list.ts",
      ].map((path) => Bun.file(new URL(path, import.meta.url)).text()),
    );

    const known = new Set([
      ...OPERATIONS.map((op) => op.command),
      "auth login",
      "auth status",
      "auth whoami",
      "auth logout",
      "portfolio lint",
      "portfolio rules",
      "schema",
    ]);

    const referenced = new Set<string>();
    for (const source of sources) {
      for (const match of source.matchAll(/spaceship ((?:[a-z-]+ ){0,2}[a-z-]+)/g)) {
        const phrase = (match[1] ?? "").trim();
        // Longest prefix that names a real command, e.g. "domains get example.com".
        const parts = phrase.split(" ");
        for (let take = Math.min(3, parts.length); take >= 1; take--) {
          const candidate = parts.slice(0, take).join(" ");
          if (known.has(candidate)) break;
          if (take === 1) referenced.add(phrase);
        }
      }
    }

    expect([...referenced]).toEqual([]);
  });
});
