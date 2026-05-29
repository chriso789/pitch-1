// Phase 1.6 — staging-only backfill writer.
//
// Normalizes existing roof_measurements rows into the new
// measurement_imports / measurement_segments / measurement_features model
// WITHOUT touching original roof_measurements and WITHOUT creating estimate
// assignments.
//
// Hard guards:
//   - Refuses to run unless DEPLOY_ENV is "staging" or "development".
//   - Requires --write.
//   - Requires --tenant-id.
//   - Requires --limit OR --since OR --measurement-id.
//   - Tags every created row with backfill_run_id + source='backfill'.
//   - Never updates or deletes roof_measurements.
//
// Usage:
//   deno run --allow-env --allow-net \
//     supabase/functions/_shared/measurement-mapping/backfill_staging.ts \
//     --write --tenant-id <uuid> --limit 25

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifySurface } from "./classifier.ts";
import { logMappingEvent } from "./events.ts";

interface Args {
  tenantId?: string;
  limit?: number;
  since?: string;
  measurementId?: string;
  write: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { write: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--tenant-id") a.tenantId = argv[++i];
    else if (k === "--limit") a.limit = Number(argv[++i]);
    else if (k === "--since") a.since = argv[++i];
    else if (k === "--measurement-id") a.measurementId = argv[++i];
    else if (k === "--write") a.write = true;
  }
  return a;
}

function isStagingEnv(): boolean {
  const env = (Deno.env.get("DEPLOY_ENV") ?? Deno.env.get("ENVIRONMENT") ?? "").toLowerCase();
  return env === "staging" || env === "development" || env === "dev";
}

function parsePitch(s: string | null): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d+(?:\.\d+)?)\s*\/\s*12/);
  return m ? Number(m[1]) : null;
}

interface RoofRow {
  id: string;
  tenant_id: string | null;
  total_area_adjusted_sqft: number | null;
  total_area_flat_sqft: number | null;
  predominant_pitch: string | null;
  pitch_degrees: number | null;
  created_at: string | null;
}

interface PlannedImport {
  source_roof_measurement_id: string;
  tenant_id: string;
  total_area_sqft: number;
  flat_area_sqft: number;
  sloped_area_sqft: number;
  pitch_rise_over_12: number | null;
  aggregate_only: boolean;
}

function planRow(row: RoofRow): PlannedImport | null {
  if (!row.tenant_id) return null;
  const total = Number(row.total_area_adjusted_sqft ?? 0);
  if (!(total > 0)) return null;
  const flat = Math.max(0, Number(row.total_area_flat_sqft ?? 0));
  const pitch = parsePitch(row.predominant_pitch);
  const sloped = Math.max(0, total - flat);
  return {
    source_roof_measurement_id: row.id,
    tenant_id: row.tenant_id,
    total_area_sqft: total,
    flat_area_sqft: flat,
    sloped_area_sqft: sloped,
    pitch_rise_over_12: pitch,
    aggregate_only: !(flat > 0 && flat < total),
  };
}

async function writePlanned(
  sb: SupabaseClient,
  plan: PlannedImport,
  backfillRunId: string,
): Promise<{ import_id: string; segment_count: number }> {
  const importRow = {
    tenant_id: plan.tenant_id,
    source: "backfill",
    source_roof_measurement_id: plan.source_roof_measurement_id,
    backfill_run_id: backfillRunId,
    aggregate_only: plan.aggregate_only,
    total_area_sqft: plan.total_area_sqft,
  };
  const { data: imp, error: impErr } = await sb
    .from("measurement_imports")
    .insert(importRow)
    .select("id")
    .single();
  if (impErr || !imp) throw new Error(`measurement_imports insert failed: ${impErr?.message}`);

  const segs: Record<string, unknown>[] = [];
  if (plan.aggregate_only) {
    const cls = classifySurface({
      pitch_rise_over_12: plan.pitch_rise_over_12,
      pitch_scope: plan.pitch_rise_over_12 == null ? "none" : "global",
    });
    segs.push({
      tenant_id: plan.tenant_id,
      measurement_import_id: imp.id,
      source: "backfill",
      backfill_run_id: backfillRunId,
      surface_class: cls.surface_class,
      classification_confidence: cls.confidence,
      area_sqft: plan.total_area_sqft,
      pitch_rise_over_12: plan.pitch_rise_over_12,
      pitch_scope: plan.pitch_rise_over_12 == null ? "none" : "global",
      is_synthetic_split: false,
      reviewed: false,
    });
  } else {
    segs.push({
      tenant_id: plan.tenant_id,
      measurement_import_id: imp.id,
      source: "backfill",
      backfill_run_id: backfillRunId,
      surface_class: "sloped",
      classification_confidence: 0.7,
      area_sqft: plan.sloped_area_sqft,
      pitch_rise_over_12: plan.pitch_rise_over_12,
      pitch_scope: plan.pitch_rise_over_12 == null ? "none" : "global",
      is_synthetic_split: false,
      reviewed: false,
    });
    segs.push({
      tenant_id: plan.tenant_id,
      measurement_import_id: imp.id,
      source: "backfill",
      backfill_run_id: backfillRunId,
      surface_class: "flat",
      classification_confidence: 0.7,
      area_sqft: plan.flat_area_sqft,
      pitch_rise_over_12: 0,
      pitch_scope: "segment",
      is_synthetic_split: false,
      reviewed: false,
    });
  }
  const { error: segErr } = await sb.from("measurement_segments").insert(segs);
  if (segErr) throw new Error(`measurement_segments insert failed: ${segErr.message}`);

  return { import_id: imp.id, segment_count: segs.length };
}

async function main() {
  const args = parseArgs(Deno.args);

  if (!args.write) {
    console.error("REFUSED: staging backfill requires --write (and runs only in staging).");
    Deno.exit(2);
  }
  if (!isStagingEnv()) {
    console.error("REFUSED: DEPLOY_ENV is not staging/development. Production backfill is forbidden.");
    Deno.exit(2);
  }
  if (!args.tenantId) {
    console.error("REFUSED: --tenant-id is required.");
    Deno.exit(2);
  }
  if (args.limit == null && !args.since && !args.measurementId) {
    console.error("REFUSED: provide --limit, --since, or --measurement-id.");
    Deno.exit(2);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env");
    Deno.exit(1);
  }
  const sb = createClient(url, key);

  let q = sb
    .from("roof_measurements")
    .select("id, tenant_id, total_area_adjusted_sqft, total_area_flat_sqft, predominant_pitch, pitch_degrees, created_at")
    .eq("tenant_id", args.tenantId);
  if (args.measurementId) q = q.eq("id", args.measurementId);
  if (args.since) q = q.gte("created_at", args.since);
  if (args.limit != null) q = q.limit(args.limit);

  const { data, error } = await q;
  if (error) {
    console.error("Query failed:", error.message);
    Deno.exit(1);
  }
  const rows = (data ?? []) as RoofRow[];

  const backfillRunId = crypto.randomUUID();
  const plans = rows.map(planRow).filter((p): p is PlannedImport => p !== null);

  const summary = {
    backfill_run_id: backfillRunId,
    tenant_id: args.tenantId,
    scanned: rows.length,
    eligible: plans.length,
    will_create_imports: plans.length,
    will_create_segments: plans.reduce((n, p) => n + (p.aggregate_only ? 1 : 2), 0),
  };
  console.error("PLAN:", JSON.stringify(summary, null, 2));

  let importsCreated = 0;
  let segmentsCreated = 0;
  const errors: Array<{ source_id: string; error: string }> = [];
  for (const plan of plans) {
    try {
      const r = await writePlanned(sb, plan, backfillRunId);
      importsCreated++;
      segmentsCreated += r.segment_count;
      logMappingEvent("measurement_import_normalized", {
        tenant_id: plan.tenant_id,
        measurement_import_id: r.import_id,
        detail: {
          backfill_run_id: backfillRunId,
          aggregate_only: plan.aggregate_only,
          segment_count: r.segment_count,
        },
      });
    } catch (e) {
      errors.push({ source_id: plan.source_roof_measurement_id, error: String((e as Error).message) });
    }
  }

  console.log(JSON.stringify({
    ...summary,
    imports_created: importsCreated,
    segments_created: segmentsCreated,
    errors,
  }, null, 2));
}

if (import.meta.main) main();
