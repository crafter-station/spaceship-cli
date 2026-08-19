# @crafter/spaceship-cli

Agent-first CLI for the [Spaceship](https://www.spaceship.com) registrar API.
Covers all 50 operations of the public API: domains, DNS, contacts, transfers,
personal nameservers, the SellerHub marketplace, and Hyperlift applications.

```bash
spaceship portfolio lint
```

```
expired-one.dev
  critical  in the grace period, still renewable at the normal price
            spaceship domains renew expired-one.dev --apply

peru-ai.co
  critical  expires in 3 days and auto-renew is off
            spaceship domains autorenew peru-ai.co --on --apply

4 critical · 5 warning · 1 notice across 9 of 10 domains, 1 request
```

## Install

```bash
bun add -g @crafter/spaceship-cli
# or
npx @crafter/spaceship-cli --help
```

## Authenticate

Create a key at [spaceship.com/application/api-manager](https://www.spaceship.com/application/api-manager/),
then:

```bash
spaceship auth login    # stores the secret in your OS keychain
spaceship doctor        # confirms it works, without printing anything secret
```

`SPACESHIP_API_KEY` and `SPACESHIP_API_SECRET` also work and take precedence.

## Agent skills

The CLI serves its own instructions, so what an agent reads always matches the
version it is calling rather than a copy installed some time ago.

```bash
spaceship skills list          # what is bundled
spaceship skills get core      # the core guide, as markdown on stdout
spaceship skills get portfolio # operating many domains at once
```

`skills get` prints markdown by default, including when piped, so an agent can
pipe it straight into context. `--json` wraps it in the usual envelope when the
metadata is wanted alongside.

The same files also live in `skills/` for tools that read from disk:

```bash
ln -sfn "$PWD/skills/core" ~/.claude/skills/spaceship-core
```

## Designed for agents

- **One JSON envelope per command**, automatic when stdout is not a TTY.
- **`spaceship schema --json`** returns all 50 operations with their trust tier,
  rate limit and required scopes, so an agent introspects instead of parsing help.
- **Typed exit codes**: 0 success, 2 usage, 3 auth, 4 not found, 5 network,
  6 refused by a gate, 7 rate limited, 8 async timeout.
- **`nextSteps`** in every response, with values already substituted.

## Designed for the human supervising them

Writes are graded by what they cost if wrong:

| Tier | Covers | Requires |
|---|---|---|
| T0 | reads | nothing |
| T1 | reversible writes | `--apply` |
| T2 | destructive | `--apply --yes` |
| T3 | money or domain loss | `--apply --yes --confirm <target>` |

Without `--apply`, a mutating command prints the exact request it would send and
sends nothing. Every write leaves a two-phase audit record, written before the
call so an interrupted run is visible rather than silent. A `KILLSWITCH` file in
the config directory freezes every write while leaving reads working.

## Built around the API's real limits

`GET /v1/domains` allows 300 requests per 300 seconds; the per-domain endpoint
allows **5 per domain**. So `portfolio lint` audits an entire account from the
list endpoint in `ceil(total / 100)` requests rather than one per domain, and
`domains check` batches 20 names per request.

Register, renew, restore and transfer are asynchronous. `--wait` polls them to a
conclusion within the documented budget, so no caller writes its own backoff.

## Watching the API for changes

The Spaceship spec carries no version field and no ETag, so drift can only be
found by comparing content.

```bash
spaceship spec diff
```

It classifies every change by whether it affects a command this CLI ships: a new
required field on a shipped command is breaking and exits 1, the same field on an
endpoint nothing calls is informational and exits 0. Rate limits are parsed out
of the documentation prose, because a lowered limit changes behaviour without
changing a single type.

A daily workflow opens a pull request when the API moves, and an issue when
something breaking lands.

## Development

```bash
bun install
bun test
bun run typecheck
./scripts/setup-hooks.sh   # pre-push runs spec diff when the surface changes
```

## License

MIT
