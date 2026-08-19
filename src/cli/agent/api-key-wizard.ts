// cligentic block: api-key-wizard
//
// Interactive first-run wizard for API-key-authenticated CLIs. Prompts
// for the key, validates it against the live API, and persists the
// result. The three side effects are split into callbacks so you can
// drop this into any CLI without coupling to a specific config format
// (TOML, JSON, env file, keychain).
//
// Design rules:
//   1. Prompt first, validate second, save last. Never save an unvalidated key.
//   2. Mask input (clack password). Never print the raw key.
//   3. All long-running steps (validate, save) expose a spinner.
//   4. Validator returns a typed "identity" object — whatever `whoami`-ish
//      data your API returns. The wizard surfaces it on success ("Authenticated
//      as <email>") so the user knows they pasted the right key.
//   5. On cancel the caller decides the exit code. The wizard throws
//      ApiKeyWizardCancelled; never calls process.exit.
//   6. On validation failure the wizard throws ApiKeyWizardValidationFailed
//      with the underlying error. Nothing is saved.
//
// Usage:
//   import { runApiKeyWizard } from "./agent/api-key-wizard";
//
//   await runApiKeyWizard({
//     appName: "v0",
//     keyLocationHint: "https://v0.app/chat/settings/keys",
//     validateKey: async (key) => {
//       const res = await fetch("https://api.v0.dev/v1/user", {
//         headers: { Authorization: `Bearer ${key}` },
//       });
//       if (!res.ok) throw new Error(`HTTP ${res.status}`);
//       return await res.json();
//     },
//     identityLabel: (user) => user.email ?? user.id ?? "unknown",
//     saveKey: async (key) => {
//       await saveProfile("default", { auth: { api_key: key } });
//     },
//     shapeHint: (v) => (v.startsWith("v1:") || v.length > 20 ? undefined : "That does not look right"),
//   });
//
// Depends on:
//   - @clack/prompts (password, spinner, log, cancel, isCancel)

import * as p from '@clack/prompts'

export type ApiKeyWizardOptions<Identity> = {
  /** Display name of your CLI, used in prompts. e.g. "v0", "hapi", "sunat". */
  appName: string
  /** URL or instruction where the user can get a key. Shown in the prompt. */
  keyLocationHint: string
  /**
   * Called with the raw key to confirm it's valid against your API. Return
   * whatever identity object your `/user` or `/me` endpoint returns. Throw
   * on failure; the thrown error message is surfaced to the user.
   */
  validateKey: (key: string) => Promise<Identity>
  /** Pick a user-facing label from the identity object (email, name, id). */
  identityLabel: (identity: Identity) => string
  /**
   * Called once the key is validated. Typical implementations: write to a
   * TOML/JSON profile, export to an env file, push to the OS keychain.
   * Runs inside the save spinner.
   */
  saveKey: (key: string, identity: Identity) => Promise<void>
  /**
   * Optional synchronous sanity check before the API probe. Return
   * `undefined` if the key shape is plausible, or an error string to
   * re-prompt. If omitted, any non-empty string is allowed.
   */
  shapeHint?: (key: string) => string | undefined
  /** Optional minimum key length. Defaults to 10. */
  minLength?: number
  /** Optional intro title shown above the prompt. Defaults to `${appName} init`. */
  title?: string
  /** Label to show during validation. Defaults to "Validating key…". */
  validateLabel?: string
  /** Label to show during save. Defaults to "Saving credentials…". */
  saveLabel?: string
}

export class ApiKeyWizardCancelled extends Error {
  constructor() {
    super('User cancelled the api-key wizard')
    this.name = 'ApiKeyWizardCancelled'
  }
}

export class ApiKeyWizardValidationFailed extends Error {
  // `cause` is a standard Error field; declare the override explicitly
  // so strict TS configs (noImplicitOverride) don't complain.
  override readonly cause: unknown
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'ApiKeyWizardValidationFailed'
    this.cause = cause
  }
}

export type ApiKeyWizardResult<Identity> = {
  /** The raw key the user entered (already validated + saved). */
  key: string
  /** The identity object returned by `validateKey`. */
  identity: Identity
  /** The user-facing label derived via `identityLabel`. */
  label: string
}

/**
 * Runs the interactive wizard end-to-end. Returns the saved key + identity
 * on success. Throws ApiKeyWizardCancelled or ApiKeyWizardValidationFailed
 * otherwise — never calls process.exit.
 */
export async function runApiKeyWizard<Identity>(
  opts: ApiKeyWizardOptions<Identity>,
): Promise<ApiKeyWizardResult<Identity>> {
  const minLength = opts.minLength ?? 10
  const title = opts.title ?? `${opts.appName} init`

  p.intro(title)

  const keyInput = await p.password({
    message: `Paste your ${opts.appName} API key (grab one at ${opts.keyLocationHint}):`,
    mask: '•',
    validate: (v) => {
      if (!v || v.length < minLength) return 'Key looks too short.'
      if (opts.shapeHint) return opts.shapeHint(v)
      return undefined
    },
  })
  if (p.isCancel(keyInput)) {
    p.cancel('Cancelled. Nothing saved.')
    throw new ApiKeyWizardCancelled()
  }
  const key = keyInput as string

  const validateSpin = p.spinner()
  validateSpin.start(opts.validateLabel ?? 'Validating key…')
  let identity: Identity
  try {
    identity = await opts.validateKey(key)
  } catch (err) {
    validateSpin.stop(`Validation failed: ${err instanceof Error ? err.message : String(err)}`)
    p.cancel('Nothing saved. Double-check the key and try again.')
    throw new ApiKeyWizardValidationFailed(err)
  }
  const label = opts.identityLabel(identity)
  validateSpin.stop(`Key valid. Authenticated as ${label}.`)

  const saveSpin = p.spinner()
  saveSpin.start(opts.saveLabel ?? 'Saving credentials…')
  await opts.saveKey(key, identity)
  saveSpin.stop('Credentials saved.')

  return { key, identity, label }
}
