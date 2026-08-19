---
name: spaceship
description: "Manage Spaceship domains, DNS, contacts, transfers, marketplace listings and Hyperlift apps from the command line. Use when the user mentions Spaceship, asks about their domains, wants to check what is expiring, edit DNS records, transfer a domain in, list a domain for sale, or audit a domain portfolio for risk. Covers all 50 operations of the Spaceship public API."
---

# spaceship

Agent-first CLI for the Spaceship registrar API. Every command speaks JSON, every
write is gated, and every gate can be satisfied without a terminal.

## Output contract

One JSON envelope per command on stdout. JSON is automatic when stdout is not a
TTY, so `--json` is only needed when writing to a terminal.

```json
{
  "version": "1",
  "command": "domains list",
  "timestamp": "2026-08-19T00:00:00.000Z",
  "requestId": "spaceship-<uuid>",
  "ok": true,
  "result": { },
  "nextSteps": [{ "command": "...", "reason": "..." }],
  "rateLimit": { "limit": 300, "remaining": 297, "resetsAt": "..." }
}
```

On failure `ok` is false and `error` carries `code`, `message`, `hint` and
`retryable`. Branch on the exit code rather than parsing text:

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | unexpected failure inside the CLI |
| 2 | usage: bad or missing arguments |
| 3 | missing or rejected credentials |
| 4 | the target does not exist |
| 5 | network failure |
| 6 | refused by a trust gate or the killswitch |
| 7 | rate limited |
| 8 | an async operation was still pending when --wait timed out |

## Discovering the surface

`spaceship schema --json` returns all 50 operations with their trust tier, rate
limit, required scopes and whether they are asynchronous. Read that instead of
parsing `--help`.

## Credentials

`SPACESHIP_API_KEY` and `SPACESHIP_API_SECRET`, or `spaceship auth login` which
stores the secret in the OS keychain. `spaceship auth status --json` reports
whether credentials are in place and where they came from.

## Trust tiers

| Tier | What it covers | What it needs |
|---|---|---|
| T0 | reads | nothing |
| T1 | reversible writes | `--apply` |
| T2 | destructive, no money | `--apply --yes` |
| T3 | money or domain loss | `--apply --yes --confirm <target>` |

Without `--apply`, a mutating command previews the exact request it would send
and exits 0 having sent nothing. `--confirm` must match the target exactly.

`--dry-run` forces the preview even with `--apply` present.

## Asynchronous operations

`domains register`, `domains renew`, `domains restore` and `transfer start`
answer 202 and finish later.

- Without `--wait`: the result carries `operationId`; poll with `spaceship ops get <id>`.
- With `--wait`: the CLI polls until the operation settles. Add `--timeout <seconds>`
  to bound it; a timeout exits 8 rather than reporting success.

Do not write your own poll loop. The status endpoint allows 60 requests per 300
seconds and the CLI already paces itself inside that budget.

## Rate limits

The list endpoint allows 300 requests per 300 seconds; the per-domain endpoint
allows **5 per domain** per 300 seconds. Prefer `domains list` over looping
`domains get`, and prefer `portfolio lint` over checking domains one at a time:
it audits a whole portfolio in `ceil(total / 100)` requests.

## Worth composing

```bash
# What needs attention across the whole account, in one or two requests
spaceship portfolio lint --json

# What is expiring, most urgent first
spaceship domains list --json

# Check many names at once (20 per request, handled internally)
spaceship domains check a.com b.dev c.io --json

# Preview a change before committing to it
spaceship dns set example.com A www 76.76.21.21 --json

# Renew and wait for the registry to confirm
spaceship domains renew example.com --years 1 --apply --yes --confirm example.com --wait --json
```

## Safety notes

- `domains delete` cannot be undone and the name may be registered by someone
  else immediately. It is the only mutating endpoint with no documented rate limit.
- `domains renew` reads the current expiry from the API to build its
  double-charge guard; do not pass that date yourself.
- `dns set --force` disables Spaceship's conflict checker.
- Writes refuse while a killswitch file exists at the CLI's home directory.
  Reads and previews keep working.

## Keeping up with the API

`spaceship spec diff` compares the live API against the recorded snapshot and
exits 1 when something changed that affects a shipped command.
