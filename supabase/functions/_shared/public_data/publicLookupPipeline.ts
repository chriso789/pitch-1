// supabase/functions/_shared/public_data/publicLookupPipeline.ts

import { CountyContext, NormalizedLocation, PublicPropertyResult } from "./types.ts";
import { pickAppraiser, pickTax, pickClerk } from "./registry.ts";
import { scoreConfidence } from "./score.ts";
import { mergeResults } from "./merge.ts";
import { batchLeadsFallback } from "./sources/batchleads/fallback.ts";

export async function lookupPropertyPublic(input: {
  loc: NormalizedLocation;
  county: CountyContext;
  includeTax: boolean;
  includeClerk: boolean;
  timeoutMs: number;
}): Promise<PublicPropertyResult> {
  const { loc, county, includeTax, includeClerk, timeoutMs } = input;

  const sources: Record<string, any> = {};
  const raw: Record<string, any> = {};

  // 1) Property Appraiser
  const appraiser = pickAppraiser(county);
  const appraiserRes = appraiser
    ? await appraiser.lookupByAddress({ loc, county, timeoutMs }).catch((e) => {
        raw.appraiser_error = String(e);
        return null;
      })
    : null;
  sources.appraiser = appraiser ? appraiser.id : null;
  raw.appraiser = appraiserRes ?? null;

  // 2) Tax Collector
  const tax = includeTax ? pickTax(county) : null;
  const taxRes = tax
    ? await tax.lookup({ loc, county, parcel_id: appraiserRes?.parcel_id, timeoutMs }).catch((e) => {
        raw.tax_error = String(e);
        return null;
      })
    : null;
  sources.tax = tax ? tax.id : null;
  raw.tax = taxRes ?? null;

  // 3) Clerk (deeds/mortgages)
  const clerk = includeClerk ? pickClerk(county) : null;
  const clerkRes = clerk
    ? await clerk.lookup({
        loc,
        county,
        owner_name: appraiserRes?.owner_name ?? taxRes?.owner_name,
        parcel_id: appraiserRes?.parcel_id ?? taxRes?.parcel_id,
        timeoutMs,
      }).catch((e) => {
        raw.clerk_error = String(e);
        return null;
      })
    : null;
  sources.clerk = clerk ? clerk.id : null;
  raw.clerk = clerkRes ?? null;

  // 4) Merge + initial confidence
  let merged = mergeResults(loc, [appraiserRes, taxRes, clerkRes]);
  let confidence = scoreConfidence({ loc, merged, appraiserRes, taxRes, clerkRes });

  // 5) BatchLeads fallback (only when confidence < 70 or missing critical fields)
  let batchRes: Partial<PublicPropertyResult> | null = null;
  let usedBatchleads = false;

  if (confidence < 70 || !merged.owner_name || !merged.owner_mailing_address) {
    batchRes = await batchLeadsFallback({ loc, timeoutMs }).catch((e) => {
      raw.batchleads_error = String(e);
      return null;
    });

    if (batchRes) {
      usedBatchleads = true;
      sources.batchleads = true;
      raw.batchleads = batchRes;

      // Re-merge with batchleads (lowest priority — won't overwrite existing)
      merged = mergeResults(loc, [appraiserRes, taxRes, clerkRes, batchRes]);

      // Check if only batchleads provided owner
      const onlyBatchleadsProvidedOwner =
        !appraiserRes?.owner_name && !taxRes?.owner_name && !clerkRes?.owner_name && !!batchRes.owner_name;

      confidence = scoreConfidence({
        loc,
        merged,
        appraiserRes,
        taxRes,
        clerkRes,
        batchleadsRes: batchRes,
        onlyBatchleadsProvidedOwner,
      });
    }
  }

  return {
    normalized_address_key: loc.normalized_address_key,
    property_address: merged.property_address ?? loc.normalized_address,
    ...merged,
    confidence_score: confidence,
    sources: { ...sources, used_batchleads: usedBatchleads },
    raw,
  };
}
