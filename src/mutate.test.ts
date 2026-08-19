import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SpaceshipClient } from "./client.js";
import { runMutation } from "./mutate.js";
import { AppError } from "./cli/foundation/error-map.js";

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

const ctx = { command: "domains autorenew", flags: { json: true } };

function client(onCall: (method: string, body: unknown) => Response): {
  client: SpaceshipClient;
  calls: () => number;
} {
  let calls = 0;
  const instance = new SpaceshipClient(
    { apiKey: "k", apiSecret: "s" },
    {
      fetchImpl: async (_url, init) => {
        calls++;
        return onCall(init?.method ?? "GET", init?.body);
      },
    },
  );
  return { client: instance, calls: () => calls };
}

const okResponse = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const mutation = {
  command: "domains autorenew",
  trust: "T1" as const,
  target: "example.com",
  method: "PUT" as const,
  path: "/v1/domains/example.com/autorenew",
  body: { isEnabled: true },
  summary: "turn auto-renew on",
};

const auditRecords = (): { result: string; command: string }[] => {
  const dir = join(home, "audit");
  try {
    return readdirSync(dir)
      .flatMap((file) => readFileSync(join(dir, file), "utf8").trim().split("\n"))
      .filter(Boolean)
      .map((row) => JSON.parse(row));
  } catch {
    return [];
  }
};

describe("without --apply", () => {
  test("sends nothing at all", async () => {
    const { client: api, calls } = client(() => okResponse());
    await runMutation(ctx, api, {}, mutation);
    expect(calls()).toBe(0);
  });

  test("writes no audit record, because nothing was attempted", async () => {
    const { client: api } = client(() => okResponse());
    await runMutation(ctx, api, {}, mutation);
    expect(auditRecords()).toEqual([]);
  });
});

describe("--dry-run", () => {
  test("still sends nothing even when --apply is present", async () => {
    const { client: api, calls } = client(() => okResponse());
    await runMutation(ctx, api, { apply: true, dryRun: true }, mutation);
    expect(calls()).toBe(0);
  });
});

describe("--apply", () => {
  test("sends the body that the preview described", async () => {
    let seen: unknown;
    const { client: api, calls } = client((_method, body) => {
      seen = body;
      return okResponse();
    });
    await runMutation(ctx, api, { apply: true, yes: true }, mutation);
    expect(calls()).toBe(1);
    expect(JSON.parse(String(seen))).toEqual({ isEnabled: true });
  });

  test("records pending before the call and ok after it", async () => {
    const { client: api } = client(() => okResponse());
    await runMutation(ctx, api, { apply: true, yes: true }, mutation);
    expect(auditRecords().map((r) => r.result)).toEqual(["pending", "ok"]);
  });

  test("a failed call still leaves both records, so the attempt is visible", async () => {
    const { client: api } = client(
      () =>
        new Response(JSON.stringify({ detail: "nope" }), {
          status: 404,
          headers: { "content-type": "application/problem+json" },
        }),
    );
    await expect(runMutation(ctx, api, { apply: true, yes: true }, mutation)).rejects.toThrow();
    expect(auditRecords().map((r) => r.result)).toEqual(["pending", "error"]);
  });
});

describe("T2 and T3 gates", () => {
  test("T2 refuses without approval instead of hanging on a prompt", async () => {
    const { client: api, calls } = client(() => okResponse());
    const error = (await runMutation(ctx, api, { apply: true }, { ...mutation, trust: "T2" }).catch(
      (e) => e,
    )) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toContain("approval");
    expect(calls()).toBe(0);
  });

  test("T3 refuses when --confirm does not match the target", async () => {
    const { client: api, calls } = client(() => okResponse());
    const error = (await runMutation(
      ctx,
      api,
      { apply: true, yes: true, confirm: "wrong.com" },
      { ...mutation, trust: "T3" },
    ).catch((e) => e)) as AppError;
    expect(error.code).toBe("approval/confirm-mismatch");
    expect(calls()).toBe(0);
  });

  test("T3 proceeds when --confirm matches the target exactly", async () => {
    const { client: api, calls } = client(() => okResponse());
    await runMutation(
      ctx,
      api,
      { apply: true, yes: true, confirm: "example.com" },
      { ...mutation, trust: "T3" },
    );
    expect(calls()).toBe(1);
  });
});

describe("killswitch", () => {
  test("blocks a write with a typed code, not a generic runtime failure", async () => {
    writeFileSync(join(home, "KILLSWITCH"), JSON.stringify({ reason: "deploy window" }));
    const { client: api, calls } = client(() => okResponse());
    const error = (await runMutation(ctx, api, { apply: true, yes: true }, mutation).catch(
      (e) => e,
    )) as AppError;
    expect(error.code).toBe("killswitch");
    expect(error.human).toContain("deploy window");
    expect(calls()).toBe(0);
  });

  test("leaves previews working while writes are frozen", async () => {
    writeFileSync(join(home, "KILLSWITCH"), JSON.stringify({ reason: "deploy window" }));
    const { client: api, calls } = client(() => okResponse());
    const code = await runMutation(ctx, api, {}, mutation);
    expect(code).toBe(0);
    expect(calls()).toBe(0);
  });
});
