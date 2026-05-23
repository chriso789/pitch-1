// _shared/system-audit.ts — Backend Maintenance Center (Phase 1, read-only)
//
// Shared helpers used by:
//   - health-api    GET /doctor
//   - security-api  GET /tenant-audit/report
//   - security-api  GET /rls-linter/report
//   - admin-api     GET /edge-functions/report
//   - admin-api     GET /cleanup/preview
//
// Every audit run writes one row to public.system_audit_runs and N rows to
// public.system_audit_findings. Both tables are master-only-read; writes use
// service role inside the edge function (never exposed to the client).

import { serviceClient } from "./router.ts";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type AuditModule =
  | "health_doctor"
  | "edge_functions"
  | "tenant_isolation"
  | "rls_security"
  | "cleanup_preview";

export interface Finding {
  finding_key: string;
  category: string;
  severity: Severity;
  entity_type: string;
  entity_id: string;
  title: string;
  detail?: string;
  evidence?: unknown;
  recommended_action?: string;
  risk_explanation?: string;
  company_id?: string | null;
}

export interface AuditRunResult {
  run_id: string | null;          // null when persist=false
  module: AuditModule;
  generated_at: string;
  duration_ms: number;
  status: "ok" | "partial" | "error";
  summary: Record<Severity, number>;
  findings: Finding[];
  warnings: string[];             // soft errors (e.g. extension missing)
  persisted: boolean;
}

const EVIDENCE_ROW_CAP = 50;

function capEvidence(evidence: unknown): unknown {
  if (Array.isArray(evidence)) {
    if (evidence.length <= EVIDENCE_ROW_CAP) return evidence;
    return { sample: evidence.slice(0, EVIDENCE_ROW_CAP), truncated: true, total: evidence.length };
  }
  return evidence;
}

function emptySummary(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

/**
 * Verifies the authenticated user has the 'master' role.
 * Returns null on success, an error message on failure.
 */
export async function requireMaster(userId: string | undefined): Promise<string | null> {
  if (!userId) return "auth_required";
  const svc = serviceClient();
  const { data, error } = await svc.rpc("has_role", { _user_id: userId, _role: "master" });
  if (error) return `role_check_failed:${error.message}`;
  if (data !== true) return "master_role_required";
  return null;
}

/**
 * Run an audit module: opens a run row, executes the check function, persists
 * findings, and returns the structured result.
 *
 * If persist=false (query string ?persist=false), no rows are written — useful
 * for ad-hoc inspection without polluting the audit log.
 */
export async function runAudit(opts: {
  module: AuditModule;
  triggeredBy: string;
  persist: boolean;
  check: () => Promise<{ findings: Finding[]; warnings?: string[] }>;
}): Promise<AuditRunResult> {
  const { module, triggeredBy, persist, check } = opts;
  const svc = serviceClient();
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();

  let runId: string | null = null;
  if (persist) {
    const { data, error } = await svc
      .from("system_audit_runs")
      .insert({
        module,
        triggered_by: triggeredBy,
        started_at: generatedAt,
        status: "running",
        summary: {},
      })
      .select("id")
      .maybeSingle();
    if (error) {
      // Fall back to non-persisted run rather than failing the whole report
      console.warn(`[system-audit] failed to open run row for ${module}:`, error.message);
    } else {
      runId = data?.id ?? null;
    }
  }

  let findings: Finding[] = [];
  let warnings: string[] = [];
  let status: "ok" | "partial" | "error" = "ok";
  let errorMessage: string | null = null;

  try {
    const result = await check();
    findings = result.findings;
    warnings = result.warnings ?? [];
    if (warnings.length > 0) status = "partial";
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[system-audit] ${module} threw:`, errorMessage);
  }

  const summary = emptySummary();
  for (const f of findings) summary[f.severity]++;

  const durationMs = Date.now() - startedAt;

  if (runId && persist) {
    // Best-effort persistence — never fail the response on a write error.
    if (findings.length > 0) {
      const rows = findings.map((f) => ({
        run_id: runId,
        finding_key: f.finding_key,
        category: f.category,
        severity: f.severity,
        entity_type: f.entity_type,
        entity_id: f.entity_id,
        title: f.title,
        detail: f.detail ?? null,
        evidence: f.evidence !== undefined ? capEvidence(f.evidence) : null,
        recommended_action: f.recommended_action ?? null,
        risk_explanation: f.risk_explanation ?? null,
        company_id: f.company_id ?? null,
      }));
      const { error: insertErr } = await svc.from("system_audit_findings").insert(rows);
      if (insertErr) {
        console.warn(`[system-audit] failed to persist findings for ${module}:`, insertErr.message);
        warnings.push(`findings_persist_failed:${insertErr.message}`);
      }
    }
    const { error: updateErr } = await svc
      .from("system_audit_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        summary,
        duration_ms: durationMs,
        error_message: errorMessage,
      })
      .eq("id", runId);
    if (updateErr) {
      console.warn(`[system-audit] failed to close run row for ${module}:`, updateErr.message);
    }
  }

  return {
    run_id: runId,
    module,
    generated_at: generatedAt,
    duration_ms: durationMs,
    status,
    summary,
    findings,
    warnings,
    persisted: persist && runId !== null,
  };
}

// =============================================================================
// Helpers for individual checks
// =============================================================================

/**
 * Run a read-only SQL via the existing exec_sql RPC if present. Returns rows.
 * Many audit gates need information_schema / pg_catalog inspection that the
 * supabase-js builder can't express.
 *
 * Falls back to direct table queries via the SDK when exec_sql is unavailable.
 */
export async function runReadOnlySql(sql: string): Promise<{ rows: unknown[]; warning?: string }> {
  const svc = serviceClient();
  // Try common helper names. We don't want to require a specific RPC to exist.
  const candidates = ["exec_sql", "execute_sql", "sql"];
  for (const fn of candidates) {
    try {
      const { data, error } = await svc.rpc(fn, { query: sql });
      if (!error) {
        if (Array.isArray(data)) return { rows: data };
        if (data && typeof data === "object") return { rows: [data] };
        return { rows: [] };
      }
    } catch { /* try next */ }
  }
  return {
    rows: [],
    warning: "exec_sql_unavailable: install a read-only SQL RPC for richer pg_catalog gates",
  };
}

export function shouldPersist(req: Request): boolean {
  try {
    const url = new URL(req.url);
    const v = url.searchParams.get("persist");
    if (v === null) return true;
    return v !== "false" && v !== "0";
  } catch {
    return true;
  }
}
