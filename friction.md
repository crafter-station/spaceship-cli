# friction.md — @crafter/spaceship-cli

## Phase 0: origen del contrato

**DISCOVERED.** El CLI envuelve la API de Spaceship, que no controlamos.
Recon ya hecho: `04_Projects/_shaping/spaceship-cli/recon.md` +
`spaceship-openapi.json` (OpenAPI 3.0.0 oficial, extraido de docs.spaceship.dev,
verificado contra la API viva). No hace falta correr `surface-recon`.

50 operaciones, 38 paths, 174 schemas, 11 areas.

## Phase 1: distribucion

**npm, build a Node.** Audiencia: devs del ecosistema JS + agentes.
Escrito contra la API de Node (`fs`, `path`, `process`, `fetch` global), no
contra APIs especificas de Bun, asi que compilar a binario nativo despues es
decision de build y no reescritura.

Shebang: `#!/usr/bin/env node` (NO `bun`). Razon: 3 de los 4 paquetes publicados
del portfolio ponen un shebang que nombra un runtime que el instalador no tiene
—falla con `env: bun: No such file or directory`, que no nombra causa ni fix.

## Decisiones de bloques cligentic

| Bloque | Decision | Razon |
|---|---|---|
| `json-mode` | **Adopt** | Dual-render humano/agente + auto-JSON sin TTY. R11, R19. |
| `global-flags` | **Adopt** | `--json`, `--dry-run`, `--profile` estandar. |
| `error-map` | **Adopt** | `AppError` con code/human/hint → exit codes tipados. R11. |
| `trust-ladder` | **Adopt** | T0-T3 ya modelado; T3 exige `--confirm <id>` que matchee el target. R14. |
| `argv` | **Adopt** | Parser POSIX sin dependencias. Evita commander. |
| `style` | **Adopt** | NO_COLOR + non-TTY + **ancho visible** (alineacion tras estilar). R19. |
| `detect` | **Adopt** | TTY/CI/WSL para decidir modo. |
| `banner` | **Adopt** | TTY-only, a stderr. R19. |
| `xdg-paths` | **Adopt** | Config en la ruta correcta por plataforma. |
| `config` | **Adopt** | Perfiles. Guarda API key id, nunca el secreto. |
| `atomic-write` | **Adopt** | Snapshot del spec sin corrupcion (V5). |
| `audit-log` | **Adopt** | JSONL day-bucketed 0600. Requerido por T3. |
| `audit-lifecycle` | **Adopt** | Two-phase pending→final. Las 4 async lo necesitan. |
| `killswitch` | **Adopt** | Gate binario para writes. Dominio con dinero. |
| `next-steps` | **Adopt** | `nextSteps` en JSON + comando ejecutable en humano. |
| `prompt-secret` | **Adopt** | API secret sin echo; null sin TTY en vez de colgar. |
| `doctor` | **Adopt** | `spaceship doctor`: credenciales, red, scopes, spec al dia. |
| `api-key-wizard` | **Adopt** | Spaceship es auth por key+secret; es el caso exacto. |
| `session` | **Reject** | Es para tokens con expiracion/refresh. Spaceship usa key+secret estaticos: `config` + keychain alcanza. |
| `telemetry` | **Reject** | CLI que maneja dominios y dinero ajeno. No mando nada afuera. |
| `skill-installer-prompt` | **Defer** | El skill se ships en el repo (`skills/spaceship/SKILL.md`); el prompt de install se evalua al publicar. |
| `copy-clipboard` | **Reject** | Nada que copiar. El auth-code sale por stdout. |
| `notify-os` | **Reject** | Las async se resuelven con `--wait`, no con notificacion de escritorio. |
| `open-url` | **Hybrid** | Solo para `api-key-wizard` → API Manager. No como comando propio. |

**Rechazos que importan:** `session` y `telemetry` no son omisiones. El primero
resuelve un problema que esta auth no tiene; el segundo manda datos afuera desde
un CLI que administra dominios de terceros.

## Fricciones encontradas

- `bun init -y` deja `index.ts`, `CLAUDE.md`, `README.md` y `.cursor/` que no
  pedi. Borrados a mano antes de scaffoldear.
- `emit` de cligentic parte los arrays en NDJSON, lo que romperia el contrato de
  un envelope por comando publicado a agentes. **Hybrid**: el resultado se
  envuelve antes de llegar al bloque. Un contrato publicado gana sobre un bloque
  compartido.
- `typeof fetch` en Bun exige `preconnect`, asi que un mock no tipa. Introducido
  `FetchLike` (solo la parte invocable) para que el cliente sea testeable sin
  implementar los estaticos del runtime.
- Leer el output humano una segunda vez encontro 3 defectos que ningun gate
  automatico atrapa: una columna `ASYNC` cuyas filas estaban todas vacias en T0,
  anchos recalculados por grupo (los bloques no alineaban entre si), y
  `domains check` apareciendo dos veces por mapear a dos endpoints. Los tres
  corregidos; el header ahora dice "49 commands over 50 API operations".
- Un test de alineacion mio estaba mal escrito (partia por `"  "`, que colisiona
  con el padding). El de anchos compartidos, en cambio, encontro un bug real:
  `trimEnd()` borra el padding de la ultima columna. Se corrigio el test para
  medir el offset de la segunda columna, que es lo que el lector percibe.

## V1 (23 read commands)

- **Hunter caught the banner unwired.** It was installed in V0 and never called,
  which is exactly the Phase 5 anti-pattern: a feature the docs imply and the
  code does not back. Now wired into the bare invoke and `--help`, on stderr,
  suppressed in JSON mode and when piped. Verified through a real TTY with
  `script -q /dev/null`, because a captured stdout hides it either way.
- Reading the human output a second time found three more defects no automated
  gate catches: `grace1` and `redemption` printed uncolored while the ordinary
  `ok` was grey (a loss state reading quieter than a normal one); `manual`
  renewal painted the same on a domain with 209 days left and one with 2; and
  the DNS table repeating its header once per record-type group, which is the
  noise the grouping existed to remove.
- `script -q /dev/null` is the way to see the real TTY branch from a captured
  shell. Without it every check silently exercises the machine path.

## V2 (portfolio lint)

- Two `DomainInfo` types had drifted apart (one declared in `domains-list.ts`
  during V1, one in `types.ts`). Consolidated on `types.ts`; the duplicate only
  surfaced because the stricter one used a union for `eppStatuses`.
- Reading the lint output found the repeated-header defect **again**, this time
  in the findings table, plus a worse one: only the first fix per domain was
  printed, so a domain with two problems looked like it needed one action.
  Both fixed. The lesson is that the rule ("repetition is a heading") does not
  transfer by having been applied once; each new table reintroduces it.
- `script -q /dev/null` fails with "tcgetattr/ioctl" if the shell already lost
  its TTY (after backgrounding a server in the same invocation). Run the mock
  detached with `nohup` and the command in a fresh shell.

## V3 (17 T1/T2 writes)

- **Two exit codes were wrong and only observation caught them.** The trust
  ladder throws `approval/required`, which was not in the exit map, so a refused
  T2 write exited 1 (runtime) instead of 6 (blocked). The killswitch block
  throws a plain `Error` for the same reason, so a deliberate freeze also looked
  like a crash. Both now map to `blocked`; an agent can tell "refused on
  purpose" from "the CLI broke". Neither was visible from the JSON body, only
  from `echo $?`.
- `killswitch` is a **hybrid**, not a straight adopt: the block's own
  `assertKillswitchOff` is wrapped so the failure carries a typed code and names
  the freeze reason. Its state file expects JSON; a plain-text reason reads back
  as "file exists but unreadable".
- The API requires `userConsent: true` on the privacy endpoint. That is the
  registrant agreeing, not a technical flag, so the CLI demands `--consent`
  rather than sending true on the caller's behalf. Sending it silently would
  make the consent record a lie.
- Toggles have no default. `--on`/`--off` are both required because a flag that
  silently means "off" turns a typo into an unintended change.

## V4 (10 T3 operations, async --wait)

- **Four tests failed and the code was right; the contract was wrong.** A
  validation that throws before the first `await` throws *synchronously*, so a
  caller using `.catch()` never sees it while one using `try` does. Same command,
  two shapes, depending on which line failed. Every command function is now
  `async`, so a failure always rejects the promise. The tests then passed
  untouched, which is the signal the fix was the real one rather than a test
  edit.
- `domains renew` requires `currentExpirationDate` and the API rejects a
  mismatch. That is a double-charge guard, so the CLI reads the date from the
  API instead of accepting it as a flag: a stale value on the command line
  cannot defeat it. There is a test asserting a caller-supplied date is ignored.
- `domains delete` is the only mutating endpoint the spec documents no rate
  limit for, and the only one with no undo. It carries the strongest warning.
- The async poll interval is 5s because the status endpoint allows 60 requests
  per 300 seconds. Picking a faster interval would have burned the budget with
  two operations in flight.

## auth (found by Hunter running the CLI)

- **The CLI advertised a command that did not exist.** Two error hints told the
  user to run `spaceship auth login`, which was never built: following the CLI's
  own advice produced "Unknown command". This is the Phase 5 anti-pattern in its
  purest form, and it shipped because a hint is prose, not a call site, so no
  wiring check covered it. There is now a test that scans every `spaceship ...`
  string in the source and fails when one names a command the registry does not
  have. Verified it catches the bug by reintroducing it.
- `api-key-wizard` was **rejected** after inspection: it prompts for a single
  key, and this API needs a key plus a secret verified together. `prompt-secret`
  is used directly instead.
- The secret goes to the macOS keychain via `security`, never to the config
  file; only the key id is persisted. Credentials are verified against the API
  before being stored, so a typo fails at login rather than on the next command.
- `auth logout` warns when SPACESHIP_API_SECRET is still exported: clearing
  storage does not unset a shell variable, and reporting "signed out" while the
  next command still works would be a lie.

## V5 (drift linter)

- The extractor slices the embedded object by tracking brace depth outside
  strings. A regex cannot do it: the document contains braces inside markdown
  descriptions and inside curl examples, and escaped quotes inside both.
- **"No changes" proves nothing about a differ.** Running it against the live
  API returned a clean result, which is exactly what a broken differ also
  returns. It was verified by injecting five known changes into a served copy
  of the spec and checking each landed in the right severity: a new required
  field, a lowered rate limit, a new scope, an extended enum, and a new
  endpoint. Then the inverse: a change on an endpoint no command calls must
  exit 0.
- The lowered rate limit (300 to 50 per 300s) is the case that justifies parsing
  prose. It changes runtime behaviour, breaks pacing, and a schema-only differ
  sees nothing at all because no type moved.
- Severity is coverage-crossed, so the report says "domains autorenew will
  break" rather than "the API changed". That is only possible because the
  registry declares which command calls which operation.
- The path to spec/raw.json walks up looking for the file rather than counting
  `..` segments: the same code resolves from src/ during development and dist/
  once built, and the first version silently resolved outside the package.
- The cron opens a PR, never publishes. The public feed stays gated on Hunter.

## doctor

- `renderDoctor` from the block was **rejected**; `runDoctor` adopted. The
  renderer emits its own shape, which would break the one-envelope-per-command
  contract already published to agents.
- Padding a styled badge with `padEnd` misaligns the column: "ok" and "fail"
  carry different amounts of escape bytes. `padVisible` is the only correct
  padding for anything coloured, and this is the second place that bit.
- The doctor reports credential *presence and origin*, never values: the key is
  masked, the secret is reported as a character count. Verified that neither the
  human nor the JSON output contains the secret.

## credentials moved to the keychain

- The credentials existed in `~/.crafters/config.json`, which the `crafters` CLI
  writes for the crafter.run domains. Reading another tool's config file made
  this CLI depend on a path it does not own and cannot guarantee, so both halves
  were copied into the keychain (`spaceship-cli`, accounts `api_key` and
  `api_secret`) and the file read was removed entirely.
- Verified by renaming the file and running `doctor`: still works.
- The key is not secret on its own, but keeping the pair in one place means one
  thing to rotate and one to revoke. The config file is now only a fallback for
  systems with no keychain.

## skills served from the binary

- Hunter asked why there was no `spaceship skills get core` like `agent-browser`
  has. The SKILL.md existed and shipped in the package, but only as a file: an
  agent had to already have it installed. `agent-browser`'s own help states the
  reason for serving it from the CLI — the content then matches the installed
  version rather than whatever copy is cached on a machine.
- `skills get` returns **raw markdown even when piped**, breaking this CLI's own
  "JSON when not a TTY" rule on purpose. The skill body is the payload; wrapping
  it in the envelope would make every consumer unwrap a string before reading
  it. `--json` opts back in.
- Split into `core` and `portfolio`, since a single skill makes `skills list`
  pointless and the portfolio material (rate-limit budget, lifecycle states,
  bulk patterns) is what a caller needs only sometimes.
- A test asserts the embedded copy equals the file on disk, so the generated
  module cannot drift from `skills/`. Another scans for commands the skills
  promise but the CLI lacks; its first version had a false positive on the
  heading "# spaceship core", so it now scans only backticked spans and shell
  lines. Verified it still catches a real one.

## the discovery stub

- Hunter asked whether a thin skill existed — one that routes to the CLI instead
  of duplicating the guide. It did not: the installed skills were the full
  `core` and `portfolio`, 10.5 KB loaded into every session.
- `agent-browser`'s own stub states the reason plainly: "This file is a
  discovery stub, not the usage guide." Its stub is 3.3 KB and points at
  `skills get core`. A stub cannot go stale between releases because it carries
  no instructions to be wrong about.
- The stub is 2.2 KB against 10.5 KB eager, and lives in `stub/` rather than
  `skills/` so the embedder does not bundle a file whose only job is to point at
  the bundle.
- **A verification of mine produced a false failure.** Looping over commands
  with an unquoted `$c` split "skills get core" into separate arguments, so all
  three skills commands looked like they exited 2. They were fine; the test
  harness was wrong. Re-ran with `eval` and proper quoting: exit 0 across the
  board.
- Tests now assert the stub stays under 3 KB, names every bundled skill, and
  references no command the CLI lacks.

## the banner lied about its own version

- Hunter noticed the banner still said v0.1.0 after two releases. Not a cache:
  `const VERSION = "0.1.0"` was hand-written in cli.ts during V1 and neither
  bump touched it. The published package really did announce the wrong version.
- Generated from package.json now, by the same script that embeds the skills,
  with a test asserting the two agree. The class of bug is the one this whole
  project is about: a second copy of a fact, drifting from the first.
- `--version` did not exist at all. Added, printing to stdout bare, since a
  caller pipes it into a comparison.
