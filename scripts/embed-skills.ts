/**
 * Embeds guides/<name>/SKILL.md into src/skills.generated.ts so the binary can
 * serve instructions that match its own version. An agent reading a copy from
 * disk gets whatever was installed once; reading from the binary gets what this
 * build actually does.
 *
 * The guides live outside `skills/` on purpose: `npx skills add` installs
 * everything it finds under `skills/`, and installing the full guides is
 * exactly what the discovery stub exists to avoid. `skills/` holds the stub
 * alone, so the installer offers the one thing worth installing.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = "guides";
const OUT = "src/skills.generated.ts";
const VERSION_OUT = "src/version.generated.ts";

type Entry = { name: string; description: string; content: string };

const entries: Entry[] = [];

for (const name of readdirSync(SKILLS_DIR).sort()) {
  const path = join(SKILLS_DIR, name, "SKILL.md");
  if (!existsSync(path)) continue;
  const content = readFileSync(path, "utf8");
  const frontmatter = content.startsWith("---") ? content.split("---")[1] ?? "" : "";
  const match = /^description:\s*"?([\s\S]*?)"?\s*$/m.exec(frontmatter);
  const description = (match?.[1] ?? "").replace(/\s+/g, " ").trim();
  entries.push({ name, description, content });
}

const lines = [
  "// Generated from skills/*/SKILL.md by scripts/embed-skills.ts. Do not edit.",
  "// Embedded so the binary serves instructions matching its own version,",
  "// rather than whatever copy a machine happens to have on disk.",
  "",
  "export type EmbeddedSkill = { name: string; description: string; content: string };",
  "",
  "export const SKILLS: Record<string, EmbeddedSkill> = {",
];

for (const entry of entries) {
  lines.push(`  ${JSON.stringify(entry.name)}: {`);
  lines.push(`    name: ${JSON.stringify(entry.name)},`);
  lines.push(`    description: ${JSON.stringify(entry.description)},`);
  lines.push(`    content: ${JSON.stringify(entry.content)},`);
  lines.push("  },");
}

lines.push("};", "", "export const skillNames = (): string[] => Object.keys(SKILLS).sort();", "");

writeFileSync(OUT, lines.join("\n"));

// The version is generated from package.json for the same reason the skills
// are: a hand-written copy drifts. This one shipped as 0.1.0 through two
// releases because nothing tied it to the manifest.
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
writeFileSync(
  VERSION_OUT,
  [
    "// Generated from package.json by scripts/embed-skills.ts. Do not edit.",
    "",
    `export const VERSION = ${JSON.stringify(manifest.version)};`,
    "",
  ].join("\n"),
);

console.error(`embedded ${entries.length} skill(s): ${entries.map((e) => e.name).join(", ")} at v${manifest.version}`);
