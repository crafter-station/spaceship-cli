---
name: portfolio
description: "Audit and operate a whole Spaceship domain portfolio at once: find what is expiring, what lost its transfer lock, what is suspended, and what is past expiry but still recoverable. Use when the user asks about many domains rather than one, wants a sweep before a renewal cycle, asks what needs attention, or wants to apply the same change across a set of domains without hitting the API's per-domain rate limit."
compatibility: "Requires `spaceship` on PATH and working credentials. Run `spaceship doctor --json` first; it exits 3 when credentials are missing. Read the `core` skill for the output envelope and trust tiers."
---

# spaceship portfolio

Operating a whole account rather than one domain. The constraint that shapes
everything here is the API's rate limit asymmetry.

## The budget that decides the approach

| Endpoint | Limit |
|---|---|
| `GET /v1/domains` (the list) | 300 requests / 300s |
| `GET /v1/domains/{domain}` (one) | **5 per domain** / 300s |
| Most per-domain writes | 5 per domain / 300s |
| `POST /v1/domains/available` | 20 names per request, 30 requests / 30s |

Looping `domains get` over an account burns the per-domain budget and stalls.
The list endpoint returns **13 fields per domain, all of them required**, which
is enough to answer almost every portfolio question in `ceil(total / 100)`
requests.

Fields on every row: `name`, `unicodeName`, `isPremium`, `autoRenew`,
`registrationDate`, `expirationDate`, `lifecycleStatus`, `verificationStatus`,
`eppStatuses`, `suspensions`, `privacyProtection`, `nameservers`, `contacts`.

## Start here

```bash
spaceship portfolio lint --json
```

One or two requests for the whole account. Returns findings with a `severity`,
the domain, a message, and a runnable `fix`. The envelope's `result.requestsUsed`
reports what it cost.

```bash
spaceship portfolio rules --json     # what the seven rules check for
spaceship portfolio lint --rule expiring-without-autorenew --json
```

## Lifecycle states are not one "expired"

`lifecycleStatus` distinguishes states whose recovery cost differs, and treating
them as one loses the difference that matters:

| State | What it means | Fix |
|---|---|---|
| `registered` | normal | none |
| `grace1` | past expiry, renewable at the normal price | `domains renew` |
| `grace2` | later in the grace period, still normal price | `domains renew` |
| `redemption` | recoverable only with a restore fee well above a renewal | `domains restore` |
| `creating` | registration still settling | wait |

A domain in `redemption` is urgent for a reason a date alone does not convey.

## Reading expiry without inverting it

Expiry has a counterintuitive direction: a large number of days is good. When
sorting or filtering, sort ascending by days remaining, and state the direction
in words rather than showing a bare number.

`spaceship domains list --json` returns every domain sorted most urgent first.

## Applying a change across many domains

There is no bulk write endpoint. Each domain is its own request against a 5-per-
domain budget, so:

1. Get the target set from one `portfolio lint` or `domains list` call.
2. Preview one domain first, without `--apply`, and read the request it builds.
3. Apply per domain, pausing between them. A tight loop trips the limit and the
   CLI will retry with the API's `Retry-After`, which is slower than pacing.

```bash
# Which domains lack auto-renew, as a list of names
spaceship portfolio lint --rule expiring-without-autorenew --json \
  | jq -r '.result.findings[].domain'
```

Every finding already carries the exact command that fixes it in `fix`. Prefer
running those over reconstructing the invocation.

## Checking availability in bulk

`spaceship domains check a.com b.dev c.io --json` batches 20 names per request
automatically. The result carries `premiumPricing` when a name is premium, so
availability and price arrive together.

## What this cannot do

- There is no transfer-out endpoint; the API exposes only the auth code and the
  lock, and `direction` has a single value, `in`.
- There is no bulk renew or bulk nameserver change.
- Deleting a domain has no documented rate limit and no undo.
