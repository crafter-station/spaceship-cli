import { describe, expect, test } from "bun:test";
import { SpaceshipClient } from "../client.js";
import { fetchAllDomains, type DomainInfo } from "./domains-list.js";

function domain(name: string): DomainInfo {
  return {
    name,
    unicodeName: name,
    isPremium: false,
    autoRenew: true,
    registrationDate: "2024-01-01T00:00:00Z",
    expirationDate: "2027-01-01T00:00:00Z",
    lifecycleStatus: "registered",
    verificationStatus: "success",
    eppStatuses: [],
    suspensions: [],
    privacyProtection: { level: "high", contactForm: true },
    nameservers: { hosts: [] },
    contacts: { registrant: "c1" },
  };
}

function pagedClient(total: number): { client: SpaceshipClient; calls: () => string[] } {
  const seen: string[] = [];
  const client = new SpaceshipClient(
    { apiKey: "k", apiSecret: "s" },
    {
      fetchImpl: async (target) => {
        const url = new URL(String(target));
        seen.push(url.search);
        const skip = Number(url.searchParams.get("skip"));
        const take = Number(url.searchParams.get("take"));
        const items = Array.from({ length: Math.max(0, Math.min(take, total - skip)) }, (_, i) =>
          domain(`d${skip + i}.com`),
        );
        return new Response(JSON.stringify({ items, total }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );
  return { client, calls: () => seen };
}

describe("fetchAllDomains", () => {
  test("a single page costs one request", async () => {
    const { client, calls } = pagedClient(40);
    const result = await fetchAllDomains(client);
    expect(result.domains).toHaveLength(40);
    expect(result.requests).toBe(1);
    expect(calls()).toHaveLength(1);
  });

  test("pages at the API's maximum of 100 per request", async () => {
    const { client, calls } = pagedClient(250);
    const result = await fetchAllDomains(client);
    expect(result.domains).toHaveLength(250);
    // 250 domains is 3 requests, not 250: the per-domain endpoint would be
    // rate limited at 5 per domain per 300s, this one allows 300 per user.
    expect(result.requests).toBe(3);
    expect(calls()[0]).toContain("take=100");
    expect(calls()[1]).toContain("skip=100");
  });

  test("stops when a page comes back empty, so a wrong total cannot loop forever", async () => {
    let call = 0;
    const client = new SpaceshipClient(
      { apiKey: "k", apiSecret: "s" },
      {
        fetchImpl: async () => {
          call++;
          const items = call === 1 ? [domain("only.com")] : [];
          return new Response(JSON.stringify({ items, total: 999 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    );
    const result = await fetchAllDomains(client);
    expect(result.domains).toHaveLength(1);
    expect(call).toBe(2);
  });
});
