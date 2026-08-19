import { describe, expect, test } from "bun:test";
import { SpaceshipClient } from "./client.js";
import { AppError } from "./cli/foundation/error-map.js";

const creds = { apiKey: "key", apiSecret: "secret" };

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", ...headers },
  });
}

describe("auth headers", () => {
  test("sends both key and secret, which the API requires together", async () => {
    let seen: Headers | undefined;
    const client = new SpaceshipClient(creds, {
      fetchImpl: async (_url, init) => {
        seen = new Headers(init?.headers);
        return respond(200, { items: [], total: 0 });
      },
    });
    await client.get("/v1/domains");
    expect(seen?.get("x-api-key")).toBe("key");
    expect(seen?.get("x-api-secret")).toBe("secret");
  });
});

describe("error mapping", () => {
  test("401 becomes an auth error with a hint that names the fix", async () => {
    const client = new SpaceshipClient(creds, {
      fetchImpl: async () =>
        respond(401, { detail: "Api key or secret not provided." }, { "spaceship-error-code": "application.unauthorized" }),
    });
    const error = (await client.get("/v1/domains").catch((e) => e)) as AppError;
    expect(error.code).toBe("auth.rejected");
    expect(error.hint).toContain("SPACESHIP_API_KEY");
  });

  test("403 points at the scope, not at the credentials", async () => {
    const client = new SpaceshipClient(creds, {
      fetchImpl: async () => respond(403, { detail: "Forbidden" }),
    });
    const error = (await client.get("/v1/domains").catch((e) => e)) as AppError;
    expect(error.code).toBe("auth.missing-scope");
  });

  test("422 field errors reach the message", async () => {
    const client = new SpaceshipClient(creds, {
      fetchImpl: async () =>
        respond(422, { detail: "Validation failed", errors: [{ field: "years", details: "must be >= 1" }] }),
    });
    const error = (await client.get("/v1/domains").catch((e) => e)) as AppError;
    expect(error.human).toContain("years");
    expect(error.human).toContain("must be >= 1");
  });

  test("a non-JSON error body still produces a typed error", async () => {
    const client = new SpaceshipClient(creds, {
      fetchImpl: async () => new Response("<html>502</html>", { status: 502 }),
      maxRetries: 0,
    });
    const error = (await client.get("/v1/domains").catch((e) => e)) as AppError;
    expect(error).toBeInstanceOf(AppError);
  });

  test("an unreachable host is a network error, not an upstream one", async () => {
    const client = new SpaceshipClient(creds, {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = (await client.get("/v1/domains").catch((e) => e)) as AppError;
    expect(error.code).toBe("network");
  });
});

describe("retry", () => {
  test("retries a 429 and honours Retry-After", async () => {
    let calls = 0;
    const client = new SpaceshipClient(creds, {
      fetchImpl: async () => {
        calls++;
        if (calls === 1) return respond(429, { detail: "slow down" }, { "retry-after": "0" });
        return respond(200, { items: [], total: 0 });
      },
    });
    const result = await client.get<{ total: number }>("/v1/domains");
    expect(calls).toBe(2);
    expect(result.data.total).toBe(0);
  });

  test("gives up after maxRetries and throws the last error", async () => {
    let calls = 0;
    const client = new SpaceshipClient(creds, {
      maxRetries: 1,
      fetchImpl: async () => {
        calls++;
        return respond(429, { detail: "slow down" }, { "retry-after": "0" });
      },
    });
    const error = (await client.get("/v1/domains").catch((e) => e)) as AppError;
    expect(calls).toBe(2);
    expect(error.code).toBe("rate-limited");
  });

  test("does not retry a 404, which will never succeed", async () => {
    let calls = 0;
    const client = new SpaceshipClient(creds, {
      fetchImpl: async () => {
        calls++;
        return respond(404, { detail: "not found" });
      },
    });
    await client.get("/v1/domains/nope.com").catch(() => undefined);
    expect(calls).toBe(1);
  });
});

describe("response metadata", () => {
  test("surfaces the rate limit budget and the operation id", async () => {
    const reset = Math.floor(Date.parse("2026-08-19T00:00:00Z") / 1000);
    const client = new SpaceshipClient(creds, {
      fetchImpl: async () =>
        respond(
          200,
          { items: [], total: 0 },
          {
            "x-ratelimit-limit": "300",
            "x-ratelimit-remaining": "299",
            "x-ratelimit-reset": String(reset),
            "spaceship-operation-id": "abc123",
          },
        ),
    });
    const result = await client.get("/v1/domains");
    expect(result.rateLimit).toEqual({ limit: 300, remaining: 299, resetsAt: "2026-08-19T00:00:00.000Z" });
    expect(result.operationId).toBe("abc123");
  });

  test("captures the async operation id from a 202", async () => {
    const client = new SpaceshipClient(creds, {
      fetchImpl: async () => respond(202, {}, { "spaceship-async-operationid": "op-1" }),
    });
    const result = await client.post("/v1/domains/example.com", {});
    expect(result.asyncOperationId).toBe("op-1");
    expect(result.status).toBe(202);
  });

  test("an empty 204 body does not crash the parser", async () => {
    const client = new SpaceshipClient(creds, {
      fetchImpl: async () => respond(204, null),
    });
    const result = await client.delete("/v1/dns/records/example.com");
    expect(result.data).toBeNull();
  });
});

describe("query building", () => {
  test("omits undefined params instead of sending the string 'undefined'", async () => {
    let url = "";
    const client = new SpaceshipClient(creds, {
      fetchImpl: async (target) => {
        url = String(target);
        return respond(200, { items: [], total: 0 });
      },
    });
    await client.get("/v1/domains", { take: 100, skip: 0, orderBy: undefined });
    expect(url).toContain("take=100");
    expect(url).toContain("skip=0");
    expect(url).not.toContain("orderBy");
  });
});
