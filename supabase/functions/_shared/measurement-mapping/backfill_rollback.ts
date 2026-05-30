// Phase 1.6 — staging backfill rollback.
//
// Removes or voids everything created by a given backfill_run_id. Original
// roof_measurements rows are NEVER touched.
//
// Usage:
//   deno run --allow-env --allow-net \
//     supabase/functions/_shared/measurement-mapping/backfill_rollback.ts \
//     --backfill-run-id <uuid> [--mode delete|void]

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logMappingEvent } from "./events.ts";
import { enforceEnvironmentGuards, hasFlag } from "./guards.ts";

interface Args {
  backfillRunId?: string;
  mode: "delete" | "void";
}

function parseArgs(argv: string[]): Args {
  const a: Args = { mode: "delete" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--backfill-run-id") a.backfillRunId = argv[++i];
    else if (k === "--mode") a.mode = (argv[++i] as Args["mode"]) ?? "delete";
  }
  return a;
}

function isStagingEnv(): boolean {
  const env = (Deno.env.get("DEPLOY_ENV") ?? Deno.env.get("ENVIRONMENT") ?? "").toLowerCase();
  return env === "staging" || env === "development" || env === "dev";
}

async function main() {
  const args = parseArgs(Deno.args);
  enforceEnvironmentGuards({
    scriptName: "backfill_rollback",
    wantsWrite: true, // rollback always mutates
    allowStagingWrite: hasFlag(Deno.args, "--allow-staging-write"),
    argv: Deno.args,
  });
  if (!args.backfillRunId) {
    console.error("REFUSED: --backfill-run-id required.");
    Deno.exit(2);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env");
    Deno.exit(1);
  }
  const sb = createClient(url, key);

  // Inspect what was created.
  const [{ data: imps }, { data: segs }, { data: feats }, { data: asgns }] = await Promise.all([
    sb.from("measurement_imports").select("id, tenant_id").eq("backfill_run_id", args.backfillRunId),
    sb.from("measurement_segments").select("id, measurement_import_id").eq("backfill_run_id", args.backfillRunId),
    sb.from("measurement_features").select("id").eq("backfill_run_id", args.backfillRunId),
    sb.from("estimate_measurement_assignments")
      .select("id")
      .in("measurement_import_id", (imps ?? []).map((r) => r.id).length > 0 ? (imps ?? []).map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]),
  ]);

  const report = {
    backfill_run_id: args.backfillRunId,
    mode: args.mode,
    tenant_ids: Array.from(new Set((imps ?? []).map((r) => r.tenant_id).filter(Boolean))),
    imports_found: (imps ?? []).length,
    segments_found: (segs ?? []).length,
    features_found: (feats ?? []).length,
    assignments_affected: (asgns ?? []).length,
  };
  console.error("ROLLBACK PLAN:", JSON.stringify(report, null, 2));

  if (args.mode === "delete") {
    // Delete in FK-safe order.
    if ((asgns ?? []).length > 0) {
      await sb.from("estimate_measurement_assignments")
        .update({ superseded_at: new Date().toISOString(), status: "superseded" })
        .in("id", (asgns ?? []).map((r) => r.id));
    }
    await sb.from("measurement_features").delete().eq("backfill_run_id", args.backfillRunId);
    await sb.from("measurement_segments").delete().eq("backfill_run_id", args.backfillRunId);
    await sb.from("measurement_imports").delete().eq("backfill_run_id", args.backfillRunId);
  } else {
    const ts = new Date().toISOString();
    await sb.from("measurement_features").update({ voided_at: ts, backfill_status: "rolled_back" }).eq("backfill_run_id", args.backfillRunId);
    await sb.from("measurement_segments").update({ voided_at: ts, backfill_status: "rolled_back" }).eq("backfill_run_id", args.backfillRunId);
    await sb.from("measurement_imports").update({ voided_at: ts, backfill_status: "rolled_back" }).eq("backfill_run_id", args.backfillRunId);
  }

  logMappingEvent("measurement_mapping_superseded", {
    detail: { ...report, action: "backfill_rollback" },
  });

  console.log(JSON.stringify({ ...report, status: "completed" }, null, 2));
}

if (import.meta.main) main();
