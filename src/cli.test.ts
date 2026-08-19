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
