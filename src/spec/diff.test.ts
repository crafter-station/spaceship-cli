import { describe, expect, test } from "bun:test";
import { diffSpecs } from "./diff.js";
import { normalize, parseRateLimit, parseScopes } from "./normalize.js";
import { extractSpecFromHtml, sliceJsonObject } from "./extract.js";
import { AppError } from "../cli/foundation/error-map.js";

/** A minimal spec shaped like the real one, so tests state intent not scaffolding. */
function spec(overrides: {
  autorenewRequired?: string[];
  domainsListLimit?: number;
  lifecycleEnum?: string[];
  dnsScopes?: string;
  extraPath?: boolean;
  dropDnsList?: boolean;
}): Record<string, unknown> {
  const paths: Record<string, unknown> = {
    "/v1/domains": {
      get: {
        operationId: "getDomainList",
        summary: "Get domain list",
        description: `Get domains.\n - <a href="#scopes/domains:read">domains:read</a>\n * The limit for fetching a domain list is ${overrides.domainsListLimit ?? 300} requests per user, within 300 seconds.`,
        responses: { "200": {}, "429": {} },
      },
    },
    "/v1/domains/{domain}/autorenew": {
      put: {
        operationId: "updateAutorenewal",
        summary: "Update autorenewal",
        description: 'Set it.\n - <a href="#scopes/domains:write">domains:write</a>',
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: overrides.autorenewRequired ?? ["isEnabled"],
                properties: { isEnabled: { type: "boolean" }, reason: { type: "string" } },
              },
            },
          },
        },
        responses: { "204": {} },
      },
    },
  };

  if (!overrides.dropDnsList) {
    paths["/v1/dns/records/{domain}"] = {
      get: {
        operationId: "getResourceRecordsList",
        summary: "List records",
        description: `List them.\n - <a href="#scopes/dnsrecords:read">dnsrecords:read</a>${overrides.dnsScopes ?? ""}`,
        responses: { "200": {} },
      },
    };
  }

  if (overrides.extraPath) {
    paths["/v1/brand-new"] = {
      get: { operationId: "brandNew", summary: "Brand new", responses: { "200": {} } },
    };
  }

  return {
    info: { version: "1.0.0" },
    paths,
    components: {
      schemas: {
        DomainLifecycleStatus: {
          type: "string",
          enum: overrides.lifecycleEnum ?? ["registered", "grace1", "redemption"],
        },
      },
    },
  };
}

const diff = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  diffSpecs(normalize(before), normalize(after));

describe("no drift", () => {
  test("an identical spec produces no changes", () => {
    const report = diff(spec({}), spec({}));
    expect(report.changed).toBe(false);
    expect(report.counts).toEqual({ breaking: 0, warning: 0, info: 0 });
  });
});

describe("severity follows coverage", () => {
  test("a new required field on a command we ship is breaking", () => {
    const report = diff(spec({}), spec({ autorenewRequired: ["isEnabled", "reason"] }));
    const change = report.changes.find((c) => c.kind === "request-field-required");
    expect(change?.severity).toBe("breaking");
    expect(change?.commands).toContain("domains autorenew");
  });

  test("a brand new endpoint is only info, so it cannot fail a build", () => {
    const report = diff(spec({}), spec({ extraPath: true }));
    expect(report.counts.breaking).toBe(0);
    expect(report.changes.find((c) => c.kind === "operation-added")?.severity).toBe("info");
  });

  test("removing an operation we ship is breaking and names the command", () => {
    const report = diff(spec({}), spec({ dropDnsList: true }));
    const change = report.changes.find((c) => c.kind === "operation-removed");
    expect(change?.severity).toBe("breaking");
    expect(change?.commands).toContain("dns list");
  });
});

describe("rate limits, which live in prose", () => {
  test("a lowered limit on a command we ship is breaking", () => {
    const report = diff(spec({}), spec({ domainsListLimit: 50 }));
    const change = report.changes.find((c) => c.kind === "rate-limit");
    expect(change?.severity).toBe("breaking");
    expect(change?.detail).toContain("50 per user");
  });

  test("a raised limit is reported but does not break the build", () => {
    const report = diff(spec({}), spec({ domainsListLimit: 600 }));
    expect(report.changes.find((c) => c.kind === "rate-limit")?.severity).toBe("warning");
    expect(report.counts.breaking).toBe(0);
  });

  test("parses the two-scope form the real spec uses", () => {
    expect(
      parseRateLimit("The limit for saving is 300 requests per user, per domain, within 300 seconds."),
    ).toEqual({ limit: 300, scope: "user + per domain", windowSeconds: 300 });
  });

  test("returns null when no limit is documented, rather than inventing one", () => {
    expect(parseRateLimit("No limits here.")).toBeNull();
  });
});

describe("scopes", () => {
  test("a new required scope on a shipped command is breaking", () => {
    const report = diff(spec({}), spec({ dnsScopes: '\n - <a href="#scopes/dnsrecords:admin">dnsrecords:admin</a>' }));
    const change = report.changes.find((c) => c.kind === "scope-added");
    expect(change?.severity).toBe("breaking");
    expect(change?.commands).toContain("dns list");
  });

  test("parses scopes out of the description markup", () => {
    expect(parseScopes('<a href="#scopes/domains:read">x</a> <a href="#scopes/domains:write">y</a>')).toEqual([
      "domains:read",
      "domains:write",
    ]);
  });
});

describe("enums", () => {
  test("a new value is a warning: our switch may not handle it", () => {
    const report = diff(spec({}), spec({ lifecycleEnum: ["registered", "grace1", "redemption", "quarantine"] }));
    const change = report.changes.find((c) => c.kind === "enum-extended");
    expect(change?.severity).toBe("warning");
    expect(change?.detail).toContain("quarantine");
  });

  test("a lost value is breaking: code may still send it", () => {
    const report = diff(spec({}), spec({ lifecycleEnum: ["registered"] }));
    expect(report.changes.find((c) => c.kind === "enum-narrowed")?.severity).toBe("breaking");
  });
});

describe("grouping", () => {
  test("a shared schema is reported once, not once per referencing operation", () => {
    // errorCode is referenced 351 times in the real document; 351 identical
    // lines is a report nobody reads.
    const report = diff(spec({}), spec({ lifecycleEnum: ["registered"] }));
    expect(report.changes.filter((c) => c.subject === "DomainLifecycleStatus")).toHaveLength(1);
  });

  test("breaking changes sort ahead of warnings and info", () => {
    const report = diff(
      spec({}),
      spec({ autorenewRequired: ["isEnabled", "reason"], extraPath: true, lifecycleEnum: ["registered", "grace1", "redemption", "new"] }),
    );
    expect(report.changes[0]?.severity).toBe("breaking");
    expect(report.changes.at(-1)?.severity).toBe("info");
  });
});

describe("extraction", () => {
  test("slices the embedded object without tripping on braces in strings", () => {
    const source = 'var x = {"a":"has { brace","b":{"c":1}}; more';
    expect(JSON.parse(sliceJsonObject(source, source.indexOf("{")))).toEqual({
      a: "has { brace",
      b: { c: 1 },
    });
  });

  test("handles escaped quotes inside descriptions", () => {
    const source = '{"a":"say \\"hi\\" {","b":2}';
    expect(JSON.parse(sliceJsonObject(source, 0))).toEqual({ a: 'say "hi" {', b: 2 });
  });

  test("fails clearly when the page no longer embeds a spec", () => {
    let thrown: unknown;
    try {
      extractSpecFromHtml("<html>redesigned</html>");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("spec.unparsable");
  });

  test("refuses an embedded object that is not an OpenAPI document", () => {
    const html = `<script>__redoc_state = ${JSON.stringify({ spec: { data: { nope: true } } })};</script>`;
    expect(() => extractSpecFromHtml(html)).toThrow();
  });
});
