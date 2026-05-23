// Cleanup Preview — READ ONLY. Counts what a Phase-2 worker would touch.
import { serviceClient } from "../router.ts";
import type { Finding } from "../system-audit.ts";

async function safeCount(table: string, build: (q: any) => any): Promise<number | null> {
  const svc = serviceClient();
  try {
    const q = build(svc.from(table).select("*", { count: "exact", head: true }));
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch { return null; }
}

export async function runCleanupPreview(): Promise<{ findings: Finding[]; warnings: string[] }> {
  const findings: Finding[] = [];
  const warnings: string[] = [];
  const now = new Date();
  const isoMinus = (ms: number) => new Date(now.getTime() - ms).toISOString();

  const targets: Array<{key:string; table:string; title:string; build:(q:any)=>any; action:string; severity:"low"|"medium"|"high"}> = [
    { key: "cleanup.function_cache_expired", table: "function_cache",
      title: "Expired function_cache rows",
      build: (q)=>q.lt("expires_at", now.toISOString()),
      action: "delete", severity: "low" },
    { key: "cleanup.webhook_attempts_old", table: "webhook_attempts",
      title: "Failed webhook attempts older than 30d",
      build: (q)=>q.in("status", ["failed","dead_letter"]).lt("created_at", isoMinus(30*864e5)),
      action: "delete", severity: "low" },
    { key: "cleanup.ai_jobs_stuck", table: "ai_measurement_jobs",
      title: "AI measurement jobs stuck >2h in processing/queued",
      build: (q)=>q.in("status", ["processing","queued"]).lt("updated_at", isoMinus(2*36e5)),
      action: "fail_with_normalized_state", severity: "medium" },
    { key: "cleanup.activity_log_old", table: "activity_log",
      title: "activity_log rows older than 90 days",
      build: (q)=>q.lt("created_at", isoMinus(90*864e5)),
      action: "delete", severity: "low" },
  ];

  for (const t of targets) {
    const count = await safeCount(t.table, t.build);
    if (count === null) {
      warnings.push(`table_missing_or_unreadable:${t.table}`);
      continue;
    }
    if (count === 0) continue;
    findings.push({
      finding_key: t.key,
      category: "cleanup_preview", severity: t.severity,
      entity_type: "table", entity_id: `public.${t.table}`,
      title: `${count} rows: ${t.title}`,
      evidence: { count, would_action: t.action },
      recommended_action: `Phase-2 cleanup-worker action: ${t.action}. Currently no rows are touched.`,
      risk_explanation: "Read-only preview. Execution is disabled in Phase 1.",
    });
  }

  return { findings, warnings };
}
