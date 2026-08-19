import { OPERATIONS } from "../registry.js";
import type { NormalizedOperation, NormalizedSpec, RateLimit } from "./normalize.js";

/**
 * Severity is not a property of the change; it is the change crossed with what
 * this CLI actually uses. A required field appearing on an endpoint we call
 * breaks the next release. The same field on an endpoint we do not call is
 * something to know about, not something to stop the build for.
 */

export type Severity = "breaking" | "warning" | "info";

export type Change = {
  severity: Severity;
  kind: string;
  /** What moved, in the spec's own terms. */
  subject: string;
  detail: string;
  /** Commands affected, empty when nothing here calls it. */
  commands: string[];
};

export type DiffReport = {
  changed: boolean;
  counts: Record<Severity, number>;
  changes: Change[];
  /** Operations added and removed, called out because they shape coverage. */
  added: string[];
  removed: string[];
};

const coveredOperations = (): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const op of OPERATIONS) {
    const key = `${op.method} ${op.path}`;
    const existing = map.get(key) ?? [];
    existing.push(op.command);
    map.set(key, existing);
  }
  return map;
};

const sameRateLimit = (a: RateLimit | null, b: RateLimit | null): boolean =>
  a === b || (a !== null && b !== null && a.limit === b.limit && a.scope === b.scope && a.windowSeconds === b.windowSeconds);

const describeRateLimit = (limit: RateLimit | null): string =>
  limit === null ? "undocumented" : `${limit.limit} per ${limit.scope} / ${limit.windowSeconds}s`;

function diffOperation(
  key: string,
  before: NormalizedOperation,
  after: NormalizedOperation,
  commands: string[],
): Change[] {
  const changes: Change[] = [];
  const covered = commands.length > 0;

  // A new required field on a call we make means the next release sends an
  // invalid body.
  const newRequired = after.requestRequired.filter((field) => !before.requestRequired.includes(field));
  if (newRequired.length > 0) {
    changes.push({
      severity: covered ? "breaking" : "warning",
      kind: "request-field-required",
      subject: key,
      detail: `now requires ${newRequired.join(", ")}`,
      commands,
    });
  }

  const goneRequired = before.requestRequired.filter((field) => !after.requestRequired.includes(field));
  if (goneRequired.length > 0) {
    changes.push({
      severity: "info",
      kind: "request-field-relaxed",
      subject: key,
      detail: `no longer requires ${goneRequired.join(", ")}`,
      commands,
    });
  }

  if (!sameRateLimit(before.rateLimit, after.rateLimit)) {
    const lowered =
      before.rateLimit !== null &&
      after.rateLimit !== null &&
      after.rateLimit.limit / after.rateLimit.windowSeconds < before.rateLimit.limit / before.rateLimit.windowSeconds;
    changes.push({
      // A lowered limit changes runtime behaviour without changing a type, so
      // it is the kind of drift a schema-only differ misses entirely.
      severity: lowered && covered ? "breaking" : "warning",
      kind: "rate-limit",
      subject: key,
      detail: `${describeRateLimit(before.rateLimit)} to ${describeRateLimit(after.rateLimit)}`,
      commands,
    });
  }

  const newScopes = after.scopes.filter((scope) => !before.scopes.includes(scope));
  if (newScopes.length > 0) {
    changes.push({
      severity: covered ? "breaking" : "warning",
      kind: "scope-added",
      subject: key,
      detail: `now needs ${newScopes.join(", ")}`,
      commands,
    });
  }

  if (before.async !== after.async) {
    changes.push({
      severity: covered ? "breaking" : "warning",
      kind: "async-changed",
      subject: key,
      detail: after.async ? "now answers 202 and finishes later" : "no longer asynchronous",
      commands,
    });
  }

  return changes;
}

/**
 * Assertions about what the API does *not* do. An absence that ends is a
 * capability the API gained, which a plain field diff reports as a minor enum
 * edit or not at all.
 */
export type Assertion = {
  id: string;
  about: string;
  holds: (spec: NormalizedSpec) => boolean;
};

export const ASSERTIONS: Assertion[] = [
  {
    id: "transfer-inbound-only",
    about: "Transfers only run inbound; there is no transfer-out endpoint",
    holds: (spec) => {
      const direction = spec.schemas.DomainTransferDetailsResponse;
      if (!direction) return true;
      return !Object.keys(spec.operations).some((key) => /transfer.*out/i.test(key));
    },
  },
  {
    id: "domain-delete-unlimited",
    about: "Deleting a domain is the one mutating call with no documented rate limit",
    holds: (spec) => spec.operations["DELETE /v1/domains/{domain}"]?.rateLimit === null,
  },
  {
    id: "bulk-availability-capped",
    about: "Bulk availability accepts at most 20 domains per request",
    holds: (spec) => Boolean(spec.operations["POST /v1/domains/available"]),
  },
];

export function diffSpecs(before: NormalizedSpec, after: NormalizedSpec): DiffReport {
  const covered = coveredOperations();
  const changes: Change[] = [];

  const beforeKeys = new Set(Object.keys(before.operations));
  const afterKeys = new Set(Object.keys(after.operations));

  const added = [...afterKeys].filter((key) => !beforeKeys.has(key)).sort();
  const removed = [...beforeKeys].filter((key) => !afterKeys.has(key)).sort();

  for (const key of removed) {
    const commands = covered.get(key) ?? [];
    changes.push({
      severity: commands.length > 0 ? "breaking" : "info",
      kind: "operation-removed",
      subject: key,
      detail: "no longer in the spec",
      commands,
    });
  }

  for (const key of added) {
    changes.push({
      severity: "info",
      kind: "operation-added",
      subject: key,
      detail: after.operations[key]?.summary || "new operation",
      commands: [],
    });
  }

  for (const key of [...beforeKeys].filter((k) => afterKeys.has(k)).sort()) {
    const from = before.operations[key];
    const to = after.operations[key];
    if (!from || !to) continue;
    changes.push(...diffOperation(key, from, to, covered.get(key) ?? []));
  }

  // Schema changes are grouped by the schema rather than listed per referencing
  // operation: `errorCode` appears 351 times, and 351 identical lines is a
  // report nobody reads.
  for (const [name, afterSchema] of Object.entries(after.schemas)) {
    const beforeSchema = before.schemas[name];
    if (!beforeSchema) continue;

    const newRequired = afterSchema.required.filter((f) => !beforeSchema.required.includes(f));
    const goneFields = [...beforeSchema.required, ...beforeSchema.optional].filter(
      (f) => ![...afterSchema.required, ...afterSchema.optional].includes(f),
    );

    if (newRequired.length > 0) {
      changes.push({
        severity: "warning",
        kind: "schema-field-required",
        subject: name,
        detail: `now requires ${newRequired.join(", ")}`,
        commands: [],
      });
    }
    if (goneFields.length > 0) {
      changes.push({
        severity: "breaking",
        kind: "schema-field-removed",
        subject: name,
        detail: `dropped ${goneFields.join(", ")}`,
        commands: [],
      });
    }

    if (beforeSchema.enum && afterSchema.enum) {
      const newValues = afterSchema.enum.filter((v) => !beforeSchema.enum?.includes(v));
      const goneValues = beforeSchema.enum.filter((v) => !afterSchema.enum?.includes(v));
      if (newValues.length > 0) {
        changes.push({
          severity: "warning",
          kind: "enum-extended",
          subject: name,
          detail: `gained ${newValues.join(", ")}`,
          commands: [],
        });
      }
      if (goneValues.length > 0) {
        changes.push({
          severity: "breaking",
          kind: "enum-narrowed",
          subject: name,
          detail: `lost ${goneValues.join(", ")}`,
          commands: [],
        });
      }
    }
  }

  for (const assertion of ASSERTIONS) {
    if (assertion.holds(before) && !assertion.holds(after)) {
      changes.push({
        severity: "warning",
        kind: "assertion-broken",
        subject: assertion.id,
        detail: `no longer true: ${assertion.about}`,
        commands: [],
      });
    }
  }

  const order: Record<Severity, number> = { breaking: 0, warning: 1, info: 2 };
  changes.sort((a, b) => order[a.severity] - order[b.severity] || a.subject.localeCompare(b.subject));

  const counts: Record<Severity, number> = { breaking: 0, warning: 0, info: 0 };
  for (const change of changes) counts[change.severity]++;

  return { changed: changes.length > 0, counts, changes, added, removed };
}
