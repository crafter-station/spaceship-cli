import { existsSync } from "node:fs";
import { runDoctor, type DoctorCheck } from "../cli/agent/doctor.js";
import { bold, danger, dim, muted, ok as okColor, padVisible, warn } from "../cli/platform/style.js";
import { EXIT, type ExitCode } from "../contract.js";
import { emitResult, type EmitContext } from "../output/envelope.js";
import { SpaceshipClient } from "../client.js";
import { accountLabel, clientOptions, resolveCredentials, verifyCredentials } from "../credentials.js";
import type { CredentialSource } from "../keychain.js";
import { DEFAULT_PROFILE, describeProfileSource, type ProfileSelection } from "../profiles.js";
import { paths } from "../audit.js";
import { join } from "node:path";

/**
 * Answers "is this thing set up correctly" without ever printing a secret.
 * Each check reports presence and origin, never the value.
 */

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const mask = (value: string): string =>
  value.length <= 8 ? "•".repeat(value.length) : `${value.slice(0, 4)}${"•".repeat(Math.min(value.length - 8, 12))}${value.slice(-4)}`;

/** Names the variable rather than "environment", since that is what the user would unset. */
const origin = (source: CredentialSource | null, variable: string): string =>
  source === "environment" ? variable : (source ?? "nowhere");

export async function doctor(
  ctx: EmitContext,
  args: { url?: string; profile?: ProfileSelection } = {},
): Promise<ExitCode> {
  const profile = args.profile ?? { name: DEFAULT_PROFILE, source: "default" as const };
  const resolved = resolveCredentials(profile);
  const { apiKey, apiSecret } = resolved;
  const loginCommand = `spaceship auth login${profile.source === "flag" ? ` --profile ${profile.name}` : ""}`;

  const result = await runDoctor([
    async (): Promise<DoctorCheck> => {
      const chosen = profile.source === "default" ? profile.name : `${profile.name} (${describeProfileSource(profile.source)})`;
      // A stored profile that the environment out-ranks is the setup most
      // likely to surprise, so the row says which one actually applies.
      const overridden = apiKey && accountLabel(resolved) === "environment" && profile.source !== "default";
      return {
        name: "profile",
        ok: true,
        detail: overridden ? `${chosen}, overridden by SPACESHIP_API_KEY` : chosen,
      };
    },
    async (): Promise<DoctorCheck> => ({
      name: "api key",
      ok: Boolean(apiKey),
      detail: apiKey
        ? `${mask(apiKey)} from ${origin(resolved.keySource, "SPACESHIP_API_KEY")}`
        : `not set — run \`${loginCommand}\``,
    }),
    async (): Promise<DoctorCheck> => ({
      name: "api secret",
      ok: Boolean(apiSecret),
      detail: apiSecret
        ? `${apiSecret.length} characters from ${origin(resolved.secretSource, "SPACESHIP_API_SECRET")}`
        : `not set — run \`${loginCommand}\``,
    }),
    async (): Promise<DoctorCheck> => {
      if (!apiKey || !apiSecret) {
        return { name: "credentials work", ok: false, detail: "skipped, nothing to test" };
      }
      try {
        const client = new SpaceshipClient({ apiKey, apiSecret }, clientOptions(args.url ? { SPACESHIP_API_URL: args.url } as NodeJS.ProcessEnv : undefined));
        const verified = await verifyCredentials(client);
        if (verified.scoped) {
          // Authenticated, just not allowed to list domains: a key issued for
          // one job. That is a working setup, so the check passes and says so.
          return {
            name: "credentials work",
            ok: true,
            detail: "accepted; scoped key without domains:read, so the domain count is unknown",
          };
        }
        const budget = verified.rateLimit
          ? `, ${verified.rateLimit.remaining}/${verified.rateLimit.limit} requests left`
          : "";
        return {
          name: "credentials work",
          ok: true,
          detail: `${verified.domains} domain${verified.domains === 1 ? "" : "s"} in this account${budget}`,
        };
      } catch (error) {
        return {
          name: "credentials work",
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async (): Promise<DoctorCheck> => {
      const frozen = existsSync(join(paths().home, "KILLSWITCH"));
      return {
        name: "writes allowed",
        // A killswitch that is deliberately on is not a broken setup, so this
        // check passes either way and simply states which it is.
        ok: true,
        detail: frozen ? "frozen by the killswitch — reads still work" : "yes",
      };
    },
    async (): Promise<DoctorCheck> => {
      const dir = paths().home;
      return { name: "config directory", ok: true, detail: dir };
    },
  ]);

  const exit = result.ok ? EXIT.ok : EXIT.auth;

  emitResult(
    ctx,
    result,
    {
      nextSteps: result.ok ? [] : [{ command: loginCommand, reason: "Store working credentials" }],
    },
    (data) => {
      line("");
      for (const check of data.checks) {
        // Padded by visible width: "ok" and "fail" carry different amounts of
        // escape bytes, so padEnd on the styled string misaligns the column.
        const badge = padVisible(check.ok ? okColor("ok") : danger("fail"), 4);
        line(`  ${badge}  ${bold(padVisible(check.name, 18))} ${muted(check.detail)}`);
      }
      line("");
      line(
        data.ok
          ? `${okColor("ready")} ${muted("credentials verified against the API")}`
          : `${warn("not ready")} ${muted(`run \`${loginCommand}\``)}`,
      );
      line("");
    },
  );

  return exit;
}

export { dim };
