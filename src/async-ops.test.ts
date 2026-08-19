import { describe, expect, test } from "bun:test";
import { SpaceshipClient } from "./client.js";
import { requireOperationId, waitForOperation } from "./async-ops.js";
import { AppError } from "./cli/foundation/error-map.js";

function poller(statuses: string[]): { client: SpaceshipClient; polls: () => number } {
  let index = 0;
  const client = new SpaceshipClient(
    { apiKey: "k", apiSecret: "s" },
    {
      fetchImpl: async () => {
        const status = statuses[Math.min(index, statuses.length - 1)];
        index++;
        return new Response(
          JSON.stringify({
            status,
            type: "domains_Renew",
            createdAt: "2026-08-19T00:00:00Z",
            modifiedAt: "2026-08-19T00:00:05Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );
  return { client, polls: () => index };
}

describe("waitForOperation", () => {
  test("returns as soon as the operation succeeds", async () => {
    const { client, polls } = poller(["success"]);
    const outcome = await waitForOperation(client, "op-1", { intervalMs: 0 });
    expect(outcome.settled).toBe(true);
    expect(outcome.operation.status).toBe("success");
    expect(polls()).toBe(1);
  });

  test("keeps polling while the operation is pending", async () => {
    const { client, polls } = poller(["pending", "pending", "success"]);
    const outcome = await waitForOperation(client, "op-1", { intervalMs: 0 });
    expect(outcome.settled).toBe(true);
    expect(polls()).toBe(3);
    expect(outcome.attempts).toBe(3);
  });

  test("treats failure as settled, not as something to keep waiting on", async () => {
    const { client } = poller(["failed"]);
    const outcome = await waitForOperation(client, "op-1", { intervalMs: 0 });
    expect(outcome.settled).toBe(true);
    expect(outcome.operation.status).toBe("failed");
  });

  test("gives up on timeout and says so, rather than reporting success", async () => {
    const { client } = poller(["pending"]);
    let clock = 0;
    const outcome = await waitForOperation(client, "op-1", {
      intervalMs: 0,
      timeoutMs: 10,
      now: () => {
        clock += 20;
        return clock;
      },
    });
    expect(outcome.settled).toBe(false);
    expect(outcome.operation.status).toBe("pending");
  });

  test("reports every poll so a human sees progress", async () => {
    const { client } = poller(["pending", "success"]);
    const seen: string[] = [];
    await waitForOperation(client, "op-1", {
      intervalMs: 0,
      onPoll: (operation) => seen.push(operation.status),
    });
    expect(seen).toEqual(["pending", "success"]);
  });
});

describe("requireOperationId", () => {
  test("passes the id through when the header was present", () => {
    expect(requireOperationId("op-9", "domains renew")).toBe("op-9");
  });

  test("fails loudly when a 202 carried no operation id", () => {
    // Silently succeeding here would tell the caller a charge landed when
    // nothing can confirm it.
    let thrown: unknown;
    try {
      requireOperationId(null, "domains renew");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).human).toContain("no operation id");
  });
});
