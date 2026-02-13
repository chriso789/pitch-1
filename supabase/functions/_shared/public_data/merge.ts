// supabase/functions/_shared/public_data/merge.ts

import { NormalizedLocation, PublicPropertyResult } from "./types.ts";

/**
 * Priority-ordered merge: appraiser > tax > clerk > batchleads.
 * Never overwrites a field that already has a value from a higher-priority source.
 */
export function mergeResults(
  loc: NormalizedLocation,
  parts: Array<Partial<PublicPropertyResult> | null>,
): Partial<PublicPropertyResult> {
  const out: Partial<PublicPropertyResult> = {
    property_address: loc.normalized_address,
    normalized_address_key: loc.normalized_address_key,
  };

  for (const p of parts) {
    if (!p) continue;
    if (!out.parcel_id && p.parcel_id) out.parcel_id = p.parcel_id;
    if (!out.owner_name && p.owner_name) out.owner_name = p.owner_name;
    if (!out.owner_mailing_address && p.owner_mailing_address) out.owner_mailing_address = p.owner_mailing_address;
    if (!out.living_sqft && p.living_sqft) out.living_sqft = p.living_sqft;
    if (!out.year_built && p.year_built) out.year_built = p.year_built;
    if (!out.lot_size && p.lot_size) out.lot_size = p.lot_size;
    if (!out.land_use && p.land_use) out.land_use = p.land_use;
    if (!out.last_sale_date && p.last_sale_date) out.last_sale_date = p.last_sale_date;
    if (!out.last_sale_amount && p.last_sale_amount) out.last_sale_amount = p.last_sale_amount;
    if (out.homestead === undefined && p.homestead !== undefined) out.homestead = p.homestead;
    if (!out.mortgage_lender && p.mortgage_lender) out.mortgage_lender = p.mortgage_lender;
    if (!out.assessed_value && p.assessed_value) out.assessed_value = p.assessed_value;
  }

  return out;
}
