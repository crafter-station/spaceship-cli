/**
 * The diff runs over a normalized view, not the raw document, for two reasons:
 * key order is not guaranteed between deploys and would produce phantom
 * changes, and the facts that matter most (rate limits, scopes) live inside
 * markdown prose where a text diff cannot tell a wording tweak from a lowered
 * limit.
 */

export type RateLimit = { limit: number; scope: string; windowSeconds: number };

export type NormalizedOperation = {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  /** Required scopes, parsed from the description. */
  scopes: string[];
  /** Parsed from prose; null when the spec documents none. */
  rateLimit: RateLimit | null;
  /** Request body field names, split by whether the API demands them. */
  requestRequired: string[];
  requestOptional: string[];
  /** Response codes the operation declares. */
  responses: string[];
  /** True when the operation answers 202 and finishes later. */
  async: boolean;
};

export type NormalizedSpec = {
  version: string;
  operations: Record<string, NormalizedOperation>;
  /** Schema name to its sorted field list, for detecting added or removed fields. */
  schemas: Record<string, { required: string[]; optional: string[]; enum: string[] | null }>;
};

const RATE_LIMIT = /limit .*? is (\d+) requests? per ([a-z, ]+?),? within (\d+) seconds/i;

export function parseRateLimit(description: string): RateLimit | null {
  const match = RATE_LIMIT.exec(description);
  if (!match) return null;
  return {
    limit: Number(match[1]),
    // "user, per domain" and "user + per domain" mean the same budget; one form
    // is chosen so a rewording does not read as a change.
    scope: (match[2] ?? "").trim().replace(/,\s*/g, " + "),
    windowSeconds: Number(match[3]),
  };
}

export function parseScopes(description: string): string[] {
  return [...new Set([...description.matchAll(/#scopes\/([a-z]+:[a-z]+)/g)].map((m) => m[1] as string))].sort();
}

type SchemaNode = Record<string, unknown>;

/** Follows $ref and allOf far enough to read a body's field names. */
function resolve(node: unknown, schemas: Record<string, SchemaNode>, depth = 0): SchemaNode {
  if (depth > 6 || !node || typeof node !== "object") return {};
  const current = node as SchemaNode;

  if (typeof current.$ref === "string") {
    const name = current.$ref.split("/").pop() as string;
    return resolve(schemas[name], schemas, depth + 1);
  }
  if (Array.isArray(current.allOf)) {
    const merged: SchemaNode = { properties: {}, required: [] };
    for (const part of current.allOf) {
      const resolved = resolve(part, schemas, depth + 1);
      Object.assign(merged.properties as object, resolved.properties ?? {});
      (merged.required as string[]).push(...((resolved.required as string[]) ?? []));
    }
    return merged;
  }
  return current;
}

export function normalize(raw: Record<string, unknown>): NormalizedSpec {
  const components = (raw.components ?? {}) as { schemas?: Record<string, SchemaNode> };
  const schemas = components.schemas ?? {};
  const paths = (raw.paths ?? {}) as Record<string, Record<string, unknown>>;

  const operations: Record<string, NormalizedOperation> = {};

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (method === "parameters" || method.startsWith("x-")) continue;
      const op = operation as SchemaNode;
      const description = String(op.description ?? "");

      const bodySchema = resolve(
        ((op.requestBody as SchemaNode)?.content as SchemaNode)?.["application/json"] &&
          (((op.requestBody as SchemaNode).content as SchemaNode)["application/json"] as SchemaNode).schema,
        schemas,
      );
      const bodyProps = Object.keys((bodySchema.properties as object) ?? {});
      const bodyRequired = ((bodySchema.required as string[]) ?? []).slice().sort();
      const responses = Object.keys((op.responses as object) ?? {}).sort();

      const key = `${method.toUpperCase()} ${path}`;
      operations[key] = {
        operationId: String(op.operationId ?? ""),
        method: method.toUpperCase(),
        path,
        summary: String(op.summary ?? ""),
        scopes: parseScopes(description),
        rateLimit: parseRateLimit(description),
        requestRequired: bodyRequired,
        requestOptional: bodyProps.filter((field) => !bodyRequired.includes(field)).sort(),
        responses,
        async: responses.includes("202"),
      };
    }
  }

  const normalizedSchemas: NormalizedSpec["schemas"] = {};
  for (const [name, schema] of Object.entries(schemas)) {
    const props = Object.keys((schema.properties as object) ?? {});
    const required = ((schema.required as string[]) ?? []).slice().sort();
    normalizedSchemas[name] = {
      required,
      optional: props.filter((field) => !required.includes(field)).sort(),
      enum: Array.isArray(schema.enum) ? (schema.enum as string[]).map(String).sort() : null,
    };
  }

  return {
    version: String((raw.info as SchemaNode)?.version ?? "unknown"),
    operations,
    schemas: normalizedSchemas,
  };
}

/** Stable stringification, so an unchanged spec always hashes the same. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as object).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}
