// cligentic block: audit-lifecycle
//
// Two-phase append-only audit records for operations that must survive retries.

import { appendFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export type AuditLifecycleResult = "pending" | "ok" | "error" | "blocked" | "dry-run";

export type AuditLifecycleRecord = {
  kind: string;
  command: string;
  meta?: Record<string, unknown>;
  tier?: string;
  profile?: string;
};

export type AuditLifecycle = {
  auditId: string;
  complete(meta?: Record<string, unknown>): void;
  fail(meta?: Record<string, unknown>): void;
  block(meta?: Record<string, unknown>): void;
  dryRun(meta?: Record<string, unknown>): void;
};

type StoredLifecycleRecord = AuditLifecycleRecord & {
  ts: string;
  result: AuditLifecycleResult;
  meta: Record<string, unknown>;
};

function todayFilename(): string {
  return `${new Date().toISOString().slice(0, 10)}.jsonl`;
}

export function beginAudit(
  auditDir: string,
  record: AuditLifecycleRecord,
  opts: { auditId?: string } = {},
): AuditLifecycle {
  const auditId = opts.auditId ?? randomUUID();
  const started = Date.now();
  const baseMeta = { ...(record.meta ?? {}), audit_id: auditId };

  appendLifecycleRecord(auditDir, record, "pending", baseMeta);

  const finish = (result: Exclude<AuditLifecycleResult, "pending">, meta = {}) => {
    appendLifecycleRecord(auditDir, record, result, {
      ...baseMeta,
      ...meta,
      duration_ms: Date.now() - started,
    });
  };

  return {
    auditId,
    complete: (meta) => finish("ok", meta),
    fail: (meta) => finish("error", meta),
    block: (meta) => finish("blocked", meta),
    dryRun: (meta) => finish("dry-run", meta),
  };
}

export function appendLifecycleRecord(
  auditDir: string,
  record: AuditLifecycleRecord,
  result: AuditLifecycleResult,
  meta: Record<string, unknown> = {},
): void {
  mkdirSync(auditDir, { recursive: true });
  const file = join(auditDir, todayFilename());
  const stored: StoredLifecycleRecord = {
    ts: new Date().toISOString(),
    ...record,
    result,
    meta,
  };
  appendFileSync(file, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
}
