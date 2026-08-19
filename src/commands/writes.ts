import type { SpaceshipClient } from "../client.js";
import { AppError } from "../cli/foundation/error-map.js";
import { bold, dim, muted, ok } from "../cli/platform/style.js";
import type { ExitCode } from "../contract.js";
import type { EmitContext } from "../output/envelope.js";
import { runMutation, type MutateFlags } from "../mutate.js";
import type { DnsRecord } from "../types.js";

/**
 * T1 and T2 writes. Each builds its request body from the spec's required
 * fields, then hands it to the single mutation path that previews, gates,
 * audits and sends.
 */

type Args = Record<string, unknown> & { _: string[] };

function need(value: string | undefined, what: string, example: string): string {
  if (!value) {
    throw new AppError("usage", {
      name: "MissingArgument",
      human: `This command needs ${what}.`,
      hint: `Example: ${example}`,
    });
  }
  return value;
}

/**
 * A switch with no default: a flag that silently means "off" would turn a typo
 * into an unintended change.
 */
function toggle(args: Args, on: string, off: string, what: string, example: string): boolean {
  if (args[on] === true && args[off] === true) {
    throw new AppError("usage", {
      name: "ConflictingFlags",
      human: `--${on} and --${off} cannot both be given.`,
      hint: `Example: ${example}`,
    });
  }
  if (args[on] === true) return true;
  if (args[off] === true) return false;
  throw new AppError("usage", {
    name: "MissingArgument",
    human: `This command needs --${on} or --${off} to say what ${what} should be.`,
    hint: `Example: ${example}`,
  });
}

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const applied = (target: string, message: string) => (): void => {
  line(`\n${ok("done")}  ${bold(target)} ${muted(message)}\n`);
};

// ------------------------------------------------------------ domain settings

export function domainsAutorenew(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const domain = need(args._[2], "a domain name", "spaceship domains autorenew example.com --on --apply");
  const isEnabled = toggle(args, "on", "off", "auto-renew", "spaceship domains autorenew example.com --on --apply");
  return runMutation(ctx, client, flags, {
    command: "domains autorenew",
    trust: "T1",
    target: domain,
    method: "PUT",
    path: `/v1/domains/${encodeURIComponent(domain)}/autorenew`,
    body: { isEnabled },
    summary: `turn auto-renew ${isEnabled ? "on" : "off"}`,
    warning: isEnabled ? undefined : "With auto-renew off, this domain expires unless you renew it by hand.",
    render: applied(domain, `auto-renew is now ${isEnabled ? "on" : "off"}`),
  });
}

export function transferLock(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const domain = need(args._[2], "a domain name", "spaceship transfer lock example.com --on --apply");
  const isLocked = toggle(args, "on", "off", "the transfer lock", "spaceship transfer lock example.com --on --apply");
  return runMutation(ctx, client, flags, {
    command: "transfer lock",
    trust: "T1",
    target: domain,
    method: "PUT",
    path: `/v1/domains/${encodeURIComponent(domain)}/transfer/lock`,
    body: { isLocked },
    summary: `${isLocked ? "lock" : "unlock"} transfers`,
    warning: isLocked ? undefined : "An unlocked domain can be transferred away by anyone holding the auth code.",
    render: applied(domain, `transfers are now ${isLocked ? "locked" : "unlocked"}`),
  });
}

export function domainsPrivacy(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const domain = need(args._[2], "a domain name", "spaceship domains privacy example.com --level high --apply");
  const level = String(args.level ?? "");
  if (level !== "high" && level !== "public") {
    throw new AppError("usage", {
      name: "MissingArgument",
      human: "This command needs --level high or --level public.",
      hint: "Example: spaceship domains privacy example.com --level high --apply",
    });
  }
  // The API requires userConsent on this call: it is the registrant agreeing to
  // the change, so the CLI asks for it explicitly rather than sending true.
  if (args.consent !== true) {
    throw new AppError("usage", {
      name: "ConsentRequired",
      human: "Changing WHOIS privacy records the registrant's consent.",
      hint: "Add --consent once you have it. Example: spaceship domains privacy example.com --level high --consent --apply",
    });
  }
  return runMutation(ctx, client, flags, {
    command: "domains privacy",
    trust: "T1",
    target: domain,
    method: "PUT",
    path: `/v1/domains/${encodeURIComponent(domain)}/privacy/preference`,
    body: { privacyLevel: level, userConsent: true },
    summary: `set WHOIS privacy to ${level}`,
    warning: level === "public" ? "Public WHOIS exposes the registrant's name, address, email and phone." : undefined,
    render: applied(domain, `WHOIS privacy is now ${level}`),
  });
}

export function domainsEmailProtection(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const domain = need(args._[2], "a domain name", "spaceship domains email-protection example.com --on --apply");
  const contactForm = toggle(
    args,
    "on",
    "off",
    "the WHOIS contact form",
    "spaceship domains email-protection example.com --on --apply",
  );
  return runMutation(ctx, client, flags, {
    command: "domains email-protection",
    trust: "T1",
    target: domain,
    method: "PUT",
    path: `/v1/domains/${encodeURIComponent(domain)}/privacy/email-protection-preference`,
    body: { contactForm },
    summary: `turn the WHOIS contact form ${contactForm ? "on" : "off"}`,
    render: applied(domain, `contact form is now ${contactForm ? "on" : "off"}`),
  });
}

export function domainsNameservers(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const domain = need(args._[2], "a domain name", "spaceship domains nameservers example.com --host ns1.example.com --apply");
  const hosts = args._.slice(3).concat(
    typeof args.host === "string" ? [args.host] : Array.isArray(args.host) ? (args.host as string[]) : [],
  );
  const basic = args.basic === true;

  if (!basic && hosts.length === 0) {
    throw new AppError("usage", {
      name: "MissingArgument",
      human: "This command needs nameserver hosts, or --basic to use Spaceship's own.",
      hint: "Example: spaceship domains nameservers example.com ns1.example.com ns2.example.com --apply",
    });
  }

  return runMutation(ctx, client, flags, {
    command: "domains nameservers",
    trust: "T1",
    target: domain,
    method: "PUT",
    path: `/v1/domains/${encodeURIComponent(domain)}/nameservers`,
    body: basic ? { provider: "basic" } : { provider: "custom", hosts },
    summary: basic ? "use Spaceship's basic nameservers" : `point at ${hosts.length} custom nameserver${hosts.length === 1 ? "" : "s"}`,
    details: basic ? undefined : { hosts: hosts.join(", ") },
    warning: "Changing nameservers moves DNS resolution; existing records on the old provider stop applying.",
    render: applied(domain, basic ? "now on basic nameservers" : `now pointing at ${hosts.join(", ")}`),
  });
}

export function domainsContacts(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const domain = need(args._[2], "a domain name", "spaceship domains contacts example.com --registrant <id> --apply");
  const registrant = need(
    typeof args.registrant === "string" ? args.registrant : undefined,
    "a registrant contact id",
    "spaceship domains contacts example.com --registrant <id> --apply",
  );
  const body: Record<string, string> = { registrant };
  for (const role of ["admin", "tech", "billing"] as const) {
    if (typeof args[role] === "string") body[role] = args[role] as string;
  }
  return runMutation(ctx, client, flags, {
    command: "domains contacts",
    trust: "T1",
    target: domain,
    method: "PUT",
    path: `/v1/domains/${encodeURIComponent(domain)}/contacts`,
    body,
    summary: "set the domain contacts",
    details: body,
    render: applied(domain, "contacts updated"),
  });
}

// --------------------------------------------------------------------- dns

/** `type name value` is the shape every registrar UI uses, so the CLI matches it. */
function parseRecord(args: Args): DnsRecord {
  const [, , , type, name, value] = args._;
  const kind = need(type, "a record type", "spaceship dns set example.com A www 76.76.21.21 --apply").toUpperCase();
  const host = need(name, "a record name", "spaceship dns set example.com A www 76.76.21.21 --apply");
  const ttl = args.ttl === undefined ? undefined : Number(args.ttl);

  const record: DnsRecord = { type: kind, name: host, group: "custom", ...(ttl === undefined ? {} : { ttl }) };
  const content = need(value, "a record value", "spaceship dns set example.com A www 76.76.21.21 --apply");

  switch (kind) {
    case "A":
    case "AAAA":
      record.address = content;
      break;
    case "CNAME":
    case "ALIAS":
      record.cname = content;
      break;
    case "MX":
      record.exchange = content;
      record.preference = args.preference === undefined ? 10 : Number(args.preference);
      break;
    case "SRV":
      record.target = content;
      record.port = args.port === undefined ? undefined : Number(args.port);
      record.priority = args.priority === undefined ? 0 : Number(args.priority);
      record.weight = args.weight === undefined ? 0 : Number(args.weight);
      break;
    default:
      record.value = content;
  }
  return record;
}

export function dnsSet(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const domain = need(args._[2], "a domain name", "spaceship dns set example.com A www 76.76.21.21 --apply");
  const record = parseRecord(args);
  const force = args.force === true;

  return runMutation(ctx, client, flags, {
    command: "dns set",
    trust: "T1",
    target: domain,
    method: "PUT",
    path: `/v1/dns/records/${encodeURIComponent(domain)}`,
    // This endpoint adds records rather than replacing the zone, and `force`
    // switches off the API's own conflict checker.
    body: { force, items: [record] },
    summary: `add or update one ${record.type} record`,
    details: { name: record.name, value: record.address ?? record.cname ?? record.exchange ?? record.target ?? record.value ?? "", ttl: record.ttl ?? "default" },
    warning: force ? "--force turns off Spaceship's conflict checker; conflicting records will be overwritten." : undefined,
    nextSteps: () => [{ command: `spaceship dns list ${domain}`, reason: "Confirm the record landed" }],
    render: applied(domain, `${record.type} ${record.name} saved`),
  });
}

export function dnsDelete(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const domain = need(args._[2], "a domain name", "spaceship dns delete example.com A www --apply");
  const type = need(args._[3], "a record type", "spaceship dns delete example.com A www --apply").toUpperCase();
  const name = need(args._[4], "a record name", "spaceship dns delete example.com A www --apply");

  return runMutation(ctx, client, flags, {
    command: "dns delete",
    trust: "T2",
    target: domain,
    method: "DELETE",
    path: `/v1/dns/records/${encodeURIComponent(domain)}`,
    body: [{ type, name }],
    summary: `delete the ${type} record on ${name}`,
    warning: "Deleted records are not recoverable from the API; re-create them by hand if this is wrong.",
    nextSteps: () => [{ command: `spaceship dns list ${domain}`, reason: "Confirm what remains" }],
    render: applied(domain, `${type} ${name} deleted`),
  });
}

// ------------------------------------------------------- personal nameservers

export function nsSet(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const domain = need(args._[2], "a domain name", "spaceship ns set example.com ns1.example.com 1.2.3.4 --apply");
  const host = need(args._[3], "a nameserver host", "spaceship ns set example.com ns1.example.com 1.2.3.4 --apply");
  const ips = args._.slice(4);
  if (ips.length === 0) {
    throw new AppError("usage", {
      name: "MissingArgument",
      human: "This command needs at least one IP address.",
      hint: "Example: spaceship ns set example.com ns1.example.com 1.2.3.4 --apply",
    });
  }
  return runMutation(ctx, client, flags, {
    command: "ns set",
    trust: "T1",
    target: `${host} (${domain})`,
    method: "PUT",
    path: `/v1/domains/${encodeURIComponent(domain)}/personal-nameservers/${encodeURIComponent(host)}`,
    body: { host, ips },
    summary: `point ${host} at ${ips.join(", ")}`,
    render: applied(host, `now resolving to ${ips.join(", ")}`),
  });
}

export function nsDelete(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const domain = need(args._[2], "a domain name", "spaceship ns delete example.com ns1.example.com --apply");
  const host = need(args._[3], "a nameserver host", "spaceship ns delete example.com ns1.example.com --apply");
  return runMutation(ctx, client, flags, {
    command: "ns delete",
    trust: "T2",
    target: `${host} (${domain})`,
    method: "DELETE",
    path: `/v1/domains/${encodeURIComponent(domain)}/personal-nameservers/${encodeURIComponent(host)}`,
    summary: `delete the personal nameserver ${host}`,
    warning: "Any domain still pointing at this host stops resolving.",
    render: applied(host, "deleted"),
  });
}

// ---------------------------------------------------------------- contacts

const CONTACT_FIELDS = [
  "firstName",
  "lastName",
  "organization",
  "email",
  "address1",
  "address2",
  "city",
  "country",
  "stateProvince",
  "postalCode",
  "phone",
  "phoneExt",
  "fax",
  "faxExt",
  "taxNumber",
] as const;

const REQUIRED_CONTACT_FIELDS = ["firstName", "lastName", "email", "address1", "city", "country", "phone"] as const;

/** Accepts --first-name as well as --firstName, since both read naturally. */
const flagFor = (field: string): string => field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function contactsSave(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const body: Record<string, string> = {};
  for (const field of CONTACT_FIELDS) {
    const value = args[field] ?? args[flagFor(field)];
    if (typeof value === "string" && value !== "") body[field] = value;
  }

  const missing = REQUIRED_CONTACT_FIELDS.filter((field) => body[field] === undefined);
  if (missing.length > 0) {
    throw new AppError("usage", {
      name: "MissingArgument",
      human: `This command needs ${missing.map((f) => `--${flagFor(f)}`).join(", ")}.`,
      hint: 'Example: spaceship contacts save --first-name Ada --last-name Lovelace --email ada@example.com --address1 "1 Main St" --city London --country GB --phone +44.2071234567 --apply',
    });
  }

  return runMutation(ctx, client, flags, {
    command: "contacts save",
    trust: "T1",
    target: body.email ?? "contact",
    method: "PUT",
    path: "/v1/contacts",
    body,
    summary: "save a contact profile",
    details: { name: `${body.firstName} ${body.lastName}`, email: body.email ?? "", country: body.country ?? "" },
    nextSteps: (result) => {
      const id = (result as { contactId?: string } | null)?.contactId;
      return id ? [{ command: `spaceship contacts get ${id}`, reason: "Read the saved contact back" }] : [];
    },
    render: (result) => {
      const id = (result as { contactId?: string } | null)?.contactId;
      line(`\n${ok("saved")}  ${bold(id ?? "contact")}\n`);
      if (id) line(`  ${dim("use this id")} spaceship domains contacts <domain> --registrant ${id} --apply\n`);
    },
  });
}

export function contactsAttrsSave(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const raw = need(
    typeof args.data === "string" ? args.data : undefined,
    "the attributes as JSON",
    'spaceship contacts attrs-save --data \'{"tld":"ca","ciraLegalType":"CCT"}\' --apply',
  );
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new AppError("usage", {
      name: "InvalidJson",
      human: "--data is not valid JSON.",
      hint: 'Example: --data \'{"tld":"ca","ciraLegalType":"CCT"}\'',
    });
  }
  return runMutation(ctx, client, flags, {
    command: "contacts attrs-save",
    trust: "T1",
    target: "contact attributes",
    method: "PUT",
    path: "/v1/contacts/attributes",
    body,
    summary: "save TLD-specific contact attributes",
    render: (result) => {
      const id = (result as { contactId?: string } | null)?.contactId;
      line(`\n${ok("saved")}  ${bold(id ?? "attributes")}\n`);
    },
  });
}

// --------------------------------------------------------------- hyperlift

export function appBuild(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const id = need(args._[2], "an application id", "spaceship app build 3f8b9a2e --apply");
  return runMutation(ctx, client, flags, {
    command: "app build",
    trust: "T1",
    target: id,
    method: "POST",
    path: `/v1/hyperlift/applications/${encodeURIComponent(id)}/build`,
    summary: "trigger a build",
    nextSteps: () => [{ command: `spaceship app build-logs ${id}`, reason: "Follow the build" }],
    render: applied(id, "build started"),
  });
}

export function appRestart(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const id = need(args._[2], "an application id", "spaceship app restart 3f8b9a2e --apply");
  return runMutation(ctx, client, flags, {
    command: "app restart",
    trust: "T1",
    target: id,
    method: "POST",
    path: `/v1/hyperlift/applications/${encodeURIComponent(id)}/restart`,
    summary: "restart the application",
    warning: "The application is briefly unavailable while it restarts.",
    render: applied(id, "restarting"),
  });
}

export function appScale(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const id = need(args._[3], "an application id", "spaceship app scale 3f8b9a2e --to 1 --apply");
  const raw = args.to;
  if (raw !== 0 && raw !== 1 && raw !== "0" && raw !== "1") {
    throw new AppError("usage", {
      name: "MissingArgument",
      human: "This command needs --to 0 to stop the application or --to 1 to run it.",
      hint: "Example: spaceship app scale 3f8b9a2e --to 1 --apply",
    });
  }
  const scale = Number(raw);
  return runMutation(ctx, client, flags, {
    command: "app scale",
    trust: "T1",
    target: id,
    method: "PUT",
    path: `/v1/hyperlift/applications/${encodeURIComponent(id)}/scale`,
    body: { scale },
    summary: scale === 0 ? "stop the application" : "start the application",
    warning: scale === 0 ? "Stopping the application takes it offline until it is started again." : undefined,
    render: applied(id, scale === 0 ? "stopped" : "running"),
  });
}

export function appEnvSet(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const id = need(args._[3], "an application id", "spaceship app env set 3f8b9a2e KEY=value --apply");
  const pairs = args._.slice(4);
  if (pairs.length === 0) {
    throw new AppError("usage", {
      name: "MissingArgument",
      human: "This command needs at least one KEY=value pair.",
      hint: "Example: spaceship app env set 3f8b9a2e DATABASE_URL=postgres://... --apply",
    });
  }

  const body: Record<string, string> = {};
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index <= 0) {
      throw new AppError("usage", {
        name: "InvalidArgument",
        human: `"${pair}" is not a KEY=value pair.`,
        hint: "Example: spaceship app env set 3f8b9a2e DATABASE_URL=postgres://... --apply",
      });
    }
    body[pair.slice(0, index)] = pair.slice(index + 1);
  }

  return runMutation(ctx, client, flags, {
    command: "app env set",
    trust: "T1",
    target: id,
    method: "PUT",
    path: `/v1/hyperlift/applications/${encodeURIComponent(id)}/environment`,
    body,
    summary: `set ${Object.keys(body).length} environment variable${Object.keys(body).length === 1 ? "" : "s"}`,
    // Names only: the values are secrets and the preview is printed to a terminal.
    details: { variables: Object.keys(body).join(", ") },
    warning: "This replaces the variables named here; the application restarts to pick them up.",
    render: applied(id, `${Object.keys(body).join(", ")} updated`),
  });
}
