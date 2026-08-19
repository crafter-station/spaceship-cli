import { dim, muted, padVisible, padStartVisible, visibleWidth, truncateVisible } from "../cli/platform/style.js";

export type Alignment = "left" | "right";

export type Column<T> = {
  header: string;
  align?: Alignment;
  /** Max visible width; longer cells are truncated with an ellipsis. */
  max?: number;
  render: (row: T) => string;
};

/** Renders one cell, applying the column's max width. */
function renderCell<T>(column: Column<T>, row: T): string {
  const value = column.render(row);
  return column.max === undefined ? value : truncateVisible(value, column.max);
}

/**
 * Renders an aligned table using visible width, so ANSI styling inside a cell
 * does not shift the columns. Returns lines; the caller decides the stream.
 */
export function table<T>(rows: T[], columns: Column<T>[], options: { widths?: number[] } = {}): string[] {
  if (rows.length === 0) return [];

  const cells = rows.map((row) => columns.map((column) => renderCell(column, row)));

  // A column whose every cell is empty carries no information, so it is dropped
  // rather than printed as a header over blanks.
  const populated = columns
    .map((column, index) => ({ column, index }))
    .filter(({ index }) => cells.some((row) => visibleWidth(row[index] ?? "") > 0));

  const widths = options.widths ?? populated.map(({ column, index }) =>
    Math.max(
      visibleWidth(column.header),
      ...cells.map((row) => visibleWidth(row[index] ?? "")),
    ),
  );

  const pad = (text: string, width: number, align: Alignment): string =>
    align === "right" ? padStartVisible(text, width) : padVisible(text, width);

  const header = populated
    .map(({ column }, position) => dim(pad(column.header.toUpperCase(), widths[position] ?? 0, column.align ?? "left")))
    .join("  ")
    .trimEnd();

  const body = cells.map((row) =>
    populated
      .map(({ column, index }, position) => pad(row[index] ?? "", widths[position] ?? 0, column.align ?? "left"))
      .join("  ")
      .trimEnd(),
  );

  return [header, ...body];
}

/**
 * Groups rows under a printed heading.
 *
 * A value repeated down every row of a column is a heading that has not been
 * promoted yet: fourteen rows carrying the same title is fourteen chances to
 * read it and zero information after the first.
 */
export function grouped<T>(
  rows: T[],
  keyOf: (row: T) => string,
  columns: Column<T>[],
  options: { order?: string[]; repeatHeader?: boolean } = {},
): string[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }

  const keys = options.order
    ? options.order.filter((key) => groups.has(key))
    : [...groups.keys()];

  // Widths are computed across every group so the tables line up with each
  // other instead of each block finding its own alignment.
  const shared = columns.map((column) =>
    Math.max(
      visibleWidth(column.header),
      ...rows.map((row) => visibleWidth(renderCell(column, row))),
    ),
  );

  const lines: string[] = [];
  for (const [index, key] of keys.entries()) {
    if (index > 0) lines.push("");
    const bucket = groups.get(key) ?? [];
    lines.push(`${key} ${muted(`(${bucket.length})`)}`);
    const populatedWidths = columns
      .map((column, i) => ({ column, i }))
      .filter(({ column }) => bucket.some((row) => visibleWidth(renderCell(column, row)) > 0))
      .map(({ i }) => shared[i] ?? 0);
    const rendered = table(bucket, columns, { widths: populatedWidths });
    // One header for the whole listing: repeating it per group is the same
    // noise the grouping removed.
    const body = options.repeatHeader === false && index > 0 ? rendered.slice(1) : rendered;
    lines.push(...body.map((line) => `  ${line}`));
  }
  return lines;
}
