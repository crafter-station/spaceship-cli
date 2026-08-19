import { describe, expect, test } from "bun:test";
import { grouped, table } from "./table.js";
import { visibleWidth } from "../cli/platform/style.js";

type Row = { name: string; note: string; flag: string };

const rows: Row[] = [
  { name: "alpha", note: "first", flag: "" },
  { name: "beta-longer", note: "second", flag: "" },
];

const columns = [
  { header: "name", render: (r: Row) => r.name },
  { header: "note", render: (r: Row) => r.note },
  { header: "flag", render: (r: Row) => r.flag },
];

describe("table", () => {
  test("drops a column whose every cell is empty", () => {
    const lines = table(rows, columns);
    expect(lines[0]).not.toContain("FLAG");
    expect(lines[0]).toContain("NAME");
  });

  test("keeps a column when at least one cell has content", () => {
    const withFlag = [...rows, { name: "gamma", note: "third", flag: "yes" }];
    expect(table(withFlag, columns)[0]).toContain("FLAG");
  });

  test("aligns by visible width, ignoring ANSI escapes", () => {
    const styled = [
      { header: "name", render: (r: Row) => `[1m${r.name}[0m` },
      { header: "note", render: (r: Row) => r.note },
    ];
    const lines = table(rows, styled).slice(1);
    // The second column must start at the same visible offset on every row.
    const offsets = lines.map((line) => {
      const plain = line.replace(/\u001b\[[0-9;]*m/g, "");
      return plain.indexOf(plain.trimStart().split(/\s{2,}/)[1] ?? "");
    });
    expect(new Set(offsets).size).toBe(1);
  });

  test("returns nothing for an empty row set", () => {
    expect(table([], columns)).toEqual([]);
  });
});

describe("grouped", () => {
  test("prints the shared value once as a heading instead of on every row", () => {
    const items = [
      { kind: "fruit", name: "apple" },
      { kind: "fruit", name: "pear" },
      { kind: "tool", name: "hammer" },
    ];
    const lines = grouped(items, (i) => i.kind, [{ header: "name", render: (i) => i.name }]);
    const text = lines.join("\n");
    expect(text.match(/fruit/g)?.length).toBe(1);
    expect(text).toContain("apple");
    expect(text).toContain("pear");
  });

  test("shares column widths across groups so blocks line up", () => {
    const items = [
      { kind: "a", name: "x" },
      { kind: "b", name: "a-much-longer-name" },
    ];
    const lines = grouped(items, (i) => i.kind, [
      { header: "name", render: (i) => i.name },
      { header: "kind", render: (i) => i.kind },
    ]);
    // With a trailing column present, the first column pads to the widest value
    // across every group, so the second column starts at one shared offset.
    const dataLines = lines.filter((l) => l.startsWith("  ") && !l.includes("NAME"));
    const offsets = dataLines.map((l) => l.indexOf(l.trimStart().split(/\s{2,}/)[1] ?? ""));
    expect(new Set(offsets).size).toBe(1);
  });

  test("honours an explicit group order", () => {
    const items = [
      { kind: "second", name: "x" },
      { kind: "first", name: "y" },
    ];
    const lines = grouped(items, (i) => i.kind, [{ header: "name", render: (i) => i.name }], {
      order: ["first", "second"],
    });
    expect(lines[0]).toContain("first");
  });
});
