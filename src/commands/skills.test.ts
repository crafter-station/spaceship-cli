import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SKILLS, skillNames } from "../skills.generated.js";
import { OPERATIONS } from "../registry.js";

describe("bundled skills", () => {
  test("core is always present, since it is the default for `skills get`", () => {
    expect(skillNames()).toContain("core");
  });

  test("every skill carries a description a router can match against", () => {
    for (const name of skillNames()) {
      expect(SKILLS[name]?.description.length ?? 0).toBeGreaterThan(40);
    }
  });

  test("the embedded copy matches the file on disk", () => {
    // The generated module is the thing the binary serves; if it drifts from
    // skills/, the CLI ships instructions nobody edited.
    for (const name of skillNames()) {
      const onDisk = readFileSync(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), "utf8");
      expect(SKILLS[name]?.content).toBe(onDisk);
    }
  });

  test("no skill promises a command the CLI does not have", () => {
    const known = new Set([
      ...OPERATIONS.map((op) => op.command),
      "auth login",
      "auth status",
      "auth whoami",
      "auth logout",
      "portfolio lint",
      "portfolio rules",
      "skills list",
      "skills get",
      "skills path",
      "spec diff",
      "spec snapshot",
      "schema",
      "doctor",
    ]);

    // Only invocations count: a heading like "# spaceship core" is prose, not a
    // command, so the scan is limited to backticked spans and shell blocks.
    const phantom: string[] = [];
    for (const name of skillNames()) {
      const content = SKILLS[name]?.content ?? "";
      const candidates = [
        ...[...content.matchAll(/`spaceship ([^`]+)`/g)].map((m) => m[1] ?? ""),
        ...[...content.matchAll(/^\s*spaceship ([^\n|]+)$/gm)].map((m) => m[1] ?? ""),
      ];
      for (const raw of candidates) {
        const parts = raw.trim().split(/\s+/).filter((p) => !p.startsWith("-") && !p.startsWith("<"));
        if (parts.length === 0) continue;
        const matched = [3, 2, 1].some((take) => known.has(parts.slice(0, take).join(" ")));
        if (!matched) phantom.push(`${name}: ${parts.join(" ")}`);
      }
    }
    expect(phantom).toEqual([]);
  });

  test("every skill declares valid frontmatter", () => {
    for (const name of skillNames()) {
      const content = SKILLS[name]?.content ?? "";
      expect(content.startsWith("---\n")).toBe(true);
      expect(content).toContain(`name: ${name}`);
    }
  });
});
