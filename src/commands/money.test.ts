import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SpaceshipClient } from "../client.js";
import { AppError } from "../cli/foundation/error-map.js";
import { OPERATIONS } from "../registry.js";
import * as money from "./money.js";

let home: string;
const original = process.env.SPACESHIP_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "spaceship-money-"));
  process.env.SPACESHIP_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (original === undefined) delete process.env.SPACESHIP_HOME;
  else process.env.SPACESHIP_HOME = original;
});

const ctx = { command: "test", flags: { json: true } };

const DOMAIN = {
  name: "example.com",
  unicodeName: "example.com",
  isPremium: false,
  autoRenew: true,
  registrationDate: "2024-01-01T00:00:00Z",
  expirationDate: "2027-03-01T00:00:00Z",
  lifecycleStatus: "registered",
  verificationStatus: "success",
  eppStatuses: [],
  suspensions: [],
  privacyProtection: { level: "high", contactForm: true },
  nameservers: { hosts: [] },
  contacts: { registrant: "c1" },
};

function api(): { client: SpaceshipClient; sent: () => { method: string; body: unknown }[] } {
  const sent: { method: string; body: unknown }[] = [];
  const client = new SpaceshipClient(
    { apiKey: "k", apiSecret: "s" },
    {
      fetchImpl: async (url, init) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          return new Response(JSON.stringify(DOMAIN), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        sent.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response("{}", {
          status: 202,
          headers: { "content-type": "application/json", "spaceship-async-operationid": "op-1" },
        });
      },
    },
  );
  return { client, sent: () => sent };
}

const approved = { apply: true, yes: true, confirm: "example.com" };

describe("the registry agrees with the code", () => {
  test("every money and delete operation is T3", () => {
    const t3 = OPERATIONS.filter((op) => op.tier === "T3").map((op) => op.command);
    for (const command of [
      "domains register",
      "domains renew",
      "domains restore",
      "domains delete",
      "transfer start",
      "market add",
      "market update",
      "market remove",
      "market checkout-link",
      "market safepay create",
    ]) {
      expect(t3).toContain(command);
    }
  });
});

describe("confirmation", () => {
  test("a T3 command refuses when --confirm is missing", async () => {
    const { client, sent } = api();
    const error = (await money
      .domainsDelete(ctx, client, { apply: true, yes: true }, { _: ["domains", "delete", "example.com"] })
      .catch((e) => e)) as AppError;
    expect(error.code).toBe("approval/confirm-mismatch");
    expect(sent()).toEqual([]);
  });

  test("a T3 command refuses when --confirm names a different domain", async () => {
    const { client, sent } = api();
    const error = (await money
      .domainsDelete(
        ctx,
        client,
        { apply: true, yes: true, confirm: "other.com" },
        { _: ["domains", "delete", "example.com"] },
      )
      .catch((e) => e)) as AppError;
    expect(error.code).toBe("approval/confirm-mismatch");
    expect(sent()).toEqual([]);
  });
});

describe("domains renew", () => {
  test("reads the current expiry from the API rather than trusting the caller", async () => {
    const { client, sent } = api();
    await money.domainsRenew(ctx, client, approved, { _: ["domains", "renew", "example.com"], years: 1 });
    expect(sent()[0]?.body).toEqual({ years: 1, currentExpirationDate: DOMAIN.expirationDate });
  });

  test("a caller-supplied expiry date cannot override the guard", async () => {
    const { client, sent } = api();
    await money.domainsRenew(ctx, client, approved, {
      _: ["domains", "renew", "example.com"],
      years: 1,
      currentExpirationDate: "1999-01-01T00:00:00Z",
    });
    const body = sent()[0]?.body as { currentExpirationDate: string };
    expect(body.currentExpirationDate).toBe(DOMAIN.expirationDate);
  });

  test("rejects a year count outside what the registry allows", async () => {
    const { client } = api();
    for (const years of [0, 11, 1.5]) {
      const error = (await money
        .domainsRenew(ctx, client, approved, { _: ["domains", "renew", "example.com"], years })
        .catch((e) => e)) as AppError;
      expect(error.code).toBe("usage");
    }
  });
});

describe("domains register", () => {
  test("defaults to private WHOIS", async () => {
    const { client, sent } = api();
    await money.domainsRegister(ctx, client, approved, {
      _: ["domains", "register", "example.com"],
      registrant: "c1",
    });
    const body = sent()[0]?.body as { privacyProtection: { level: string } };
    expect(body.privacyProtection.level).toBe("high");
  });

  test("public WHOIS needs explicit consent, which is not the CLI's to give", async () => {
    const { client, sent } = api();
    const error = (await money
      .domainsRegister(ctx, client, approved, {
        _: ["domains", "register", "example.com"],
        registrant: "c1",
        public: true,
      })
      .catch((e) => e)) as AppError;
    expect(error.name).toBe("ConsentRequired");
    expect(sent()).toEqual([]);
  });

  test("fills the other contact roles from the registrant when unset", async () => {
    const { client, sent } = api();
    await money.domainsRegister(ctx, client, approved, {
      _: ["domains", "register", "example.com"],
      registrant: "c1",
    });
    const body = sent()[0]?.body as { contacts: Record<string, string> };
    expect(body.contacts).toEqual({ registrant: "c1", admin: "c1", tech: "c1", billing: "c1" });
  });
});

describe("marketplace prices", () => {
  test("rejects a non-positive price rather than publishing it", async () => {
    const { client, sent } = api();
    for (const bin of [0, -100, "free"]) {
      const error = (await money
        .marketAdd(ctx, client, approved, { _: ["market", "add", "example.com"], bin })
        .catch((e) => e)) as AppError;
      expect(error.code).toBe("usage");
    }
    expect(sent()).toEqual([]);
  });

  test("enabling a buy-now price sets its flag, so the value is not stored inert", async () => {
    const { client, sent } = api();
    await money.marketAdd(ctx, client, approved, { _: ["market", "add", "example.com"], bin: 2500 });
    expect(sent()[0]?.body).toMatchObject({ binPrice: 2500, binPriceEnabled: true });
  });

  test("an update with nothing to change is a usage error, not an empty PATCH", async () => {
    const { client, sent } = api();
    const error = (await money
      .marketUpdate(ctx, client, approved, { _: ["market", "update", "example.com"] })
      .catch((e) => e)) as AppError;
    expect(error.name).toBe("NothingToChange");
    expect(sent()).toEqual([]);
  });
});

describe("safepay", () => {
  test("requires a valid initiator", async () => {
    const { client } = api();
    const error = (await money
      .marketSafepayCreate(ctx, client, approved, {
        _: ["market", "safepay", "create", "example.com"],
        price: 100,
        "initiated-by": "nobody",
      })
      .catch((e) => e)) as AppError;
    expect(error.code).toBe("usage");
  });
});
