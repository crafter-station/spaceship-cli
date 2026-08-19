import type { SpaceshipClient } from "../client.js";
import { EXIT, type ExitCode } from "../contract.js";
import { emitResult, type EmitContext } from "../output/envelope.js";
import { grouped, table } from "../output/table.js";
import { daysUntil, expiryPhrase, paintUrgency, urgencyOf } from "../output/urgency.js";
import { bold, danger, dim, muted, ok, warn } from "../cli/platform/style.js";
import { AppError } from "../cli/foundation/error-map.js";
import type {
  AsyncOperation,
  AuthCode,
  AvailabilityResult,
  Contact,
  DnsRecord,
  DomainInfo,
  HyperliftApp,
  HyperliftLogs,
  HyperliftMetrics,
  Paged,
  PersonalNameserver,
  SafePayTransaction,
  SellerHubDomain,
  SoldDomain,
  TransferInfo,
  VerificationRecord,
} from "../types.js";

const PAGE_SIZE = 100;

function required(value: string | undefined, what: string, example: string): string {
  if (!value) {
    throw new AppError("usage", {
      name: "MissingArgument",
      human: `This command needs ${what}.`,
      hint: `Example: ${example}`,
    });
  }
  return value;
}

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const field = (label: string, value: string): void => {
  line(`  ${dim(label.padEnd(14))} ${value}`);
};

/** A currency amount is money; it reads wrong without its unit attached. */
const money = (amount: number, currency = "USD"): string =>
  `${amount.toFixed(2)} ${currency}`;

// ---------------------------------------------------------------- domains get

export async function domainsGet(ctx: EmitContext, client: SpaceshipClient, domain?: string): Promise<ExitCode> {
  const name = required(domain, "a domain name", "spaceship domains get example.com");
  const { data, rateLimit } = await client.get<DomainInfo>(`/v1/domains/${encodeURIComponent(name)}`);

  const days = daysUntil(data.expirationDate);
  const locked = data.eppStatuses.includes("clientTransferProhibited");

  return emitResult(
    ctx,
    data,
    {
      rateLimit,
      nextSteps: [
        { command: `spaceship dns list ${data.name}`, reason: "See the DNS records on this domain" },
        ...(data.autoRenew
          ? []
          : [{ command: `spaceship domains autorenew ${data.name} --on --apply`, reason: "Auto-renew is off" }]),
      ],
    },
    (d) => {
      line(`\n${bold(d.unicodeName)}${d.unicodeName === d.name ? "" : muted(` (${d.name})`)}\n`);
      field("expires", paintUrgency(urgencyOf(days), `${d.expirationDate.slice(0, 10)} — ${expiryPhrase(days)}`));
      field("auto-renew", d.autoRenew ? ok("on") : warn("off"));
      field("status", d.lifecycleStatus === "registered" ? muted("registered") : warn(d.lifecycleStatus));
      field("transfer", locked ? muted("locked") : warn("unlocked"));
      field("privacy", d.privacyProtection.level);
      field("registered", d.registrationDate.slice(0, 10));
      if (d.isPremium) field("premium", warn("yes"));
      field("nameservers", d.nameservers.hosts.length > 0 ? d.nameservers.hosts.join("\n" + " ".repeat(17)) : muted("none"));
      if (d.suspensions.length > 0) {
        field("suspensions", danger(d.suspensions.map((s) => s.type ?? "unknown").join(", ")));
      }
      line("");
    },
  );
}

// ------------------------------------------------------------- domains check

export async function domainsCheck(ctx: EmitContext, client: SpaceshipClient, names: string[]): Promise<ExitCode> {
  if (names.length === 0) {
    throw new AppError("usage", {
      name: "MissingArgument",
      human: "This command needs at least one domain name.",
      hint: "Example: spaceship domains check example.com another.dev",
    });
  }

  // One name uses the single endpoint; several use the bulk one, which the API
  // caps at 20 per request.
  let results: AvailabilityResult[];
  if (names.length === 1) {
    const { data } = await client.get<AvailabilityResult>(
      `/v1/domains/${encodeURIComponent(names[0] as string)}/available`,
    );
    results = [data];
  } else {
    results = [];
    for (let i = 0; i < names.length; i += 20) {
      const { data } = await client.post<{ domains: AvailabilityResult[] }>("/v1/domains/available", {
        domains: names.slice(i, i + 20),
      });
      results.push(...data.domains);
    }
  }

  const available = results.filter((r) => r.result === "available");

  return emitResult(
    ctx,
    { checked: results.length, available: available.length, results },
    {
      nextSteps: available[0]
        ? [{ command: `spaceship domains register ${available[0].domain} --apply`, reason: "Register the first available name" }]
        : [],
    },
    (data) => {
      line("");
      for (const row of table(data.results, [
        { header: "domain", render: (r) => bold(r.domain), max: 40 },
        {
          header: "status",
          render: (r) =>
            r.result === "available" ? ok("available") : r.result === "taken" ? muted("taken") : warn(r.result),
        },
        {
          header: "price",
          align: "right",
          render: (r) => {
            const price = r.premiumPricing.find((p) => p.operation.toLowerCase().includes("regist")) ?? r.premiumPricing[0];
            return price ? warn(money(price.price, price.currency)) : "";
          },
        },
      ])) {
        line(row);
      }
      line("");
    },
  );
}

// ------------------------------------------------------------------ dns list

export async function dnsList(ctx: EmitContext, client: SpaceshipClient, domain?: string): Promise<ExitCode> {
  const name = required(domain, "a domain name", "spaceship dns list example.com");
  const { data, rateLimit } = await client.get<Paged<DnsRecord>>(`/v1/dns/records/${encodeURIComponent(name)}`, {
    take: PAGE_SIZE,
    skip: 0,
  });

  /** The value column differs per record type; this keeps one readable column. */
  const valueOf = (r: DnsRecord): string =>
    r.address ?? r.cname ?? r.exchange ?? r.value ?? r.target ?? "";

  return emitResult(
    ctx,
    { domain: name, total: data.total, records: data.items },
    { rateLimit, nextSteps: [{ command: `spaceship dns set ${name} --apply`, reason: "Add or update a record" }] },
    (result) => {
      if (result.records.length === 0) {
        line(`\n${muted("No DNS records on this domain.")}\n`);
        return;
      }
      line("");
      // Grouping by type turns a repeated column into a heading.
      for (const row of grouped(
        result.records,
        (r) => r.type,
        [
          { header: "name", render: (r) => bold(r.name), max: 30 },
          { header: "value", render: (r) => valueOf(r), max: 46 },
          { header: "ttl", align: "right", render: (r) => (r.ttl === undefined ? "" : dim(String(r.ttl))) },
          { header: "managed", render: (r) => (r.group === "custom" ? "" : muted(r.group)) },
        ],
        { repeatHeader: false },
      )) {
        line(row);
      }
      line("");
    },
  );
}

// ------------------------------------------------------------------- ns reads

export async function nsList(ctx: EmitContext, client: SpaceshipClient, domain?: string): Promise<ExitCode> {
  const name = required(domain, "a domain name", "spaceship ns list example.com");
  const { data, rateLimit } = await client.get<Paged<PersonalNameserver>>(
    `/v1/domains/${encodeURIComponent(name)}/personal-nameservers`,
    { take: PAGE_SIZE, skip: 0 },
  );
  const items = data.items ?? [];

  return emitResult(ctx, { domain: name, nameservers: items }, { rateLimit }, (result) => {
    if (result.nameservers.length === 0) {
      line(`\n${muted("No personal nameservers on this domain.")}\n`);
      return;
    }
    line("");
    for (const row of table(result.nameservers, [
      { header: "host", render: (n) => bold(n.host), max: 40 },
      { header: "ips", render: (n) => n.ips.join(", ") },
    ])) {
      line(row);
    }
    line("");
  });
}

export async function nsGet(
  ctx: EmitContext,
  client: SpaceshipClient,
  domain?: string,
  host?: string,
): Promise<ExitCode> {
  const name = required(domain, "a domain name", "spaceship ns get example.com ns1.example.com");
  const target = required(host, "a nameserver host", "spaceship ns get example.com ns1.example.com");
  const { data, rateLimit } = await client.get<PersonalNameserver>(
    `/v1/domains/${encodeURIComponent(name)}/personal-nameservers/${encodeURIComponent(target)}`,
  );
  return emitResult(ctx, data, { rateLimit }, (n) => {
    line(`\n${bold(n.host)}\n`);
    field("ips", n.ips.join(", "));
    line("");
  });
}

// ------------------------------------------------------------- transfer reads

export async function transferStatus(ctx: EmitContext, client: SpaceshipClient, domain?: string): Promise<ExitCode> {
  const name = required(domain, "a domain name", "spaceship transfer status example.com");
  const { data, rateLimit } = await client.get<TransferInfo>(
    `/v1/domains/${encodeURIComponent(name)}/transfer`,
  );
  return emitResult(ctx, data, { rateLimit }, (t) => {
    line(`\n${bold(name)}\n`);
    field("status", t.status === "completed" ? ok(t.status) : t.status === "cancelled" ? danger(t.status) : warn(t.status));
    field("started", t.startedAt.slice(0, 10));
    if (t.finishedAt) field("finished", t.finishedAt.slice(0, 10));
    line("");
  });
}

export async function transferAuthCode(ctx: EmitContext, client: SpaceshipClient, domain?: string): Promise<ExitCode> {
  const name = required(domain, "a domain name", "spaceship transfer auth-code example.com");
  const { data, rateLimit } = await client.get<AuthCode>(
    `/v1/domains/${encodeURIComponent(name)}/transfer/auth-code`,
  );
  return emitResult(ctx, data, { rateLimit }, (a) => {
    // The code is the payload, so it goes to stdout bare and copyable.
    line(a.authCode);
  });
}

// ------------------------------------------------------------- contacts reads

export async function contactsGet(ctx: EmitContext, client: SpaceshipClient, id?: string): Promise<ExitCode> {
  const contact = required(id, "a contact id", "spaceship contacts get 1ZdMXpapqp9sle5dl8BlppTJXAzf5");
  const { data, rateLimit } = await client.get<Contact>(`/v1/contacts/${encodeURIComponent(contact)}`);
  return emitResult(ctx, data, { rateLimit }, (c) => {
    line("");
    for (const [key, value] of Object.entries(c)) {
      if (value === null || value === undefined || value === "") continue;
      field(key, String(value));
    }
    line("");
  });
}

export async function contactsAttrsGet(ctx: EmitContext, client: SpaceshipClient, id?: string): Promise<ExitCode> {
  const contact = required(id, "a contact id", "spaceship contacts attrs-get 1ZdMXpapqp9sle5dl8BlppTJXAzf8");
  const { data, rateLimit } = await client.get<Contact>(
    `/v1/contacts/attributes/${encodeURIComponent(contact)}`,
  );
  return emitResult(ctx, data, { rateLimit }, (c) => {
    line("");
    for (const [key, value] of Object.entries(c)) {
      if (value === null || value === undefined || value === "") continue;
      field(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    line("");
  });
}

// ------------------------------------------------------------------- ops get

export async function opsGet(ctx: EmitContext, client: SpaceshipClient, id?: string): Promise<ExitCode> {
  const operation = required(id, "an operation id", "spaceship ops get abc123xyz");
  const { data, rateLimit } = await client.get<AsyncOperation>(
    `/v1/async-operations/${encodeURIComponent(operation)}`,
  );
  return emitResult(ctx, data, { rateLimit }, (o) => {
    line(`\n${bold(o.type)}\n`);
    field("status", o.status === "success" ? ok(o.status) : o.status === "failed" ? danger(o.status) : warn(o.status));
    field("created", o.createdAt);
    field("updated", o.modifiedAt);
    if (o.details !== undefined && o.details !== null) field("details", JSON.stringify(o.details));
    line("");
  });
}

// ----------------------------------------------------------- marketplace reads

export async function marketList(ctx: EmitContext, client: SpaceshipClient): Promise<ExitCode> {
  const { data, rateLimit } = await client.get<Paged<SellerHubDomain>>("/v1/sellerhub/domains", {
    take: PAGE_SIZE,
    skip: 0,
  });
  return emitResult(ctx, { total: data.total, listings: data.items }, { rateLimit }, (result) => {
    if (result.listings.length === 0) {
      line(`\n${muted("No marketplace listings.")}\n`);
      return;
    }
    line("");
    for (const row of table(result.listings, [
      { header: "domain", render: (d) => bold(d.unicodeName), max: 34 },
      { header: "status", render: (d) => muted(d.status) },
      {
        header: "buy now",
        align: "right",
        render: (d) => (d.binPriceEnabled && d.binPrice !== undefined ? money(d.binPrice) : ""),
      },
      {
        header: "minimum",
        align: "right",
        render: (d) => (d.minPriceEnabled && d.minPrice !== undefined ? muted(money(d.minPrice)) : ""),
      },
    ])) {
      line(row);
    }
    line("");
  });
}

export async function marketGet(ctx: EmitContext, client: SpaceshipClient, domain?: string): Promise<ExitCode> {
  const name = required(domain, "a domain name", "spaceship market get example.com");
  const { data, rateLimit } = await client.get<SellerHubDomain>(
    `/v1/sellerhub/domains/${encodeURIComponent(name)}`,
  );
  return emitResult(ctx, data, { rateLimit }, (d) => {
    line(`\n${bold(d.unicodeName)}\n`);
    field("status", d.status);
    if (d.displayName) field("display name", d.displayName);
    if (d.binPrice !== undefined) field("buy now", d.binPriceEnabled ? money(d.binPrice) : muted(`${money(d.binPrice)} (off)`));
    if (d.minPrice !== undefined) field("minimum", d.minPriceEnabled ? money(d.minPrice) : muted(`${money(d.minPrice)} (off)`));
    if (d.description) field("description", d.description);
    line("");
  });
}

export async function marketSold(ctx: EmitContext, client: SpaceshipClient): Promise<ExitCode> {
  const { data, rateLimit } = await client.get<Paged<SoldDomain>>("/v1/sellerhub/domains/reports/sold", {
    take: PAGE_SIZE,
    skip: 0,
  });
  const items = data.items ?? [];
  const revenue = items.reduce((sum, d) => sum + d.payout, 0);

  return emitResult(ctx, { total: data.total, payoutTotal: revenue, sold: items }, { rateLimit }, (result) => {
    if (result.sold.length === 0) {
      line(`\n${muted("No sales yet.")}\n`);
      return;
    }
    line("");
    for (const row of table(result.sold, [
      { header: "domain", render: (d) => bold(d.unicodeName), max: 34 },
      { header: "sold", render: (d) => dim(d.saleDateTime.slice(0, 10)) },
      { header: "price", align: "right", render: (d) => money(d.salePrice) },
      { header: "payout", align: "right", render: (d) => ok(money(d.payout)) },
    ])) {
      line(row);
    }
    line(`\n${dim("total payout")}  ${bold(money(result.payoutTotal))}\n`);
  });
}

export async function marketSafepayList(ctx: EmitContext, client: SpaceshipClient): Promise<ExitCode> {
  const { data, rateLimit } = await client.get<Paged<SafePayTransaction>>("/v1/sellerhub/safepay-transactions", {
    take: PAGE_SIZE,
    skip: 0,
  });
  const items = data.items ?? [];
  return emitResult(ctx, { total: data.total, transactions: items }, { rateLimit }, (result) => {
    if (result.transactions.length === 0) {
      line(`\n${muted("No SafePay transactions.")}\n`);
      return;
    }
    line("");
    for (const row of table(result.transactions, [
      { header: "id", render: (t) => dim(t.transactionId), max: 18 },
      { header: "domain", render: (t) => bold(t.domainName), max: 30 },
      { header: "status", render: (t) => t.status },
      { header: "price", align: "right", render: (t) => money(t.basePrice) },
    ])) {
      line(row);
    }
    line("");
  });
}

export async function marketSafepayGet(ctx: EmitContext, client: SpaceshipClient, id?: string): Promise<ExitCode> {
  const transaction = required(id, "a transaction id", "spaceship market safepay get tx_123");
  const { data, rateLimit } = await client.get<SafePayTransaction>(
    `/v1/sellerhub/safepay-transactions/${encodeURIComponent(transaction)}`,
  );
  return emitResult(ctx, data, { rateLimit }, (t) => {
    line(`\n${bold(t.domainName)} ${muted(t.transactionId)}\n`);
    field("status", t.status);
    if (t.saleStatus) field("sale status", t.saleStatus);
    field("price", money(t.basePrice));
    field("type", t.type);
    if (t.buyerEmail) field("buyer", t.buyerEmail);
    if (t.sellerEmail) field("seller", t.sellerEmail);
    line("");
  });
}

export async function marketVerifyRecords(ctx: EmitContext, client: SpaceshipClient): Promise<ExitCode> {
  const { data, rateLimit } = await client.get<VerificationRecord>("/v1/sellerhub/verification-records");
  return emitResult(ctx, data, { rateLimit }, (records) => {
    line(`\n${JSON.stringify(records, null, 2)}\n`);
  });
}

// -------------------------------------------------------------- hyperlift reads

export async function appList(ctx: EmitContext, client: SpaceshipClient): Promise<ExitCode> {
  const { data, rateLimit } = await client.get<Paged<HyperliftApp>>("/v1/hyperlift/applications", {
    take: PAGE_SIZE,
    skip: 0,
  });
  const items = data.items ?? [];
  return emitResult(ctx, { total: data.total, applications: items }, { rateLimit }, (result) => {
    if (result.applications.length === 0) {
      line(`\n${muted("No Hyperlift applications.")}\n`);
      return;
    }
    line("");
    for (const row of table(result.applications, [
      { header: "name", render: (a) => bold(a.name ?? a.id), max: 28 },
      { header: "id", render: (a) => dim(a.id), max: 38 },
      {
        header: "running",
        // scale is null while the desired state is unknown, which is not "stopped".
        render: (a) => (a.scale === null || a.scale === undefined ? muted("unknown") : a.scale > 0 ? ok("yes") : muted("no")),
      },
      { header: "status", render: (a) => (a.status ? muted(a.status) : "") },
    ])) {
      line(row);
    }
    line("");
  });
}

export async function appGet(ctx: EmitContext, client: SpaceshipClient, id?: string): Promise<ExitCode> {
  const app = required(id, "an application id", "spaceship app get 3f8b9a2e-5c41-4d6a");
  const { data, rateLimit } = await client.get<HyperliftApp>(
    `/v1/hyperlift/applications/${encodeURIComponent(app)}`,
  );
  return emitResult(ctx, data, { rateLimit }, (a) => {
    line(`\n${bold(a.name ?? a.id)}\n`);
    field("id", a.id);
    if (a.status) field("status", a.status);
    if (a.buildStatus) field("build", a.buildStatus);
    field("running", a.scale === null || a.scale === undefined ? muted("unknown") : a.scale > 0 ? ok("yes") : muted("no"));
    if (a.domain) field("domain", a.domain);
    if (a.repository) field("repository", a.repository);
    line("");
  });
}

export async function appEnvGet(ctx: EmitContext, client: SpaceshipClient, id?: string): Promise<ExitCode> {
  const app = required(id, "an application id", "spaceship app env get 3f8b9a2e");
  const { data, rateLimit } = await client.get<Record<string, unknown>>(
    `/v1/hyperlift/applications/${encodeURIComponent(app)}/environment`,
  );
  return emitResult(ctx, data, { rateLimit }, (env) => {
    const entries = Object.entries(env);
    if (entries.length === 0) {
      line(`\n${muted("No environment variables.")}\n`);
      return;
    }
    line("");
    // Values are secrets by default; the human view names them without printing them.
    for (const [key] of entries) line(`  ${bold(key)}  ${muted("(hidden — use --json to read values)")}`);
    line("");
  });
}

async function appLogLike(
  ctx: EmitContext,
  client: SpaceshipClient,
  id: string | undefined,
  suffix: string,
  example: string,
): Promise<ExitCode> {
  const app = required(id, "an application id", example);
  const { data, rateLimit } = await client.get<HyperliftLogs>(
    `/v1/hyperlift/applications/${encodeURIComponent(app)}/${suffix}`,
  );
  return emitResult(ctx, data, { rateLimit }, (logs) => {
    const items = logs.items ?? [];
    if (items.length === 0) {
      line(`\n${muted("No log lines returned.")}\n`);
      return;
    }
    for (const entry of items) {
      const stamp = entry.timestamp ? dim(`${entry.timestamp.slice(0, 19)} `) : "";
      line(`${stamp}${entry.message ?? ""}`);
    }
  });
}

export const appLogs = (ctx: EmitContext, client: SpaceshipClient, id?: string): Promise<ExitCode> =>
  appLogLike(ctx, client, id, "logs", "spaceship app logs 3f8b9a2e");

export const appBuildLogs = (ctx: EmitContext, client: SpaceshipClient, id?: string): Promise<ExitCode> =>
  appLogLike(ctx, client, id, "build-logs", "spaceship app build-logs 3f8b9a2e");

export async function appMetrics(ctx: EmitContext, client: SpaceshipClient, id?: string): Promise<ExitCode> {
  const app = required(id, "an application id", "spaceship app metrics 3f8b9a2e");
  const { data, rateLimit } = await client.get<HyperliftMetrics>(
    `/v1/hyperlift/applications/${encodeURIComponent(app)}/metrics`,
  );
  return emitResult(ctx, data, { rateLimit }, (metrics) => {
    line(`\n${JSON.stringify(metrics, null, 2)}\n`);
  });
}

export { EXIT };
