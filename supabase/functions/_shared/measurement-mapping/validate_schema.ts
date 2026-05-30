// Phase 1.6 — schema readiness validator.
//
// Read-only. Connects to whatever Supabase project SUPABASE_URL points at and
// reports whether the section-mapping schema required by Phase 1 / 1.5 / 1.6
// is present. Does not mutate anything. Intended to be run against a candidate
// staging project before any backfill or shadow run.
//
// Usage:
//   deno run --allow-env --allow-net \
//     supabase/functions/_shared/measurement-mapping/validate_schema.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enforceEnvironmentGuards } from "./guards.ts";

interface RequiredColumn {
  table: string;
  column: string;
  optional?: boolean;
}

const REQUIRED_TABLES = [
  "measurement_imports",
  "measurement_segments",
  "measurement_features",
  "estimate_templates",
  "estimate_template_groups",
  "estimate_template_items",
  "estimate_template_section_rules",
  "estimate_template_item_rules",
  "estimate_measurement_assignments",
] as const;

const REQUIRED_COLUMNS: RequiredColumn[] = [
  { table: "estimate_templates", column: "use_section_mapping" },
  { table: "measurement_imports", column: "source" },
  { table: "measurement_imports", column: "backfill_run_id" },
  { table: "measurement_imports", column: "backfill_status" },
  { table: "measurement_imports", column: "voided_at" },
  { table: "measurement_imports", column: "aggregate_only" },
  { table: "measurement_imports", column: "total_area_sqft" },
  { table: "measurement_segments", column: "source" },
  { table: "measurement_segments", column: "backfill_run_id" },
  { table: "measurement_features", column: "source" },
  { table: "measurement_features", column: "backfill_run_id" },
];

async function main() {
  enforceEnvironmentGuards({
    scriptName: "validate_schema",
    wantsWrite: false,
    allowStagingWrite: false,
    argv: Deno.args,
  });

  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env.");
    Deno.exit(1);
  }
  const sb = createClient(url, key);

  const missingTables: string[] = [];
  const missingColumns: RequiredColumn[] = [];

  for (const t of REQUIRED_TABLES) {
    const { error } = await sb.from(t).select("*", { head: true, count: "exact" }).limit(0);
    if (error && /relation .* does not exist|not find the table|schema cache/i.test(error.message)) {
      missingTables.push(t);
    }
  }

  for (const rc of REQUIRED_COLUMNS) {
    if (missingTables.includes(rc.table)) continue; // already reported
    const { error } = await sb.from(rc.table).select(rc.column).limit(0);
    if (error && /column .* does not exist|could not find the .* column/i.test(error.message)) {
      missingColumns.push(rc);
    }
  }

  const ok = missingTables.length === 0 && missingColumns.length === 0;
  const report = {
    ok,
    supabase_url: url,
    missing_tables: missingTables,
    missing_columns: missingColumns,
    checked_at: new Date().toISOString(),
  };
  console.log(JSON.stringify(report, null, 2));
  Deno.exit(ok ? 0 : 1);
}

if (import.meta.main) main();
