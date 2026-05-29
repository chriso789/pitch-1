// Mapping engine — pairs every template item with the segments/features it accepts
// and evaluates its qty_formula in the scoped measurement context.
//
// Hard policy:
//   - Items with NO template_item_rules row default to measurement_scope='global',
//     allow_global_fallback=true. Legacy templates behave exactly as before.
//   - Class-scoped items (measurement_scope='class' with surface_classes set) that
//     hit a missing class become status='unresolved', reason_code='missing_class_measurement'
//     OR 'global_only_import'. They DO NOT silently use the global total.

import { buildScopedContext } from "./context.ts";
import { evaluateFormula, MissingClassMeasurementError } from "./formula.ts";
import type {
  Assignment,
  AssignmentStatus,
  MappingResult,
  MeasurementFeature,
  MeasurementSegment,
  ScopedContext,
  SurfaceClass,
  TemplateItemRule,
  TemplateSectionRule,
} from "./types.ts";

interface TemplateGroupRow {
  id: string;
  name: string;
  group_type: string | null;
  sort_order: number | null;
}

interface TemplateItemRow {
  id: string;
  group_id: string;
  item_name: string;
  unit: string | null;
  qty_formula: string | null;
  measurement_type: string | null;
}

export interface MapperInputs {
  measurement_import_id: string;
  calc_template_id: string;
  segments: MeasurementSegment[];
  features: MeasurementFeature[];
  groups: TemplateGroupRow[];
  items: TemplateItemRow[];
  section_rules: TemplateSectionRule[]; // keyed by group_id
  item_rules: TemplateItemRule[];       // keyed by item_id
}

const DEFAULT_ITEM_RULE: Omit<TemplateItemRule, "id" | "item_id"> = {
  surface_classes: [],
  feature_types: [],
  measurement_scope: "global",
  allow_global_fallback: true,
  allow_unknown: true,
  min_confidence: 0,
  exclusive_group: null,
};

function pickItemRule(itemId: string, rules: TemplateItemRule[]): TemplateItemRule {
  const r = rules.find((x) => x.item_id === itemId);
  if (r) return r;
  return { id: `default:${itemId}`, item_id: itemId, ...DEFAULT_ITEM_RULE };
}

function pickSectionRule(groupId: string, rules: TemplateSectionRule[]): TemplateSectionRule | null {
  return rules.find((x) => x.group_id === groupId) ?? null;
}

function matchSectionForSegment(
  seg: MeasurementSegment,
  rule: TemplateSectionRule | null,
): boolean {
  if (!rule) return true;
  if (rule.surface_classes.length === 0) return true;
  if (seg.surface_class === "unknown" && !rule.allow_unknown) return false;
  if (!rule.surface_classes.includes(seg.surface_class)) return false;
  if (rule.min_pitch != null && (seg.pitch_rise_over_12 ?? 0) < rule.min_pitch) return false;
  if (rule.max_pitch != null && (seg.pitch_rise_over_12 ?? 0) > rule.max_pitch) return false;
  return true;
}

function matchItemForSegment(seg: MeasurementSegment, rule: TemplateItemRule): boolean {
  if (rule.surface_classes.length === 0) return true;
  if (seg.surface_class === "unknown" && !rule.allow_unknown) return false;
  return rule.surface_classes.includes(seg.surface_class);
}

function matchItemForFeature(f: MeasurementFeature, rule: TemplateItemRule): boolean {
  if (rule.feature_types.length === 0) return false;
  return rule.feature_types.includes(f.feature_type);
}

function aggregateConfidence(segs: MeasurementSegment[], feats: MeasurementFeature[]): number {
  const all = [
    ...segs.map((s) => Number(s.classification_confidence ?? 0)),
    ...feats.map((f) => Number(f.confidence ?? 0)),
  ];
  if (all.length === 0) return 0;
  return all.reduce((a, b) => a + b, 0) / all.length;
}

export function mapMeasurementsToTemplate(input: MapperInputs): MappingResult {
  const ctx: ScopedContext = buildScopedContext(input.segments, input.features);

  const assignments: Assignment[] = [];
  const unresolved: Assignment[] = [];
  const conflicts: Assignment[] = [];

  const groupsById = new Map(input.groups.map((g) => [g.id, g]));
  const itemsByGroup = new Map<string, TemplateItemRow[]>();
  for (const item of input.items) {
    const arr = itemsByGroup.get(item.group_id) ?? [];
    arr.push(item);
    itemsByGroup.set(item.group_id, arr);
  }

  let assignedCount = 0;
  let unresolvedCount = 0;
  let conflictCount = 0;
  let skippedCount = 0;

  for (const group of input.groups) {
    const sectionRule = pickSectionRule(group.id, input.section_rules);
    const candidateSegments = input.segments
      .filter((s) => s.archived_at == null)
      .filter((s) => matchSectionForSegment(s, sectionRule));

    const items = itemsByGroup.get(group.id) ?? [];
    for (const item of items) {
      const itemRule = pickItemRule(item.id, input.item_rules);
      const formula = item.qty_formula?.trim() || "0";

      const matchedSegments = candidateSegments.filter((s) => matchItemForSegment(s, itemRule));
      const matchedFeatures = input.features
        .filter((f) => f.archived_at == null)
        .filter((f) => matchItemForFeature(f, itemRule));

      // Class-scoped item with no class evidence at all -> unresolved (global_only_import).
      if (itemRule.measurement_scope === "class" && itemRule.surface_classes.length > 0) {
        const anyClassAvailable = itemRule.surface_classes.some((c) => {
          const bucket = ctx.class[c as SurfaceClass];
          return bucket && bucket.segment_count > 0;
        });
        if (!anyClassAvailable && !itemRule.allow_global_fallback) {
          unresolvedCount += 1;
          unresolved.push({
            template_group_id: group.id,
            template_item_id: item.id,
            segment_ids: [],
            feature_ids: [],
            quantity: null,
            unit: item.unit,
            formula_evaluated: formula,
            confidence: 0,
            status: "unresolved",
            reason_code: ctx.meta.aggregate_only ? "global_only_import" : "missing_class_measurement",
            matched_by: {
              scope: "class",
              required_classes: itemRule.surface_classes,
              aggregate_only: ctx.meta.aggregate_only,
            },
          });
          continue;
        }
      }

      // Evaluate formula in scoped context.
      let quantity: number | null = null;
      let reasonCode: Assignment["reason_code"] = null;
      let status: Assignment["status"] = "assigned";
      try {
        const { value } = evaluateFormula(formula, ctx);
        quantity = value;
      } catch (err) {
        if (err instanceof MissingClassMeasurementError) {
          status = "unresolved";
          reasonCode = "missing_class_measurement";
        } else {
          status = "unresolved";
          reasonCode = "formula_error";
        }
      }

      const confidence = aggregateConfidence(matchedSegments, matchedFeatures);
      if (status === "assigned" && confidence > 0 && confidence < itemRule.min_confidence) {
        status = "unresolved";
        reasonCode = "low_confidence";
      }

      // Tag global-scope items running against aggregate-only imports so callers
      // can show "used global total, no class evidence" in the UI/audit.
      if (
        status === "assigned" &&
        itemRule.measurement_scope === "global" &&
        ctx.meta.aggregate_only
      ) {
        status = "assigned_global_fallback";
        reasonCode = "global_fallback";
      }

      // Surface manual-split provenance when the segments feeding this item are
      // synthetic-reviewed (came from POST /manual-split).
      const fromManualSplit =
        matchedSegments.length > 0 &&
        matchedSegments.every((s) => s.is_synthetic_split && s.reviewed);
      if (status === "assigned" && fromManualSplit) {
        reasonCode = "manual_split";
      }

      const a: Assignment = {
        template_group_id: group.id,
        template_item_id: item.id,
        segment_ids: matchedSegments.map((s) => s.id),
        feature_ids: matchedFeatures.map((f) => f.id),
        quantity: quantity == null ? null : Math.round(quantity * 1000) / 1000,
        unit: item.unit,
        formula_evaluated: formula,
        confidence,
        status,
        reason_code: reasonCode,
        matched_by: {
          scope: itemRule.measurement_scope,
          surface_classes: itemRule.surface_classes,
          feature_types: itemRule.feature_types,
          section_rule_applied: sectionRule?.id ?? null,
          item_rule_applied: itemRule.id.startsWith("default:") ? "default_global" : itemRule.id,
          manual_split: fromManualSplit,
          aggregate_only: ctx.meta.aggregate_only,
        },
      };

      const finalStatus: AssignmentStatus = status;
      if (finalStatus === "assigned" || finalStatus === "assigned_global_fallback") {
        assignedCount += 1;
        assignments.push(a);
      } else if (finalStatus === "conflict") {
        conflictCount += 1;
        conflicts.push(a);
      } else if (finalStatus === "skipped") {
        skippedCount += 1;
      } else {
        unresolvedCount += 1;
        unresolved.push(a);
      }
    }
    // Silence unused-var warning for groupsById; reserved for future cross-group conflict checks.
    void groupsById;
  }

  return {
    measurement_import_id: input.measurement_import_id,
    calc_template_id: input.calc_template_id,
    assignments,
    unresolved,
    conflicts,
    summary: {
      total_items: input.items.length,
      assigned: assignedCount,
      unresolved: unresolvedCount,
      conflicts: conflictCount,
      skipped: skippedCount,
    },
  };
}
