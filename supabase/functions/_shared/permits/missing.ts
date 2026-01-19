// =========================================================
// Missing Items Detection
// =========================================================

import { MissingItem, MissingSeverity } from "./types.ts";

export { MissingSeverity };
export type { MissingItem };

export function mergeMissing(a: MissingItem[], b: MissingItem[]): MissingItem[] {
  const map = new Map<string, MissingItem>();
  for (const item of [...a, ...b]) {
    if (!map.has(item.key)) map.set(item.key, item);
  }
  return [...map.values()];
}

export function missingFromContext(ctx: any): MissingItem[] {
  const out: MissingItem[] = [];

  // Job address + geo
  if (!ctx?.job?.address?.full) {
    out.push(mi("missing.job_address", "error", "Job address is missing."));
  }
  if (ctx?.job?.geo?.lat == null || ctx?.job?.geo?.lng == null) {
    out.push(mi("missing.job_geo", "warning", "Job geocode (lat/lng) is missing."));
  }

  // Owner name
  const ownerName = ctx?.parcel?.owner_name ?? ctx?.contacts?.owner?.full_name ?? null;
  if (!ownerName) {
    out.push(mi("missing.owner_name", "error", "Owner name is missing."));
  }

  // Parcel legal
  if (!ctx?.parcel?.legal_description) {
    out.push(mi("missing.parcel_legal_description", "warning", "Legal description missing."));
  }

  // Parcel ID
  if (!ctx?.parcel?.parcel_id && !ctx?.parcel?.folio) {
    out.push(mi("missing.parcel_id", "warning", "Parcel ID/Folio missing."));
  }

  // Measurements
  if (!ctx?.measurements?.total_roof_area_sqft) {
    out.push(mi("missing.measurements_total_roof_area", "error", "Missing total roof area measurements."));
  }
  if (!ctx?.measurements?.report?.bucket || !ctx?.measurements?.report?.path) {
    out.push(mi("missing.measurements_report", "warning", "Missing measurement report attachment."));
  }

  // Estimate
  if (!ctx?.estimate?.id) {
    out.push(mi("missing.estimate_selected", "warning", "No estimate selected."));
  }

  // Products
  if (!ctx?.products?.primary?.product_id) {
    out.push(mi("missing.product_mapping_primary", "error", "Primary product not mapped."));
  }

  return out;
}

function mi(key: string, severity: MissingSeverity, message: string): MissingItem {
  return { key, severity, message };
}
