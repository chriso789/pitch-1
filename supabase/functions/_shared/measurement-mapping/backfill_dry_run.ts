// Phase 1.5 backfill DRY-RUN tooling.
//
// Scans existing roof_measurements rows and reports how a future production
// backfill into measurement_imports would look. By default this writes
// NOTHING — it only emits a JSON report to stdout.
//
// Usage (Deno):
//   deno run --allow-env --allow-net \
//     supabase/functions/_shared/measurement-mapping/backfill_dry_run.ts \
//     [--tenant <uuid>] [--limit 500]
//
// Production backfill (`--write`) is intentionally NOT implemented. Phase 1.5
// stops at the dry-run report.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifySurface } from "./classifier.ts";

interface Args {
  tenant?: string;
  limit: number;
  write: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { limit: 500, write: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--tenant") a.tenant = argv[++i];
    else if (k === "--limit") a.limit = Number(argv[++i]);
    else if (k === "--write") a.write = true;
  }
  return a;
}

interface RoofMeasurementRow {
  id: string;
  tenant_id: string | null;
  total_area_adjusted_sqft: number | null;
  total_area_flat_sqft: number | null;
  predominant_pitch: string | null;
  pitch_degrees: number | null;
}

interface SafetyIssue {
  row_id: string;
  reason: string;
}

interface DryRunReport {
  scanned: number;
  eligible: number;
  aggregate_only: number;
  segmented: number;
  manual_review_required: number;
  would_create_imports: number;
  would_create_segments: number;
  would_use_global_fallback: number;
  would_leave_class_scoped_unresolved: number;
  safety_issues: SafetyIssue[];
  per_tenant: Record<string, number>;
}

function parsePitch(s: string | null): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d+(?:\.\d+)?)\s*\/\s*12/);
  return m ? Number(m[1]) : null;
}

function planRow(row: RoofMeasurementRow, issues: SafetyIssue[]): {
  eligible: boolean;
  aggregate_only: boolean;
  segmented: boolean;
  segments_planned: number;
  needs_review: boolean;
  would_global_fallback: boolean;
  would_leave_class_unresolved: boolean;
} {
  const result = {
    eligible: false,
    aggregate_only: false,
    segmented: false,
    segments_planned: 0,
    needs_review: false,
    would_global_fallback: false,
    would_leave_class_unresolved: false,
  };

  if (!row.tenant_id) {
    issues.push({ row_id: row.id, reason: "tenant_id_missing" });
    return result;
  }
  const totalArea = Number(row.total_area_adjusted_sqft ?? 0);
  if (!(totalArea > 0)) {
    issues.push({ row_id: row.id, reason: "no_usable_total_area" });
    return result;
  }

  const pitch = parsePitch(row.predominant_pitch);
  const flatArea = Number(row.total_area_flat_sqft ?? 0);

  result.eligible = true;

  if (flatArea > 0 && flatArea < totalArea) {
    result.segmented = true;
    result.segments_planned = 2;
  } else {
    result.aggregate_only = true;
    result.segments_planned = 1;
    result.would_global_fallback = true;
    // Without explicit class evidence, any class-scoped template item would
    // be left unresolved.
    result.would_leave_class_unresolved = true;
  }

  // Classify whether the single-segment normalization would land in "unknown".
  const cls = classifySurface({ pitch_rise_over_12: pitch, pitch_scope: pitch == null ? "none" : "global" });
  if (cls.surface_class === "unknown" || cls.confidence < 0.5) {
    result.needs_review = true;
  }

  return result;
}

async function main() {
  const args = parseArgs(Deno.args);
  const { enforceEnvironmentGuards } = await import("./guards.ts");
  enforceEnvironmentGuards({
    scriptName: "backfill_dry_run",
    wantsWrite: false,
    allowStagingWrite: false,
    argv: Deno.args,
  });

  if (args.write) {
    // Phase 1.5 explicitly forbids production backfill writes.
    console.error("REFUSED: --write is not supported in Phase 1.5. Dry-run only.");
    Deno.exit(2);
  }

  const url = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env");
    Deno.exit(1);
  }
  const supabase = createClient(url, key);

  let q = supabase
    .from("roof_measurements")
    .select("id, tenant_id, total_area_adjusted_sqft, total_area_flat_sqft, predominant_pitch, pitch_degrees")
    .limit(args.limit);
  if (args.tenant) q = q.eq("tenant_id", args.tenant);

  const { data, error } = await q;
  if (error) {
    console.error("Query failed:", error.message);
    Deno.exit(1);
  }
  const rows = (data ?? []) as RoofMeasurementRow[];

  const issues: SafetyIssue[] = [];
  const report: DryRunReport = {
    scanned: rows.length,
    eligible: 0,
    aggregate_only: 0,
    segmented: 0,
    manual_review_required: 0,
    would_create_imports: 0,
    would_create_segments: 0,
    would_use_global_fallback: 0,
    would_leave_class_scoped_unresolved: 0,
    safety_issues: issues,
    per_tenant: {},
  };

  for (const r of rows) {
    const p = planRow(r, issues);
    if (p.eligible) {
      report.eligible++;
      report.would_create_imports++;
      report.would_create_segments += p.segments_planned;
      if (p.aggregate_only) report.aggregate_only++;
      if (p.segmented) report.segmented++;
      if (p.needs_review) report.manual_review_required++;
      if (p.would_global_fallback) report.would_use_global_fallback++;
      if (p.would_leave_class_unresolved) report.would_leave_class_scoped_unresolved++;
      if (r.tenant_id) report.per_tenant[r.tenant_id] = (report.per_tenant[r.tenant_id] ?? 0) + 1;
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) main();
