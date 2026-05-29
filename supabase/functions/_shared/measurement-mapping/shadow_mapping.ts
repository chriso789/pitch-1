// Phase 1.6 — shadow mapping runner.
//
// Runs the section-aware mapper against real tenant data in dry-run mode.
// NEVER persists assignments. Emits a JSON report and structured events.
// Hard-fails (non-zero exit) on safety violations.
//
// Usage:
//   deno run --allow-env --allow-net \
//     supabase/functions/_shared/measurement-mapping/shadow_mapping.ts \
//     --tenant-id <uuid> [--limit-imports 200] [--limit-templates 50]

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapMeasurementsToTemplate } from "./mapper.ts";
import { logMappingEvent } from "./events.ts";
import type {
  Assignment,
  MeasurementFeature,
  MeasurementSegment,
  TemplateItemRule,
  TemplateSectionRule,
} from "./types.ts";

interface Args {
  tenantId?: string;
  limitImports: number;
  limitTemplates: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { limitImports: 200, limitTemplates: 50 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--tenant-id") a.tenantId = argv[++i];
    else if (k === "--limit-imports") a.limitImports = Number(argv[++i]);
    else if (k === "--limit-templates") a.limitTemplates = Number(argv[++i]);
  }
  return a;
}

interface ShadowReport {
  tenant_id: string;
  shadow_run_id: string;
  templates_checked: number;
  measurement_imports_checked: number;
  mapping_runs_simulated: number;
  assigned: number;
  assigned_global_fallback: number;
  manual_split: number;
  unresolved: number;
  missing_class_measurement: number;
  global_only_import: number;
  safety_violations: number;
  violations: Array<{ kind: string; detail: Record<string, unknown> }>;
}

interface ItemFlags {
  surfaceClasses: string[];
  scope: "class" | "global" | "feature";
}

function itemRuleFlags(rule: TemplateItemRule | undefined): ItemFlags {
  return {
    surfaceClasses: rule?.surface_classes ?? [],
    scope: (rule?.measurement_scope as ItemFlags["scope"]) ?? "global",
  };
}

function detectViolations(
  assignment: Assignment,
  segments: MeasurementSegment[],
  itemFlags: ItemFlags,
  importAggregateOnly: boolean,
  report: ShadowReport,
) {
  // Hard fail: global-only import producing assigned flat/sloped class quantity.
  if (
    importAggregateOnly &&
    (assignment.status === "assigned") &&
    itemFlags.scope === "class" &&
    (itemFlags.surfaceClasses.includes("flat") || itemFlags.surfaceClasses.includes("sloped"))
  ) {
    report.safety_violations++;
    report.violations.push({
      kind: "global_only_import_class_assignment",
      detail: {
        template_item_id: assignment.template_item_id,
        required_classes: itemFlags.surfaceClasses,
      },
    });
  }
  // Hard fail: flat segment mapped to sloped-only item / vice versa.
  const segs = segments.filter((s) => assignment.segment_ids.includes(s.id));
  for (const s of segs) {
    if (itemFlags.surfaceClasses.length > 0 && !itemFlags.surfaceClasses.includes(s.surface_class)) {
      report.safety_violations++;
      report.violations.push({
        kind: "cross_class_assignment",
        detail: {
          template_item_id: assignment.template_item_id,
          segment_class: s.surface_class,
          required_classes: itemFlags.surfaceClasses,
        },
      });
    }
  }
}

async function loadTemplateBundle(sb: SupabaseClient, templateId: string) {
  const [{ data: groups }, { data: items }, { data: sectionRules }, { data: itemRules }] = await Promise.all([
    sb.from("estimate_template_groups").select("id, name, group_type, sort_order").eq("template_id", templateId),
    sb.from("estimate_template_items").select("id, group_id, item_name, unit, qty_formula, measurement_type").eq("template_id", templateId),
    sb.from("estimate_template_section_rules").select("*").eq("template_id", templateId),
    sb.from("estimate_template_item_rules").select("*").eq("template_id", templateId),
  ]);
  return {
    groups: groups ?? [],
    items: items ?? [],
    section_rules: (sectionRules ?? []) as TemplateSectionRule[],
    item_rules: (itemRules ?? []) as TemplateItemRule[],
  };
}

async function main() {
  const args = parseArgs(Deno.args);
  if (!args.tenantId) {
    console.error("REFUSED: --tenant-id required.");
    Deno.exit(2);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env");
    Deno.exit(1);
  }
  const sb = createClient(url, key);

  // Templates with section mapping ON.
  const { data: templates } = await sb
    .from("estimate_templates")
    .select("id, name, use_section_mapping")
    .eq("tenant_id", args.tenantId)
    .eq("use_section_mapping", true)
    .limit(args.limitTemplates);

  const { data: imports } = await sb
    .from("measurement_imports")
    .select("id, aggregate_only")
    .eq("tenant_id", args.tenantId)
    .is("voided_at", null)
    .limit(args.limitImports);

  const shadowRunId = crypto.randomUUID();
  const report: ShadowReport = {
    tenant_id: args.tenantId,
    shadow_run_id: shadowRunId,
    templates_checked: (templates ?? []).length,
    measurement_imports_checked: (imports ?? []).length,
    mapping_runs_simulated: 0,
    assigned: 0,
    assigned_global_fallback: 0,
    manual_split: 0,
    unresolved: 0,
    missing_class_measurement: 0,
    global_only_import: 0,
    safety_violations: 0,
    violations: [],
  };

  for (const tpl of templates ?? []) {
    const bundle = await loadTemplateBundle(sb, tpl.id);

    for (const imp of imports ?? []) {
      const [{ data: segs }, { data: feats }] = await Promise.all([
        sb.from("measurement_segments").select("*").eq("measurement_import_id", imp.id).is("archived_at", null),
        sb.from("measurement_features").select("*").eq("measurement_import_id", imp.id).is("archived_at", null),
      ]);

      const segments = (segs ?? []) as MeasurementSegment[];
      const features = (feats ?? []) as MeasurementFeature[];

      const result = mapMeasurementsToTemplate({
        measurement_import_id: imp.id,
        calc_template_id: tpl.id,
        segments,
        features,
        groups: bundle.groups,
        items: bundle.items,
        section_rules: bundle.section_rules,
        item_rules: bundle.item_rules,
      });

      report.mapping_runs_simulated += 1;
      for (const a of result.assignments) {
        if (a.status === "assigned_global_fallback") report.assigned_global_fallback++;
        else report.assigned++;
        if (a.reason_code === "manual_split") report.manual_split++;
        const flags = itemRuleFlags(bundle.item_rules.find((r) => r.item_id === a.template_item_id));
        detectViolations(a, segments, flags, !!imp.aggregate_only, report);
      }
      for (const u of result.unresolved) {
        report.unresolved++;
        if (u.reason_code === "missing_class_measurement") report.missing_class_measurement++;
        if (u.reason_code === "global_only_import") report.global_only_import++;
      }

      logMappingEvent("measurement_mapping_previewed", {
        tenant_id: args.tenantId,
        measurement_import_id: imp.id,
        estimate_template_id: tpl.id,
        dry_run: true,
        assignment_count: result.assignments.length,
        unresolved_count: result.unresolved.length,
        global_fallback_count: result.assignments.filter((a) => a.status === "assigned_global_fallback").length,
        manual_split_count: result.assignments.filter((a) => a.reason_code === "manual_split").length,
      });
    }
  }

  if (report.safety_violations > 0) {
    logMappingEvent("measurement_mapping_safety_violation", {
      tenant_id: args.tenantId,
      safety_violation_count: report.safety_violations,
      detail: { shadow_run_id: shadowRunId, sample: report.violations.slice(0, 5) },
    });
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.safety_violations > 0) Deno.exit(3);
}

if (import.meta.main) main();
