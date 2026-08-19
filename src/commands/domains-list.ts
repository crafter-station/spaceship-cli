import type { SpaceshipClient } from "../client.js";
import { EXIT, type ExitCode } from "../contract.js";
import { emitResult, type EmitContext } from "../output/envelope.js";
import { table } from "../output/table.js";
import { byUrgency, daysUntil, expiryPhrase, paintUrgency, urgencyOf } from "../output/urgency.js";
import { bold, danger, dim, muted, warn } from "../cli/platform/style.js";

export type DomainInfo = {
  name: string;
  unicodeName: string;
  isPremium: boolean;
  autoRenew: boolean;
  registrationDate: string;
  expirationDate: string;
  lifecycleStatus: "creating" | "registered" | "grace1" | "grace2" | "redemption";
  verificationStatus: "verification" | "success" | "failed";
  eppStatuses: string[];
  suspensions: { type?: string }[];
  privacyProtection: { level: string; contactForm: boolean };
  nameservers: { hosts: string[] };
  contacts: { registrant: string };
};

type DomainListPage = { items: DomainInfo[]; total: number };

/** The API caps a page at 100 and requires both take and skip. */
const PAGE_SIZE = 100;

export async function fetchAllDomains(client: SpaceshipClient): Promise<{
  domains: DomainInfo[];
  total: number;
  requests: number;
}> {
  const first = await client.get<DomainListPage>("/v1/domains", { take: PAGE_SIZE, skip: 0 });
  const domains = [...first.data.items];
  const total = first.data.total;
  let requests = 1;

  while (domains.length < total) {
    const page = await client.get<DomainListPage>("/v1/domains", {
      take: PAGE_SIZE,
      skip: domains.length,
    });
    requests++;
    if (page.data.items.length === 0) break;
    domains.push(...page.data.items);
  }

  return { domains, total, requests };
}

/**
 * The human default answers "what do I own and what needs attention", so it
 * sorts by urgency rather than by name and leads with expiry. The machine mode
 * returns every field because the agent filters.
 */
export async function runDomainsList(
  ctx: EmitContext,
  client: SpaceshipClient,
  args: { limit?: number; all?: boolean },
): Promise<ExitCode> {
  const { domains, total } = await fetchAllDomains(client);
  const sorted = [...domains].sort(byUrgency((d) => daysUntil(d.expirationDate)));
  const shown = args.all ? sorted : sorted.slice(0, args.limit ?? 20);

  emitResult(
    ctx,
    { total, returned: domains.length, domains: sorted },
    {
      nextSteps:
        sorted.length > 0
          ? [
              {
                command: `spaceship domains get ${sorted[0]?.name}`,
                reason: "Inspect the domain closest to expiry",
              },
              { command: "spaceship portfolio lint", reason: "Check the whole portfolio for risks" },
            ]
          : [],
    },
    () => {
      if (shown.length === 0) {
        process.stdout.write(`${muted("No domains in this account.")}\n`);
        return;
      }

      const lines = table(shown, [
        { header: "domain", render: (d) => bold(d.unicodeName), max: 34 },
        {
          header: "expiry",
          render: (d) => {
            const days = daysUntil(d.expirationDate);
            return paintUrgency(urgencyOf(days), expiryPhrase(days));
          },
        },
        {
          header: "renew",
          // Manual renewal is neutral on a domain with a year left and an alarm
          // on one expiring this week, so it is painted by urgency, not by value.
          render: (d) => {
            if (d.autoRenew) return dim("auto");
            return daysUntil(d.expirationDate) <= 30 ? warn("manual") : muted("manual");
          },
        },
        {
          header: "status",
          // grace1, grace2 and redemption are recoverable-loss states; they must
          // not read as quieter than the ordinary "ok".
          render: (d) =>
            d.lifecycleStatus === "registered" ? muted("ok") : danger(d.lifecycleStatus),
        },
      ]);

      for (const line of lines) process.stdout.write(`${line}\n`);

      if (shown.length < sorted.length) {
        process.stdout.write(
          `\n${muted(`Showing ${shown.length} of ${sorted.length}, most urgent first. Use --all to see every domain.`)}\n`,
        );
      }
    },
  );

  return EXIT.ok;
}
