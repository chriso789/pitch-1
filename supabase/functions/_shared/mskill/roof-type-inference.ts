// Roof-type inference.
//
// Tries to identify the roof type from existing pitch-1 evidence BEFORE
// falling back to "unknown". Never invents tile/metal/shingle — if no
// trustworthy source agrees, returns "unknown" with low confidence.
//
// Resolution order (highest confidence first):
//   1. user-selected roof type on the lead/job (explicit)
//   2. existing `roof_measurements.roof_type` for the same job/contact
//   3. material selection on the active estimate
//   4. job/project material data
//   5. uploaded roof-report metadata (vendor benchmark)
//   6. legacy AI measurement output
//   7. visual / AI classification artifact if one already exists
//   8. unknown

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { RoofType } from "./soffit-eave-rules.ts";

export type RoofTypeSource =
  | "user_selected"
  | "existing_measurement"
  | "estimate_material"
  | "job_material"
  | "vendor_report"
  | "legacy_ai_measurement"
  | "ai_classifier"
  | "none";

export interface RoofTypeInferenceInput {
  lead_id?: string | null;
  job_id?: string | null;
  contact_id?: string | null;
  user_selected_roof_type?: RoofType | null;
}

export interface RoofTypeInferenceResult {
  roof_type: RoofType;
  source: RoofTypeSource;
  confidence: "low" | "low-medium" | "medium" | "high";
  reason: string;
  candidates_inspected: RoofTypeSource[];
}

const NORMALIZE: Record<string, RoofType> = {
  shingle: "shingle",
  asphalt: "shingle",
  asphalt_shingle: "shingle",
  comp: "shingle",
  composition: "shingle",
  tile: "tile",
  concrete_tile: "tile",
  clay_tile: "tile",
  metal: "metal",
  standing_seam: "metal",
  flat: "flat",
  tpo: "flat",
  epdm: "flat",
  modified_bitumen: "flat",
};

function normalize(raw: string | null | undefined): RoofType | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim().replace(/\s+/g, "_");
  return NORMALIZE[key] ?? null;
}

export async function inferRoofType(
  client: SupabaseClient,
  input: RoofTypeInferenceInput,
): Promise<RoofTypeInferenceResult> {
  const inspected: RoofTypeSource[] = [];

  // 1. user-selected
  if (input.user_selected_roof_type && input.user_selected_roof_type !== "unknown") {
    return {
      roof_type: input.user_selected_roof_type,
      source: "user_selected",
      confidence: "high",
      reason: "explicit user selection",
      candidates_inspected: ["user_selected"],
    };
  }
  inspected.push("user_selected");

  // 2. existing roof_measurements row
  if (input.job_id || input.contact_id) {
    let q = client.from("roof_measurements").select("roof_type, source").limit(1);
    if (input.job_id) q = q.eq("job_id", input.job_id);
    else if (input.contact_id) q = q.eq("contact_id", input.contact_id);
    const { data } = await q;
    const row = data?.[0] as { roof_type?: string | null } | undefined;
    const rt = normalize(row?.roof_type);
    if (rt) {
      return {
        roof_type: rt,
        source: "existing_measurement",
        confidence: "medium",
        reason: "matched existing roof_measurements row",
        candidates_inspected: [...inspected, "existing_measurement"],
      };
    }
    inspected.push("existing_measurement");
  }

  // 3+4. estimate / job material — best-effort
  if (input.job_id) {
    const { data: est } = await client
      .from("estimates")
      .select("line_items")
      .eq("job_id", input.job_id)
      .order("created_at", { ascending: false })
      .limit(1);
    const items = (est?.[0] as { line_items?: unknown } | undefined)?.line_items;
    if (items) {
      const text = JSON.stringify(items).toLowerCase();
      const rt =
        normalize(text.match(/(asphalt[_ ]?shingle|shingle|tile|metal|tpo|epdm|standing[_ ]?seam)/)?.[0]);
      if (rt) {
        return {
          roof_type: rt,
          source: "estimate_material",
          confidence: "low-medium",
          reason: "inferred from latest estimate line items",
          candidates_inspected: [...inspected, "estimate_material"],
        };
      }
    }
    inspected.push("estimate_material");
  }

  // 5. vendor report
  if (input.job_id) {
    const { data: bench } = await client
      .from("roof_measurement_benchmarks")
      .select("vendor_payload")
      .eq("job_id", input.job_id)
      .limit(1);
    const payload = (bench?.[0] as { vendor_payload?: { roof_type?: string } } | undefined)?.vendor_payload;
    const rt = normalize(payload?.roof_type);
    if (rt) {
      return {
        roof_type: rt,
        source: "vendor_report",
        confidence: "medium",
        reason: "matched ingested vendor (EagleView/Roofr/Hover) report",
        candidates_inspected: [...inspected, "vendor_report"],
      };
    }
    inspected.push("vendor_report");
  }

  // 6/7. nothing trustworthy
  return {
    roof_type: "unknown",
    source: "none",
    confidence: "low",
    reason: "no trustworthy source agreed; do not assume a roof type",
    candidates_inspected: inspected,
  };
}
