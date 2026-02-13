// supabase/functions/_shared/public_data/score.ts

import { NormalizedLocation, PublicPropertyResult } from "./types.ts";

export function scoreConfidence(args: {
  loc: NormalizedLocation;
  merged: Partial<PublicPropertyResult>;
  appraiserRes: Partial<PublicPropertyResult> | null;
  taxRes: Partial<PublicPropertyResult> | null;
  clerkRes: Partial<PublicPropertyResult> | null;
  batchleadsRes?: Partial<PublicPropertyResult> | null;
  onlyBatchleadsProvidedOwner?: boolean;
}): number {
  const { merged, appraiserRes, taxRes, clerkRes, batchleadsRes, onlyBatchleadsProvidedOwner } = args;

  let score = 0;

  // +40 appraiser data
  if (appraiserRes && (appraiserRes.owner_name || appraiserRes.parcel_id)) score += 40;

  // +20 tax match
  if (taxRes && (taxRes.owner_name || taxRes.homestead !== undefined)) score += 20;

  // +15 clerk enrichment
  if (clerkRes && (clerkRes.last_sale_date || clerkRes.mortgage_lender)) score += 15;

  // +10 owner found
  if (merged.owner_name) score += 10;

  // +10 parcel found
  if (merged.parcel_id) score += 10;

  // +5 cross-source owner match
  if (appraiserRes?.owner_name && taxRes?.owner_name) {
    if (normalizeName(appraiserRes.owner_name) === normalizeName(taxRes.owner_name)) {
      score += 5;
    }
  }

  // +5 mortgage lender
  if (clerkRes?.mortgage_lender || batchleadsRes?.mortgage_lender) score += 5;

  // +5 owner + mailing present
  if (merged.owner_name && merged.owner_mailing_address) score += 5;

  // Cap at 85 if only BatchLeads provided owner (no public appraiser confirmation)
  if (onlyBatchleadsProvidedOwner && score > 85) {
    score = 85;
  }

  return Math.max(0, Math.min(100, score));
}

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}
