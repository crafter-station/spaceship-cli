import { describe, expect, test } from "bun:test";
import { lintPortfolio, RULES } from "./rules.js";
import type { DomainInfo } from "../types.js";

const NOW = new Date("2026-08-18T00:00:00Z");
const inDays = (days: number): string =>
  new Date(NOW.getTime() + days * 86_400_000).toISOString();

function domain(overrides: Partial<DomainInfo> = {}): DomainInfo {
  return {
    name: "example.com",
    unicodeName: "example.com",
    isPremium: false,
    autoRenew: true,
    registrationDate: inDays(-700),
    expirationDate: inDays(300),
    lifecycleStatus: "registered",
    verificationStatus: "success",
    eppStatuses: ["clientTransferProhibited"],
    suspensions: [],
    privacyProtection: { level: "high", contactForm: true },
    nameservers: { hosts: ["ns1.spaceship.net"] },
    contacts: { registrant: "c1" },
    ...overrides,
  };
}

const lint = (d: DomainInfo) => lintPortfolio([d], { now: NOW });
const rulesFired = (d: DomainInfo): string[] => lint(d).findings.map((f) => f.rule);

describe("a healthy domain", () => {
  test("produces no findings, so a clean portfolio stays quiet", () => {
    const report = lint(domain());
    expect(report.findings).toEqual([]);
    expect(report.cleanCount).toBe(1);
  });
});

describe("expiring-without-autorenew", () => {
  test("fires inside 30 days when auto-renew is off", () => {
    expect(rulesFired(domain({ autoRenew: false, expirationDate: inDays(20) }))).toContain(
      "expiring-without-autorenew",
    );
  });

  test("escalates to critical inside 7 days", () => {
    const [finding] = lint(domain({ autoRenew: false, expirationDate: inDays(5) })).findings;
    expect(finding?.severity).toBe("critical");
  });

  test("stays silent when auto-renew is on", () => {
    expect(rulesFired(domain({ autoRenew: true, expirationDate: inDays(3) }))).not.toContain(
      "expiring-without-autorenew",
    );
  });

  test("stays silent far from expiry", () => {
    expect(rulesFired(domain({ autoRenew: false, expirationDate: inDays(200) }))).not.toContain(
      "expiring-without-autorenew",
    );
  });

  test("does not double-report a domain already past expiry", () => {
    const fired = rulesFired(
      domain({ autoRenew: false, expirationDate: inDays(-3), lifecycleStatus: "grace1" }),
    );
    expect(fired).toContain("past-expiry");
    expect(fired).not.toContain("expiring-without-autorenew");
  });
});

describe("past-expiry", () => {
  test("names the recovery window for each lost state", () => {
    for (const status of ["grace1", "grace2", "redemption"] as const) {
      const [finding] = lint(domain({ lifecycleStatus: status })).findings;
      expect(finding?.rule).toBe("past-expiry");
      expect(finding?.severity).toBe("critical");
    }
  });

  test("redemption suggests restore, grace suggests renew", () => {
    const redemption = lint(domain({ lifecycleStatus: "redemption" })).findings[0];
    const grace = lint(domain({ lifecycleStatus: "grace1" })).findings[0];
    expect(redemption?.fix).toContain("restore");
    expect(grace?.fix).toContain("renew");
  });
});

describe("transfer-unlocked", () => {
  test("fires when the lock status is absent", () => {
    expect(rulesFired(domain({ eppStatuses: [] }))).toContain("transfer-unlocked");
  });

  test("stays silent when the domain is locked", () => {
    expect(rulesFired(domain({ eppStatuses: ["clientTransferProhibited"] }))).not.toContain(
      "transfer-unlocked",
    );
  });
});

describe("suspended", () => {
  test("reports the suspension kind rather than a bare flag", () => {
    const [finding] = lint(domain({ suspensions: [{ type: "abuse" }] })).findings;
    expect(finding?.rule).toBe("suspended");
    expect(finding?.message).toContain("abuse");
  });
});

describe("verification-pending", () => {
  test("failed verification is critical, pending is a warning", () => {
    expect(lint(domain({ verificationStatus: "failed" })).findings[0]?.severity).toBe("critical");
    expect(lint(domain({ verificationStatus: "verification" })).findings[0]?.severity).toBe("warning");
  });
});

describe("whois-public", () => {
  test("fires only when privacy is public", () => {
    expect(rulesFired(domain({ privacyProtection: { level: "public", contactForm: false } }))).toContain(
      "whois-public",
    );
    expect(rulesFired(domain())).not.toContain("whois-public");
  });
});

describe("no-nameservers", () => {
  test("fires on a registered domain with an empty host list", () => {
    expect(rulesFired(domain({ nameservers: { hosts: [] } }))).toContain("no-nameservers");
  });

  test("stays silent while the domain is still being created", () => {
    expect(
      rulesFired(domain({ nameservers: { hosts: [] }, lifecycleStatus: "creating" })),
    ).not.toContain("no-nameservers");
  });
});

describe("report shape", () => {
  test("every rule is reachable, so none is dead code", () => {
    const samples: DomainInfo[] = [
      domain({ autoRenew: false, expirationDate: inDays(10) }),
      domain({ lifecycleStatus: "grace1" }),
      domain({ eppStatuses: [] }),
      domain({ suspensions: [{ type: "fraud" }] }),
      domain({ verificationStatus: "failed" }),
      domain({ privacyProtection: { level: "public", contactForm: false } }),
      domain({ nameservers: { hosts: [] } }),
    ];
    const fired = new Set(lintPortfolio(samples, { now: NOW }).findings.map((f) => f.rule));
    expect(fired.size).toBe(RULES.length);
  });

  test("sorts critical findings before warnings and notices", () => {
    const report = lintPortfolio(
      [
        domain({ name: "a.com", unicodeName: "a.com", privacyProtection: { level: "public", contactForm: false } }),
        domain({ name: "b.com", unicodeName: "b.com", lifecycleStatus: "redemption" }),
      ],
      { now: NOW },
    );
    expect(report.findings[0]?.severity).toBe("critical");
  });

  test("counts a domain once even when several rules fire on it", () => {
    const report = lintPortfolio(
      [domain({ eppStatuses: [], privacyProtection: { level: "public", contactForm: false } })],
      { now: NOW },
    );
    expect(report.findings.length).toBe(2);
    expect(report.cleanCount).toBe(0);
    expect(report.domainsChecked).toBe(1);
  });

  test("only runs the rules requested", () => {
    const report = lintPortfolio([domain({ eppStatuses: [] })], {
      now: NOW,
      only: ["whois-public"],
    });
    expect(report.findings).toEqual([]);
  });
});
