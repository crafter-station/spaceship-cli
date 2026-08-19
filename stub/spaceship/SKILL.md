---
name: spaceship
description: "Manage Spaceship domains, DNS, contacts, transfers, marketplace listings and Hyperlift apps from the command line. Use when the user mentions Spaceship, asks about their domains, wants to check what is expiring or what needs attention, edit DNS records, transfer a domain in, register or renew a domain, list one for sale, or audit a whole domain portfolio for risk. Covers all 50 operations of the Spaceship public API, with a trust ladder so writes need explicit approval."
allowed-tools: Bash(spaceship:*), Bash(npx spaceship:*)
---

# spaceship

Agent-first CLI for the Spaceship registrar API. All 50 operations, one JSON
envelope per command, and every write behind a gate sized to what it costs.

Install: `bun add -g @crafter/spaceship-cli` (or `npm i -g`)

## Start here

This file is a discovery stub, not the usage guide. Load the real instructions
from the CLI before running anything:

```bash
spaceship skills get core        # output contract, exit codes, trust tiers, credentials
```

The CLI serves skill content that matches the installed version, so the
instructions cannot go stale. This stub cannot change between releases, which is
why it only points at `skills get core`.

## Specialized skills

```bash
spaceship skills get portfolio   # auditing many domains at once, rate-limit budget, bulk changes
spaceship skills list            # everything the installed version bundles
```

## Before the first command

```bash
spaceship doctor --json
```

Reports whether credentials are present, where they came from, and whether they
work, without printing a secret. Exits 3 when they are missing, so it doubles as
a precondition check. Fix with `spaceship auth login`.

## The two things worth knowing up front

**Writes need `--apply`.** Without it, a mutating command prints the exact
request it would send and sends nothing. Operations that spend money or delete a
domain also need `--confirm <target>` matching exactly.

**Prefer the list over the loop.** `GET /v1/domains` allows 300 requests per 300
seconds; the per-domain endpoint allows 5 per domain. `spaceship portfolio lint`
audits an entire account in one or two requests; looping `domains get` stalls.
