// Supplier audit logger for QXO actions.
// Writes to supplier_audit_log with supplier='qxo'. Never persists credentials.

import { serviceClient } from "../router.ts";

const REDACT_KEYS = /(token|secret|password|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|authorization)/i;

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    // Redact obvious bearer tokens / long base64
    if (/^Bearer\s+/i.test(value)) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

export interface QxoAuditRow {
  tenantId: string;
  userId?: string | null;
  action: string;
  result: "success" | "denied" | "failed" | "rate_limited" | "duplicate" | "pending_verification";
  requestId?: string | null;
  idempotencyKey?: string | null;
  supplierAccountId?: string | null;
  metadata?: Record<string, unknown>;
}

export function auditQxo(row: QxoAuditRow): void {
  // Fire-and-forget; never throw.
  try {
    const svc = serviceClient();
    const meta = row.metadata ? (redact(row.metadata) as Record<string, unknown>) : {};
    svc
      .from("supplier_audit_log")
      .insert({
        tenant_id: row.tenantId,
        user_id: row.userId ?? null,
        supplier: "qxo",
        supplier_account_id: row.supplierAccountId ?? null,
        action: row.action,
        result: row.result,
        request_id: row.requestId ?? null,
        idempotency_key: row.idempotencyKey ?? null,
        metadata: meta,
      })
      .then(() => {}, (err) => console.warn("[qxo-audit] insert failed", err?.message ?? err));
  } catch (e) {
    console.warn("[qxo-audit] threw", e);
  }
}
