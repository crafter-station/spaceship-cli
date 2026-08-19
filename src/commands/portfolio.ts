import type { SpaceshipClient } from "../client.js";
import { EXIT, type ExitCode } from "../contract.js";
import { emitResult, type EmitContext } from "../output/envelope.js";
import { table } from "../output/table.js";
import { bold, danger, dim, muted, ok, warn } from "../cli/platform/style.js";
import { fetchAllDomains } from "./domains-list.js";
import { lintPortfolio, RULES, type Finding, type Severity } from "../portfolio/rules.js";

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const paint: Record<Severity, (t: string) => string> = {
  critical: danger,
  warning: warn,
  notice: muted,
};

/** A word, not a colour alone: colour is unavailable under NO_COLOR and to some readers. */
const LABEL: Record<Severity, string> = {
  critical: "critical",
  warning: "warning",
  notice: "notice",
};

export async function portfolioLint(
  ctx: EmitContext,
  client: SpaceshipClient,
  args: { only?: string[] } = {},
): Promise<ExitCode> {
  const { domains, requests } = await fetchAllDomains(client);
  const report = lintPortfolio(domains, { only: args.only });

  return emitResult(
    ctx,
    { ...report, requestsUsed: requests },
    {
      nextSteps: report.findings[0]?.fix
        ? [{ command: report.findings[0].fix, reason: `Address the most severe finding on ${report.findings[0].domain}` }]
        : [],
    },
    (result) => {
      if (result.findings.length === 0) {
        line(`\n${ok("Nothing to fix.")} ${muted(`${result.domainsChecked} domains checked.`)}\n`);
        return;
      }

      // Grouped by domain rather than by rule: the reader acts on a domain, and
      // one domain with four problems is one decision, not four.
      const byDomain = new Map<string, Finding[]>();
      for (const finding of result.findings) {
        const bucket = byDomain.get(finding.domain) ?? [];
        bucket.push(finding);
        byDomain.set(finding.domain, bucket);
      }

      // One severity column width for the whole report, so the blocks line up
      // and the header is printed once rather than once per domain.
      const severityWidth = Math.max(
        ...result.findings.map((f) => LABEL[f.severity].length),
      );

      line("");
      for (const [domain, findings] of byDomain) {
        line(bold(domain));
        for (const finding of findings) {
          const label = paint[finding.severity](LABEL[finding.severity].padEnd(severityWidth));
          line(`  ${label}  ${finding.message}`);
          // Every finding carries its own fix: showing one per domain would
          // leave the rest looking like they need no action.
          if (finding.fix) line(`  ${" ".repeat(severityWidth)}  ${dim(finding.fix)}`);
        }
        line("");
      }

      const { critical, warning, notice } = result.countsBySeverity;
      const parts = [
        critical > 0 ? danger(`${critical} critical`) : "",
        warning > 0 ? warn(`${warning} warning`) : "",
        notice > 0 ? muted(`${notice} notice`) : "",
      ].filter(Boolean);
      line(
        `${parts.join(muted(" · "))}${muted(` across ${byDomain.size} of ${result.domainsChecked} domains, ${requests} request${requests === 1 ? "" : "s"}`)}\n`,
      );
    },
  );
}

/** The rule list is data too, so an agent can decide what to run without guessing. */
export function portfolioRules(ctx: EmitContext): ExitCode {
  const rules = RULES.map((rule) => ({ id: rule.id, about: rule.about }));
  return emitResult(ctx, { rules }, {}, (result) => {
    line("");
    for (const row of table(result.rules, [
      { header: "rule", render: (r) => bold(r.id), max: 28 },
      { header: "what it catches", render: (r) => r.about, max: 62 },
    ])) {
      line(row);
    }
    line("");
  });
}

export { EXIT };
