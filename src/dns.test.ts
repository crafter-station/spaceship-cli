import { describe, expect, test } from "bun:test";
import { SpaceshipClient } from "./client.js";
import { allDnsRecords } from "./commands/reads.js";
import { deleteItemFor } from "./commands/writes.js";
import { type DnsRecord, dnsGroup, dnsRecordBody } from "./types.js";

const creds = { apiKey: "key", apiSecret: "secret" };

function record(i: number): DnsRecord {
  return { type: "A", name: `host${i}`, address: `10.0.0.${i % 250}`, ttl: 3600, group: { type: "custom" } };
}

describe("dns list paging", () => {
  test("follows skip until every record is read, past the first page", async () => {
    const zone = Array.from({ length: 278 }, (_, i) => record(i));
    const seen: string[] = [];
    // The server caps pages at 100 here, below what the client asks for, to force several requests.
    const client = new SpaceshipClient(creds, {
      fetchImpl: async (target) => {
        const url = new URL(String(target));
        seen.push(url.search);
        const skip = Number(url.searchParams.get("skip"));
        return new Response(JSON.stringify({ items: zone.slice(skip, skip + 100), total: zone.length }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const { data } = await allDnsRecords(client, "crafter.run");
    expect(data.items).toHaveLength(278);
    expect(data.items[277]?.name).toBe("host277");
    expect(seen).toEqual(["?take=500&skip=0", "?take=500&skip=100", "?take=500&skip=200"]);
  });
});

describe("dns record bodies", () => {
  test("group comes back as an object and is never sent", () => {
    const r = record(1);
    expect(dnsGroup(r)).toBe("custom");
    expect(dnsGroup({ type: "A", name: "x", group: "product" })).toBe("product");
    expect(dnsRecordBody(r)).not.toHaveProperty("group");
  });

  test("delete sends the record's value fields, without group or ttl", () => {
    const records: DnsRecord[] = [
      { type: "CNAME", name: "craft-ones", cname: "c93c9b0e3fb22f5b.vercel-dns-016.com", ttl: 1800, group: { type: "custom" } },
      { type: "A", name: "craft-ones", address: "1.2.3.4", group: { type: "custom" } },
    ];
    const { item } = deleteItemFor(records, "crafter.run", "CNAME", "craft-ones");
    expect(item).toEqual({ type: "CNAME", name: "craft-ones", cname: "c93c9b0e3fb22f5b.vercel-dns-016.com" });
  });

  test("delete refuses to guess between records with the same name", () => {
    const records: DnsRecord[] = [
      { type: "TXT", name: "@", value: "a" },
      { type: "TXT", name: "@", value: "b" },
    ];
    expect(() => deleteItemFor(records, "crafter.run", "TXT", "@")).toThrow("2 TXT records");
    expect(deleteItemFor(records, "crafter.run", "TXT", "@", "b").item).toEqual({ type: "TXT", name: "@", value: "b" });
    expect(() => deleteItemFor(records, "crafter.run", "TXT", "www")).toThrow("No TXT record");
  });
});
