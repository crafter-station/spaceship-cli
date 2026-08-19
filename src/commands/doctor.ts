import { existsSync } from "node:fs";
import { runDoctor, type DoctorCheck } from "../cli/agent/doctor.js";
import { bold, danger, dim, muted, ok as okColor, padVisible, warn } from "../cli/platform/style.js";
import { EXIT, type ExitCode } from "../contract.js";
import { emitResult, type EmitContext } from "../output/envelope.js";
import { SpaceshipClient } from "../client.js";
import { clientOptions } from "../credentials.js";
import { storedApiKey, storedApiSecret } from "./auth.js";
import { paths } from "../audit.js";
import { join } from "node:path";
import type { Paged } from "../types.js";

/**
 * Answers "is this thing set up correctly" without ever printing a secret.
 * Each check reports presence and origin, never the value.
 */

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const mask = (value: string): string =>
  value.length <= 8 ? "•".repeat(value.length) : `${value.slice(0, 4)}${"•".repeat(Math.min(value.length - 8, 12))}${value.slice(-4)}`;

export async function doctor(ctx: EmitContext, args: { url?: string } = {}): Promise<ExitCode> {
  const envKey = process.env.SPACESHIP_API_KEY?.trim();
  const envSecret = process.env.SPACESHIP_API_SECRET?.trim();
  const configKey = storedApiKey();
  const keychainSecret = storedApiSecret();

  const apiKey = envKey || configKey || null;
  const apiSecret = envSecret || keychainSecret || null;

  const result = await runDoctor([
    async (): Promise<DoctorCheck> => ({
      name: "api key",
      ok: Boolean(apiKey),
      detail: apiKey
        ? `${mask(apiKey)} from ${envKey ? "SPACESHIP_API_KEY" : "stored config"}`
        : "not set — run `spaceship auth login`",
    }),
    async (): Promise<DoctorCheck> => ({
      name: "api secret",
      ok: Boolean(apiSecret),
      detail: apiSecret
        ? `${apiSecret.length} characters from ${envSecret ? "SPACESHIP_API_SECRET" : "keychain"}`
        : "not set — run `spaceship auth login`",
    }),
    async (): Promise<DoctorCheck> => {
      if (!apiKey || !apiSecret) {
        return { name: "credentials work", ok: false, detail: "skipped, nothing to test" };
      }
      try {
        const client = new SpaceshipClient({ apiKey, apiSecret }, clientOptions(args.url ? { SPACESHIP_API_URL: args.url } as NodeJS.ProcessEnv : undefined));
        const { data, rateLimit } = await client.get<Paged<unknown>>("/v1/domains", { take: 1, skip: 0 });
        const budget = rateLimit ? `, ${rateLimit.remaining}/${rateLimit.limit} requests left` : "";
        return {
          name: "credentials work",
          ok: true,
          detail: `${data.total} domain${data.total === 1 ? "" : "s"} in this account${budget}`,
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
      nextSteps: result.ok ? [] : [{ command: "spaceship auth login", reason: "Store working credentials" }],
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
          : `${warn("not ready")} ${muted("run `spaceship auth login`")}`,
      );
      line("");
    },
  );

  return exit;
}

export { dim };
