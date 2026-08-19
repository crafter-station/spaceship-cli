// cligentic block: audit-log
//
// Append-only JSONL audit trail. One file per day, rotated automatically.
// Every meaningful action your CLI takes gets a record.
//
// Design rules:
//   1. Append-only. Never overwrite, never delete, never truncate.
//   2. One JSON object per line (JSONL). Machine-readable, grep-friendly.
//   3. Per-day rotation: audit/2026-04-09.jsonl, audit/2026-04-10.jsonl.
//   4. File mode 0o600 (audit logs may contain sensitive operation details).
//   5. Timestamp is ISO 8601 UTC, always first field.
//
// Usage:
//   import { audit, tailAudit } from "./foundation/audit-log";
//
//   await audit(auditDir, {
//     kind: "order.placed",
//     command: "order buy AAPL",
//     result: "ok",
//     meta: { orderId: "abc-123" },
//   });
//
//   const recent = tailAudit(auditDir, 10);

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type AuditRecord = {
  /** What happened. Use dot-notation: "order.placed", "auth.login", "config.updated". */
  kind: string;
  /** The full command string. */
  command: string;
  /** Outcome of the operation. */
  result: "ok" | "error" | "blocked" | "dry-run";
  /** Optional structured metadata. */
  meta?: Record<string, unknown>;
  /** Optional tier level (for safety-stack CLIs). */
  tier?: string;
  /** Optional profile name. */
  profile?: string;
};

type StoredRecord = AuditRecord & {
  ts: string;
};

function todayFilename(): string {
  return `${new Date().toISOString().slice(0, 10)}.jsonl`;
}

/**
 * Appends an audit record to today's log file. Creates the audit
 * directory and file if they don't exist. Append is atomic at the
 * OS level for lines under 4KB (PIPE_BUF on POSIX).
 */
export function audit(auditDir: string, record: AuditRecord): void {
  mkdirSync(auditDir, { recursive: true });
  const file = join(auditDir, todayFilename());
  const stored: StoredRecord = { ts: new Date().toISOString(), ...record };
  appendFileSync(file, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
}

/**
 * Reads the last N records from the audit log. Reads today's file first,
 * then yesterday's, etc., until N records are collected or no more files.
 * Returns newest-first.
 */
export function tailAudit(auditDir: string, n = 20): StoredRecord[] {
  let files: string[];
  try {
    files = readdirSync(auditDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();
  } catch {
    return [];
  }

  const results: StoredRecord[] = [];
  for (const file of files) {
    if (results.length >= n) break;
    try {
      const content = readFileSync(join(auditDir, file), "utf8");
      const lines = content.trim().split("\n").filter(Boolean).reverse();
      for (const line of lines) {
        if (results.length >= n) break;
        try {
          results.push(JSON.parse(line) as StoredRecord);
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return results;
}

