import type { SpaceshipClient } from "../client.js";
import { AppError } from "../cli/foundation/error-map.js";
import { bold, dim, muted, ok, warn } from "../cli/platform/style.js";
import type { ExitCode } from "../contract.js";
import type { EmitContext } from "../output/envelope.js";
import { runMutation, type MutateFlags } from "../mutate.js";
import type { DomainInfo } from "../types.js";

/**
 * Every command here is async so a validation failure rejects the returned
 * promise rather than throwing before it exists. A caller that has to handle
 * both shapes will eventually handle only one.
 *
 * T3: operations that spend money or lose a domain. Each one needs --apply,
 * --confirm matching the target, and leaves an audit record. Where the API
 * offers a guard against double-charging, the CLI reads it rather than letting
 * the caller supply it.
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

function positiveYears(raw: unknown, example: string): number {
  const years = raw === undefined ? 1 : Number(raw);
  if (!Number.isInteger(years) || years < 1 || years > 10) {
    throw new AppError("usage", {
      name: "InvalidArgument",
      human: "--years must be a whole number between 1 and 10.",
      hint: `Example: ${example}`,
    });
  }
  return years;
}

function price(raw: unknown, flag: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError("usage", {
      name: "InvalidArgument",
      human: `--${flag} must be a positive amount.`,
      hint: `Example: --${flag} 2500`,
    });
  }
  return value;
}

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const money = (amount: number, currency = "USD"): string => `${amount.toFixed(2)} ${currency}`;

/** Spelled out because a reader approving a charge should see the words. */
const CONFIRM_HINT = (target: string): string =>
  `Add --apply --confirm ${target} once you have read the preview.`;

// ------------------------------------------------------------ domain lifecycle

export async function domainsRegister(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const example = "spaceship domains register example.com --registrant <id> --years 1 --apply --confirm example.com";
  const domain = need(args._[2], "a domain name", example);
  const registrant = need(
    typeof args.registrant === "string" ? args.registrant : undefined,
    "a registrant contact id",
    example,
  );
  const years = positiveYears(args.years, example);

  const contacts: Record<string, string> = { registrant };
  for (const role of ["admin", "tech", "billing"] as const) {
    contacts[role] = typeof args[role] === "string" ? (args[role] as string) : registrant;
  }

  // Registration writes the registrant into public WHOIS unless privacy is on,
  // so the consent the API asks for is requested here rather than assumed.
  const privacyLevel = args.public === true ? "public" : "high";
  if (privacyLevel === "public" && args.consent !== true) {
    throw new AppError("usage", {
      name: "ConsentRequired",
      human: "Registering with public WHOIS records the registrant's consent.",
      hint: "Add --consent, or drop --public to register with privacy on.",
    });
  }

  return runMutation(ctx, client, flags, {
    command: "domains register",
    trust: "T3",
    target: domain,
    method: "POST",
    path: `/v1/domains/${encodeURIComponent(domain)}`,
    body: {
      autoRenew: args["no-auto-renew"] !== true,
      years,
      privacyProtection: { level: privacyLevel, userConsent: true },
      contacts,
    },
    summary: `register for ${years} year${years === 1 ? "" : "s"}`,
    details: { registrant, privacy: privacyLevel, autoRenew: args["no-auto-renew"] !== true },
    warning: `This charges your account for ${years} year${years === 1 ? "" : "s"} of registration. ${CONFIRM_HINT(domain)}`,
    isAsync: true,
    nextSteps: () => [{ command: `spaceship domains get ${domain}`, reason: "Confirm the registration" }],
    render: () => line(`\n${ok("registered")}  ${bold(domain)} ${muted(`for ${years} year${years === 1 ? "" : "s"}`)}\n`),
  });
}

export async function domainsRenew(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const example = "spaceship domains renew example.com --years 1 --apply --confirm example.com";
  const domain = need(args._[2], "a domain name", example);
  const years = positiveYears(args.years, example);

  // The API requires the current expiry date and rejects the call when it does
  // not match, which is what stops a retry from charging twice. Reading it here
  // means the guard cannot be defeated by a stale value on the command line.
  const { data: current } = await client.get<DomainInfo>(`/v1/domains/${encodeURIComponent(domain)}`);

  return runMutation(ctx, client, flags, {
    command: "domains renew",
    trust: "T3",
    target: domain,
    method: "POST",
    path: `/v1/domains/${encodeURIComponent(domain)}/renew`,
    body: { years, currentExpirationDate: current.expirationDate },
    summary: `renew for ${years} year${years === 1 ? "" : "s"}`,
    details: {
      expires: current.expirationDate.slice(0, 10),
      after: new Date(
        new Date(current.expirationDate).setFullYear(new Date(current.expirationDate).getFullYear() + years),
      )
        .toISOString()
        .slice(0, 10),
    },
    warning: `This charges your account. ${CONFIRM_HINT(domain)}`,
    isAsync: true,
    nextSteps: () => [{ command: `spaceship domains get ${domain}`, reason: "Confirm the new expiry date" }],
    render: () => line(`\n${ok("renewed")}  ${bold(domain)} ${muted(`for ${years} year${years === 1 ? "" : "s"}`)}\n`),
  });
}

export async function domainsRestore(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const example = "spaceship domains restore example.com --apply --confirm example.com";
  const domain = need(args._[2], "a domain name", example);
  return runMutation(ctx, client, flags, {
    command: "domains restore",
    trust: "T3",
    target: domain,
    method: "POST",
    path: `/v1/domains/${encodeURIComponent(domain)}/restore`,
    summary: "restore from redemption",
    warning: `Restoring a domain in redemption carries a fee well above a renewal. ${CONFIRM_HINT(domain)}`,
    isAsync: true,
    nextSteps: () => [{ command: `spaceship domains get ${domain}`, reason: "Confirm the domain is back" }],
    render: () => line(`\n${ok("restored")}  ${bold(domain)}\n`),
  });
}

export async function domainsDelete(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const example = "spaceship domains delete example.com --apply --confirm example.com";
  const domain = need(args._[2], "a domain name", example);
  return runMutation(ctx, client, flags, {
    command: "domains delete",
    trust: "T3",
    target: domain,
    method: "DELETE",
    path: `/v1/domains/${encodeURIComponent(domain)}`,
    summary: "delete the domain",
    // This is the only mutating endpoint the spec documents no rate limit for,
    // and the only one whose result cannot be undone from the API at all.
    warning: `This releases the domain. It cannot be undone, and the name may be registered by someone else. ${CONFIRM_HINT(domain)}`,
    render: () => line(`\n${warn("deleted")}  ${bold(domain)}\n`),
  });
}

export async function transferStart(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const example = "spaceship transfer start example.com --registrant <id> --apply --confirm example.com";
  const domain = need(args._[2], "a domain name", example);
  const registrant = need(
    typeof args.registrant === "string" ? args.registrant : undefined,
    "a registrant contact id",
    example,
  );
  const contacts: Record<string, string> = { registrant };
  for (const role of ["admin", "tech", "billing"] as const) {
    contacts[role] = typeof args[role] === "string" ? (args[role] as string) : registrant;
  }

  return runMutation(ctx, client, flags, {
    command: "transfer start",
    trust: "T3",
    target: domain,
    method: "POST",
    path: `/v1/domains/${encodeURIComponent(domain)}/transfer`,
    body: {
      autoRenew: args["no-auto-renew"] !== true,
      privacyProtection: { level: args.public === true ? "public" : "high", userConsent: true },
      contacts,
    },
    summary: "transfer the domain in",
    details: { registrant },
    warning: `A transfer charges for one year and needs the auth code entered at the losing registrar. ${CONFIRM_HINT(domain)}`,
    isAsync: true,
    nextSteps: () => [{ command: `spaceship transfer status ${domain}`, reason: "Follow the transfer" }],
    render: () => line(`\n${ok("transfer started")}  ${bold(domain)}\n`),
  });
}

// ---------------------------------------------------------------- marketplace

export async function marketAdd(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const example = "spaceship market add example.com --bin 2500 --apply --confirm example.com";
  const domain = need(args._[2], "a domain name", example);

  const body: Record<string, unknown> = { name: domain };
  if (args.bin !== undefined) {
    body.binPrice = price(args.bin, "bin");
    body.binPriceEnabled = true;
  }
  if (args.min !== undefined) {
    body.minPrice = price(args.min, "min");
    body.minPriceEnabled = true;
  }
  if (typeof args["display-name"] === "string") body.displayName = args["display-name"];
  if (typeof args.description === "string") body.description = args.description;

  return runMutation(ctx, client, flags, {
    command: "market add",
    trust: "T3",
    target: domain,
    method: "POST",
    path: "/v1/sellerhub/domains",
    body,
    summary: "list the domain for sale",
    details: {
      buyNow: body.binPrice === undefined ? "not set" : money(body.binPrice as number),
      minimum: body.minPrice === undefined ? "not set" : money(body.minPrice as number),
    },
    warning: `Listing publishes the domain for sale at these prices. ${CONFIRM_HINT(domain)}`,
    nextSteps: () => [{ command: `spaceship market get ${domain}`, reason: "Read the listing back" }],
    render: () => line(`\n${ok("listed")}  ${bold(domain)}\n`),
  });
}

export async function marketUpdate(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const example = "spaceship market update example.com --bin 3000 --apply --confirm example.com";
  const domain = need(args._[2], "a domain name", example);

  const body: Record<string, unknown> = {};
  if (args.bin !== undefined) {
    body.binPrice = price(args.bin, "bin");
    body.binPriceEnabled = true;
  }
  if (args.min !== undefined) {
    body.minPrice = price(args.min, "min");
    body.minPriceEnabled = true;
  }
  if (args["no-bin"] === true) body.binPriceEnabled = false;
  if (args["no-min"] === true) body.minPriceEnabled = false;
  if (typeof args["display-name"] === "string") body.displayName = args["display-name"];
  if (typeof args.description === "string") body.description = args.description;

  if (Object.keys(body).length === 0) {
    throw new AppError("usage", {
      name: "NothingToChange",
      human: "This command needs at least one field to change.",
      hint: `Example: ${example}`,
    });
  }

  return runMutation(ctx, client, flags, {
    command: "market update",
    trust: "T3",
    target: domain,
    method: "PATCH",
    path: `/v1/sellerhub/domains/${encodeURIComponent(domain)}`,
    body,
    summary: "update the listing",
    details: Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])),
    warning: `This changes a published price. ${CONFIRM_HINT(domain)}`,
    render: () => line(`\n${ok("updated")}  ${bold(domain)}\n`),
  });
}

export async function marketRemove(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const example = "spaceship market remove example.com --apply --confirm example.com";
  const domain = need(args._[2], "a domain name", example);
  return runMutation(ctx, client, flags, {
    command: "market remove",
    trust: "T3",
    target: domain,
    method: "DELETE",
    path: `/v1/sellerhub/domains/${encodeURIComponent(domain)}`,
    summary: "remove the listing",
    warning: `Any checkout link for this listing stops working. ${CONFIRM_HINT(domain)}`,
    render: () => line(`\n${warn("removed")}  ${bold(domain)}\n`),
  });
}

export async function marketCheckoutLink(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const example = "spaceship market checkout-link example.com --price 2500 --apply --confirm example.com";
  const domain = need(args._[2], "a domain name", example);
  const basePrice = price(args.price, "price");

  return runMutation<{ url?: string }>(ctx, client, flags, {
    command: "market checkout-link",
    trust: "T3",
    target: domain,
    method: "POST",
    path: "/v1/sellerhub/checkout-links",
    body: {
      type: "buyNow",
      domainName: domain,
      basePrice,
      ...(args.fee === undefined ? {} : { feePercentageShare: Number(args.fee) }),
    },
    summary: `create a Buy Now link at ${money(basePrice)}`,
    warning: `Anyone with this link can buy the domain at ${money(basePrice)}. ${CONFIRM_HINT(domain)}`,
    render: (result) => {
      line(`\n${ok("checkout link")}  ${bold(domain)} ${muted(money(basePrice))}`);
      if (result?.url) line(`  ${result.url}`);
      line("");
    },
  });
}

export async function marketSafepayCreate(
  ctx: EmitContext,
  client: SpaceshipClient,
  flags: MutateFlags,
  args: Args,
): Promise<ExitCode> {
  const example =
    "spaceship market safepay create example.com --price 2500 --initiated-by seller --buyer-email a@b.com --apply --confirm example.com";
  const domain = need(args._[3], "a domain name", example);
  const basePrice = price(args.price, "price");
  const initiatedBy = String(args["initiated-by"] ?? "");
  if (!["seller", "buyer", "broker"].includes(initiatedBy)) {
    throw new AppError("usage", {
      name: "InvalidArgument",
      human: "--initiated-by must be seller, buyer or broker.",
      hint: `Example: ${example}`,
    });
  }

  const body: Record<string, unknown> = {
    domainName: domain,
    initiatedBy,
    basePrice,
    type: args.lto === true ? "leaseToOwn" : "buyNow",
    feePercentageShare: args.fee === undefined ? 0 : Number(args.fee),
  };
  for (const [flag, key] of [
    ["buyer-email", "buyerEmail"],
    ["seller-email", "sellerEmail"],
    ["buyer-username", "buyerUsername"],
    ["seller-username", "sellerUsername"],
  ] as const) {
    if (typeof args[flag] === "string") body[key] = args[flag];
  }

  return runMutation(ctx, client, flags, {
    command: "market safepay create",
    trust: "T3",
    target: domain,
    method: "POST",
    path: "/v1/sellerhub/safepay-transactions",
    body,
    summary: `open a SafePay transaction at ${money(basePrice)}`,
    details: { initiatedBy, type: String(body.type), buyer: String(body.buyerEmail ?? "not set") },
    warning: `This opens an escrow transaction binding both parties at ${money(basePrice)}. ${CONFIRM_HINT(domain)}`,
    render: () => line(`\n${ok("transaction opened")}  ${bold(domain)} ${muted(money(basePrice))}\n`),
  });
}

export { dim };
