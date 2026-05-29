// Phase 1.6 — legacy vs section-aware comparison report.
//
// For each (template, import) pair the shadow mapper would run, compute:
//   - legacy aggregate quantity per item (qty_formula evaluated against the
//     pre-Phase-1 global-only context)
//   - new section-aware quantity per item
// and flag drift / class leakage / fallback issues.
//
// Usage:
//   deno run --allow-env --allow-net \
//     supabase/functions/_shared/measurement-mapping/legacy_comparison.ts \
//     --tenant-id <uuid> [--limit-imports 100] [--limit-templates 25] \
//     [--area-tolerance-pct 0.5] [--money-tolerance-pct 0.5]

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapMeasurementsToTemplate } from "./mapper.ts";
import { evaluateFormula } from "./formula.ts";
import { buildScopedContext } from "./context.ts";
import type {
  MeasurementFeature,
  MeasurementSegment,
  TemplateItemRule,
  TemplateSectionRule,
} from "./types.ts";

interface Args {
  tenantId?: string;
  limitImports: number;
  limitTemplates: number;
  areaTolPct: number;
  moneyTolPct: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { limitImports: 100, limitTemplates: 25, areaTolPct: 0.5, moneyTolPct: 0.5 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--tenant-id") a.tenantId = argv[++i];
    else if (k === "--limit-imports") a.limitImports = Number(argv[++i]);
    else if (k === "--limit-templates") a.limitTemplates = Number(argv[++i]);
    else if (k === "--area-tolerance-pct") a.areaTolPct = Number(argv[++i]);
    else if (k === "--money-tolerance-pct") a.moneyTolPct = Number(argv[++i]);
  }
  return a;
}

function withinTol(legacy: number, next: number, pct: number, absMin: number): boolean {
  const diff = Math.abs(legacy - next);
  const tol = Math.max(absMin, (Math.abs(legacy) * pct) / 100);
  return diff <= tol;
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

  const { data: templates } = await sb
    .from("estimate_templates")
    .select("id, name, use_section_mapping")
    .eq("tenant_id", args.tenantId)
    .limit(args.limitTemplates);
  const { data: imports } = await sb
    .from("measurement_imports")
    .select("id, aggregate_only")
    .eq("tenant_id", args.tenantId)
    .is("voided_at", null)
    .limit(args.limitImports);

  const rows: Array<Record<string, unknown>> = [];
  let driftCount = 0;

  for (const tpl of templates ?? []) {
    const bundle = await loadTemplateBundle(sb, tpl.id);
    for (const imp of imports ?? []) {
      const [{ data: segs }, { data: feats }] = await Promise.all([
        sb.from("measurement_segments").select("*").eq("measurement_import_id", imp.id).is("archived_at", null),
        sb.from("measurement_features").select("*").eq("measurement_import_id", imp.id).is("archived_at", null),
      ]);
      const segments = (segs ?? []) as MeasurementSegment[];
      const features = (feats ?? []) as MeasurementFeature[];

      const newResult = mapMeasurementsToTemplate({
        measurement_import_id: imp.id,
        calc_template_id: tpl.id,
        segments,
        features,
        groups: bundle.groups,
        items: bundle.items,
        section_rules: bundle.section_rules,
        item_rules: bundle.item_rules,
      });

      // Legacy emulation: aggregate-only context, no section/item rules.
      const totalArea = segments.reduce((s, x) => s + Number(x.area_sqft ?? 0), 0);
      const legacyCtx = buildScopedContext(
        [{
          id: "legacy",
          surface_class: "unknown",
          area_sqft: totalArea,
          pitch_rise_over_12: null,
          pitch_scope: "global",
          classification_confidence: 0,
          is_synthetic_split: false,
          reviewed: false,
          archived_at: null,
        } as MeasurementSegment],
        features,
      );

      for (const item of bundle.items) {
        let legacyQty: number | null = null;
        try {
          legacyQty = evaluateFormula(item.qty_formula?.trim() || "0", legacyCtx).value;
        } catch (_e) { legacyQty = null; }

        const newAssignment =
          newResult.assignments.find((a) => a.template_item_id === item.id) ??
          newResult.unresolved.find((u) => u.template_item_id === item.id);
        const newQty = newAssignment?.quantity ?? null;
        const status = newAssignment?.status ?? "missing";
        const reason = newAssignment?.reason_code ?? null;

        const drift = legacyQty != null && newQty != null && !withinTol(legacyQty, newQty, args.areaTolPct, 1);
        const flags: string[] = [];
        if (drift) flags.push("quantity_drift");
        if (status === "unresolved" && (reason === "missing_class_measurement" || reason === "global_only_import")) {
          flags.push("class_scoped_unresolved");
        }
        if (status === "assigned_global_fallback") flags.push("global_fallback_used");

        if (flags.length > 0) {
          driftCount++;
          rows.push({
            template_id: tpl.id,
            template_name: tpl.name,
            measurement_import_id: imp.id,
            template_item_id: item.id,
            item_name: item.item_name,
            unit: item.unit,
            legacy_quantity: legacyQty,
            new_quantity: newQty,
            status,
            reason_code: reason,
            flags,
          });
        }
      }
    }
  }

  console.log(JSON.stringify({
    tenant_id: args.tenantId,
    templates_checked: (templates ?? []).length,
    imports_checked: (imports ?? []).length,
    flagged_rows: driftCount,
    rows,
  }, null, 2));
}

if (import.meta.main) main();
