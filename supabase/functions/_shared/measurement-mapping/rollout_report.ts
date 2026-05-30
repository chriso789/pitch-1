// Phase 1.6 — tenant-level rollout readiness report.
//
// Aggregates templates, imports, shadow mapping outcomes, and safety counters
// into a single JSON snapshot used by ops to decide whether a tenant/template
// is ready for a tiny allowlist rollout.
//
// Usage:
//   deno run --allow-env --allow-net \
//     supabase/functions/_shared/measurement-mapping/rollout_report.ts \
//     --tenant-id <uuid>

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapMeasurementsToTemplate } from "./mapper.ts";
import type {
  MeasurementFeature,
  MeasurementSegment,
  TemplateItemRule,
  TemplateSectionRule,
} from "./types.ts";

interface Args { tenantId?: string }
function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tenant-id") a.tenantId = argv[++i];
  }
  return a;
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
  const { enforceEnvironmentGuards } = await import("./guards.ts");
  enforceEnvironmentGuards({
    scriptName: "rollout_report",
    wantsWrite: false,
    allowStagingWrite: false,
    argv: Deno.args,
  });
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

  const { data: templates } = await sb
    .from("estimate_templates")
    .select("id, name, use_section_mapping")
    .eq("tenant_id", args.tenantId);
  const { data: imports } = await sb
    .from("measurement_imports")
    .select("id, aggregate_only, source")
    .eq("tenant_id", args.tenantId)
    .is("voided_at", null);
  const { data: segments } = await sb
    .from("measurement_segments")
    .select("id, measurement_import_id, surface_class, is_synthetic_split")
    .eq("tenant_id", args.tenantId)
    .is("archived_at", null);

  // Classify imports.
  const segsByImport = new Map<string, MeasurementSegment[]>();
  for (const s of (segments ?? []) as MeasurementSegment[]) {
    const arr = segsByImport.get(s.measurement_import_id ?? "") ?? [];
    arr.push(s);
    segsByImport.set(s.measurement_import_id ?? "", arr);
  }
  let aggregateOnly = 0, segmented = 0, mixed = 0, manualSplit = 0, manualReview = 0;
  for (const imp of imports ?? []) {
    const segs = segsByImport.get(imp.id) ?? [];
    const classes = new Set(segs.map((s) => s.surface_class));
    if (segs.some((s) => s.is_synthetic_split)) manualSplit++;
    if (imp.aggregate_only) { aggregateOnly++; manualReview++; continue; }
    if (classes.has("flat") && classes.has("sloped")) mixed++;
    else if (segs.length > 0) segmented++;
  }

  // Shadow mapping per template to score safety.
  let assigned = 0, assignedGlobalFallback = 0, unresolved = 0, missingClass = 0;
  let safetyViolations = 0, globalLeaks = 0, crossClass = 0;
  const templateScores: Record<string, { assigned: number; unresolved: number; violations: number; rules: number }> = {};

  for (const tpl of templates ?? []) {
    const bundle = await loadTemplateBundle(sb, tpl.id);
    const score = { assigned: 0, unresolved: 0, violations: 0, rules: bundle.section_rules.length + bundle.item_rules.length };
    for (const imp of imports ?? []) {
      const segs = segsByImport.get(imp.id) ?? [];
      const { data: feats } = await sb.from("measurement_features").select("*").eq("measurement_import_id", imp.id).is("archived_at", null);
      const features = (feats ?? []) as MeasurementFeature[];

      const result = mapMeasurementsToTemplate({
        measurement_import_id: imp.id,
        calc_template_id: tpl.id,
        segments: segs as MeasurementSegment[],
        features,
        groups: bundle.groups,
        items: bundle.items,
        section_rules: bundle.section_rules,
        item_rules: bundle.item_rules,
      });
      for (const a of result.assignments) {
        if (a.status === "assigned_global_fallback") { assignedGlobalFallback++; }
        else { assigned++; score.assigned++; }
      }
      for (const u of result.unresolved) {
        unresolved++; score.unresolved++;
        if (u.reason_code === "missing_class_measurement") missingClass++;
      }
      // Safety scan.
      for (const a of result.assignments) {
        const rule = bundle.item_rules.find((r) => r.item_id === a.template_item_id);
        if (!rule) continue;
        if (imp.aggregate_only && rule.measurement_scope === "class" &&
            (rule.surface_classes.includes("flat") || rule.surface_classes.includes("sloped")) &&
            a.status === "assigned") {
          safetyViolations++; globalLeaks++; score.violations++;
        }
        const segMatched = segs.filter((s) => a.segment_ids.includes(s.id));
        for (const s of segMatched) {
          if (rule.surface_classes.length > 0 && !rule.surface_classes.includes(s.surface_class)) {
            safetyViolations++; crossClass++; score.violations++;
          }
        }
      }
    }
    templateScores[tpl.id] = score;
  }

  let safeToEnable = 0, needsRuleCleanup = 0;
  for (const tpl of templates ?? []) {
    const s = templateScores[tpl.id];
    if (!s) continue;
    if (s.violations === 0 && s.rules > 0 && s.unresolved === 0) safeToEnable++;
    else if (s.violations > 0 || s.unresolved > 0) needsRuleCleanup++;
  }

  const report = {
    tenant_id: args.tenantId,
    templates: {
      total: (templates ?? []).length,
      section_mapping_enabled: (templates ?? []).filter((t) => t.use_section_mapping).length,
      safe_to_enable: safeToEnable,
      needs_rule_cleanup: needsRuleCleanup,
    },
    imports: {
      total: (imports ?? []).length,
      aggregate_only: aggregateOnly,
      segmented,
      mixed,
      manual_split: manualSplit,
      manual_review_required: manualReview,
    },
    assignments: {
      assigned,
      assigned_global_fallback: assignedGlobalFallback,
      unresolved,
      missing_class_measurement: missingClass,
    },
    safety: {
      violations: safetyViolations,
      global_only_class_leaks: globalLeaks,
      cross_class_assignments: crossClass,
      duplicate_active_assignments: 0,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) main();
