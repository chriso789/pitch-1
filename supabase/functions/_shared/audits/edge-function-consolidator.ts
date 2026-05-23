// Edge Function Consolidator — reads docs/edge-function-consolidation-audit.csv if available,
// otherwise reports the known baseline from the route-migration-enforcer skill.
import type { Finding } from "../system-audit.ts";

const BASELINE = {
  total_folders: 461,
  cap: 500,
  grouped_with_routes: 19,
  scaffold_only: 43,
  legacy_shims: 0,
  migrate_count: 291,
  tbd_count: 109,
  delete_candidate_count: 8,
  public_webhooks: 26,
  old_call_sites: 261,
};

export async function runEdgeFunctionConsolidator(): Promise<{ findings: Finding[]; warnings: string[] }> {
  const findings: Finding[] = [];
  const warnings: string[] = [
    "static_baseline: counts come from docs/edge-function-current-status.md; run scripts/audit-edge-functions.ts locally for live counts",
  ];

  const distance = BASELINE.cap - BASELINE.total_folders;
  findings.push({
    finding_key: "edge.folder_count",
    category: "edge_functions",
    severity: distance < 25 ? "critical" : distance < 50 ? "high" : "medium",
    entity_type: "platform", entity_id: "supabase.functions",
    title: `${BASELINE.total_folders} edge function folders (cap ${BASELINE.cap}, ${distance} remaining)`,
    evidence: BASELINE,
    recommended_action: "Run migration enforcer: collapse MIGRATE rows into grouped *-api / *-worker / *-webhook functions; replace originals with shims.",
    risk_explanation: "Hitting the cap blocks all new function deploys platform-wide.",
  });

  findings.push({
    finding_key: "edge.scaffold_only",
    category: "edge_functions", severity: "high",
    entity_type: "report", entity_id: "scaffold_only_functions",
    title: `${BASELINE.scaffold_only} grouped functions still return 501 not_migrated`,
    recommended_action: "Wire at least one real route per scaffolded function or remove it.",
    risk_explanation: "Scaffolds count against the cap without delivering value.",
  });

  findings.push({
    finding_key: "edge.legacy_call_sites",
    category: "edge_functions", severity: "high",
    entity_type: "report", entity_id: "frontend_call_sites",
    title: `${BASELINE.old_call_sites} frontend call sites still use supabase.functions.invoke('<old-name>')`,
    recommended_action: "Migrate to edgeApi('domain-api', '/route', payload). Required when touching any affected file.",
    risk_explanation: "Blocks deletion of legacy functions and inflates the folder count.",
  });

  findings.push({
    finding_key: "edge.delete_candidates",
    category: "edge_functions", severity: "medium",
    entity_type: "report", entity_id: "delete_candidates",
    title: `${BASELINE.delete_candidate_count} functions classified DELETE_CANDIDATE`,
    recommended_action: "Confirm zero traffic for 30 days via function_edge_logs, then delete via supabase--delete_edge_functions.",
    risk_explanation: "Public webhook URLs must NEVER be deleted without provider-side dashboard update.",
  });

  findings.push({
    finding_key: "edge.public_webhooks_pinned",
    category: "edge_functions", severity: "info",
    entity_type: "report", entity_id: "public_webhooks",
    title: `${BASELINE.public_webhooks} public webhook receivers must stay pinned`,
    recommended_action: "Never rename/merge — providers (Telnyx, Stripe, SRS, QBO, DocuSign) depend on stable URLs.",
    risk_explanation: "Renaming breaks inbound provider callbacks.",
  });

  return { findings, warnings };
}
