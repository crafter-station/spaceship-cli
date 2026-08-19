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
