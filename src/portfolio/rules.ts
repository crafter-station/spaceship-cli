import { daysUntil } from "../output/urgency.js";
import type { DomainInfo } from "../types.js";

/**
 * Portfolio rules run over the domain list, which the API allows 300 times per
 * 300 seconds, rather than the per-domain endpoint capped at 5. Every field
 * these rules read is present and required in the list response, so a portfolio
 * of any size costs ceil(total / 100) requests.
 */

export type Severity = "critical" | "warning" | "notice";

export type Finding = {
  rule: string;
  severity: Severity;
  domain: string;
  /** What is true, stated so a reader needs no further lookup. */
  message: string;
  /** The command that addresses it, with values already substituted. */
  fix?: string;
};

export type Rule = {
  id: string;
  /** What the rule protects against, for `portfolio rules`. */
  about: string;
  evaluate: (domain: DomainInfo, now: Date) => Finding | null;
};

const name = (d: DomainInfo): string => d.unicodeName || d.name;

/**
 * Lifecycle states after expiry, ordered by how much of the recovery window is
 * left. Redemption usually carries a restore fee, which is why it is separate
 * from the grace period rather than folded into one "expired" state.
 */
const LOST_STATES: Record<string, { severity: Severity; note: string }> = {
  grace1: { severity: "critical", note: "in the grace period, still renewable at the normal price" },
  grace2: { severity: "critical", note: "late in the grace period, renewable but close to redemption" },
  redemption: { severity: "critical", note: "in redemption, recoverable only with a restore fee" },
};

export const RULES: Rule[] = [
  {
    id: "expiring-without-autorenew",
    about: "A domain close to expiry that nobody will renew automatically",
    evaluate: (d, now) => {
      if (d.autoRenew) return null;
      if (d.lifecycleStatus !== "registered") return null;
      const days = daysUntil(d.expirationDate, now);
      if (days > 30 || days < 0) return null;
      return {
        rule: "expiring-without-autorenew",
        severity: days <= 7 ? "critical" : "warning",
        domain: name(d),
        message:
          days === 0
            ? "expires today and auto-renew is off"
            : `expires in ${days} day${days === 1 ? "" : "s"} and auto-renew is off`,
        fix: `spaceship domains autorenew ${d.name} --on --apply`,
      };
    },
  },
  {
    id: "past-expiry",
    about: "A domain already past its expiry date, inside the recovery window",
    evaluate: (d) => {
      const state = LOST_STATES[d.lifecycleStatus];
      if (!state) return null;
      return {
        rule: "past-expiry",
        severity: state.severity,
        domain: name(d),
        message: state.note,
        fix:
          d.lifecycleStatus === "redemption"
            ? `spaceship domains restore ${d.name} --apply`
            : `spaceship domains renew ${d.name} --apply`,
      };
    },
  },
  {
    id: "transfer-unlocked",
    about: "A domain that can be transferred away without the lock stopping it",
    evaluate: (d) => {
      if (d.lifecycleStatus !== "registered") return null;
      if (d.eppStatuses.includes("clientTransferProhibited")) return null;
      return {
        rule: "transfer-unlocked",
        severity: "warning",
        domain: name(d),
        message: "transfer lock is off",
        fix: `spaceship transfer lock ${d.name} --on --apply`,
      };
    },
  },
  {
    id: "suspended",
    about: "A domain the registrar has suspended, which may stop resolving",
    evaluate: (d) => {
      if (d.suspensions.length === 0) return null;
      const kinds = d.suspensions.map((s) => s.type ?? "unspecified").join(", ");
      return {
        rule: "suspended",
        severity: "critical",
        domain: name(d),
        message: `suspended (${kinds})`,
        fix: `spaceship domains get ${d.name}`,
      };
    },
  },
  {
    id: "verification-pending",
    about: "Registrant verification unfinished, which can suspend the domain",
    evaluate: (d) => {
      if (d.verificationStatus === "success") return null;
      return {
        rule: "verification-pending",
        severity: d.verificationStatus === "failed" ? "critical" : "warning",
        domain: name(d),
        message:
          d.verificationStatus === "failed"
            ? "registrant verification failed"
            : "registrant verification is still pending",
        fix: `spaceship domains get ${d.name}`,
      };
    },
  },
  {
    id: "whois-public",
    about: "Registrant details exposed in public WHOIS",
    evaluate: (d) => {
      if (d.privacyProtection.level !== "public") return null;
      return {
        rule: "whois-public",
        severity: "notice",
        domain: name(d),
        message: "WHOIS privacy is off, so registrant details are public",
        fix: `spaceship domains privacy ${d.name} --level high --apply`,
      };
    },
  },
  {
    id: "no-nameservers",
    about: "A domain with no nameservers, which resolves nowhere",
    evaluate: (d) => {
      if (d.nameservers.hosts.length > 0) return null;
      if (d.lifecycleStatus !== "registered") return null;
      return {
        rule: "no-nameservers",
        severity: "warning",
        domain: name(d),
        message: "no nameservers set, so the domain does not resolve",
        fix: `spaceship domains nameservers ${d.name} --apply`,
      };
    },
  },
];

export type LintReport = {
  domainsChecked: number;
  findings: Finding[];
  countsBySeverity: Record<Severity, number>;
  /** Domains with nothing to report, named so a clean run is legible. */
  cleanCount: number;
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, notice: 2 };

export function lintPortfolio(
  domains: DomainInfo[],
  options: { now?: Date; only?: string[] } = {},
): LintReport {
  const now = options.now ?? new Date();
  const active = options.only ? RULES.filter((r) => options.only?.includes(r.id)) : RULES;

  const findings: Finding[] = [];
  for (const domain of domains) {
    for (const rule of active) {
      const finding = rule.evaluate(domain, now);
      if (finding) findings.push(finding);
    }
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.domain.localeCompare(b.domain),
  );

  const counts: Record<Severity, number> = { critical: 0, warning: 0, notice: 0 };
  for (const finding of findings) counts[finding.severity]++;

  const flagged = new Set(findings.map((f) => f.domain));

  return {
    domainsChecked: domains.length,
    findings,
    countsBySeverity: counts,
    cleanCount: domains.length - flagged.size,
  };
}
