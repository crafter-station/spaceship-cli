import { AppError } from "../cli/foundation/error-map.js";
import { bold, dim, muted } from "../cli/platform/style.js";
import { EXIT, type ExitCode } from "../contract.js";
import { emitResult, type EmitContext } from "../output/envelope.js";
import { table } from "../output/table.js";
import { SKILLS, skillNames, type EmbeddedSkill } from "../skills.generated.js";

/**
 * Serves the bundled skills from inside the binary, so what an agent reads
 * always matches the version it is calling. A copy installed on disk describes
 * whatever shipped the day it was installed.
 */

const line = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

export function skillsList(ctx: EmitContext): ExitCode {
  const skills = skillNames().map((name) => {
    const skill = SKILLS[name] as EmbeddedSkill;
    return { name: skill.name, description: skill.description };
  });

  return emitResult(
    ctx,
    { skills },
    { nextSteps: [{ command: "spaceship skills get core", reason: "Read the core usage guide" }] },
    (result) => {
      line("");
      for (const row of table(result.skills, [
        { header: "skill", render: (s) => bold(s.name), max: 16 },
        // Truncated in the human view only; --json carries the full text, which
        // is what a skill router needs to match against.
        { header: "what it covers", render: (s) => s.description, max: 62 },
      ])) {
        line(row);
      }
      line(`\n${muted("Read one with")} spaceship skills get <name>\n`);
    },
  );
}

export function skillsGet(ctx: EmitContext, names: string[], jsonRequested: boolean): ExitCode {
  const requested = names.length > 0 ? names : ["core"];
  const unknown = requested.filter((name) => !(name in SKILLS));

  if (unknown.length > 0) {
    throw new AppError("usage", {
      name: "UnknownSkill",
      human: `No such skill: ${unknown.join(", ")}`,
      hint: `Available: ${skillNames().join(", ")}`,
    });
  }

  const skills = requested.map((name) => SKILLS[name] as EmbeddedSkill);

  // The skill body is markdown meant to be read, so it goes to stdout as-is
  // even when piped. Wrapping it in the envelope would make every consumer
  // unwrap a string before reading it. `--json` opts into the envelope for
  // callers that want the metadata alongside.
  if (!jsonRequested) {
    for (const [index, skill] of skills.entries()) {
      if (index > 0) line("");
      process.stdout.write(skill.content);
    }
    return EXIT.ok;
  }

  return emitResult(ctx, { skills }, {});
}

export function skillsPath(ctx: EmitContext): ExitCode {
  // Deliberately reports that there is no path: the skills live in the bundle,
  // and pointing at a directory that may not exist would be a lie.
  return emitResult(
    ctx,
    {
      bundled: true,
      names: skillNames(),
      note: "Skills are embedded in the binary. Use `spaceship skills get <name>` to read one.",
    },
    {},
    (result) => {
      line(`\n${muted(result.note)}`);
      line(`  ${dim("available")}  ${result.names.join(", ")}\n`);
    },
  );
}

export { EXIT };
