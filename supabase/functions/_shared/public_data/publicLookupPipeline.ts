// supabase/functions/_shared/public_data/publicLookupPipeline.ts

import { CountyContext, NormalizedLocation, PublicPropertyResult } from "./types.ts";
import { pickAppraiser, pickTax, pickClerk } from "./registry.ts";
import { scoreConfidence } from "./score.ts";
import { mergeResults } from "./merge.ts";
import { batchLeadsFallback } from "./sources/batchleads/fallback.ts";
import { peopleSearch, type PeopleSearchResult } from "./sources/universal/peopleSearch.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function normalize(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function isAbsentee(merged: Partial<PublicPropertyResult>) {
  if (!merged.owner_mailing_address || !merged.property_address) return false;
  return normalize(merged.owner_mailing_address) !== normalize(merged.property_address);
}

function isResidential(landUse?: string) {
  if (!landUse) return true; // assume residential if unknown
  const lu = landUse.toLowerCase();
  return lu.includes("resid") || lu.includes("single") || lu.includes("family") || lu.includes("condo") || lu.includes("town");
}

export async function lookupPropertyPublic(input: {
  loc: NormalizedLocation;
  county: CountyContext;
  includeTax: boolean;
  includeClerk: boolean;
  timeoutMs: number;
  stormEventId?: string;
  polygonId?: string;
  tenantId?: string;
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

  // 5) Smart BatchLeads fallback with cost controls
  let batchRes: Partial<PublicPropertyResult> | null = null;
  let usedBatchleads = false;

  const shouldFallback =
    (confidence < 70 || !merged.owner_name || !merged.owner_mailing_address) &&
    isResidential(merged.land_use) &&
    !(merged.homestead === true && confidence >= 60) &&
    (isAbsentee(merged) || !merged.owner_mailing_address);

  if (shouldFallback) {
    // Per-storm cap check (max 150 BatchLeads calls per storm)
    let withinCap = true;
    if (input.stormEventId && input.tenantId) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { count } = await supabase
          .from("batchleads_usage")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", input.tenantId)
          .eq("storm_event_id", input.stormEventId);
        withinCap = (count ?? 0) < 150;
      } catch { /* proceed if check fails */ }
    }

    if (withinCap) {
      batchRes = await batchLeadsFallback({ loc, timeoutMs }).catch((e) => {
        raw.batchleads_error = String(e);
        return null;
      });

      if (batchRes) {
        usedBatchleads = true;
        sources.batchleads = true;
        raw.batchleads = batchRes;

        // Log usage for cost tracking
        if (input.tenantId) {
          try {
            const supabase = createClient(
              Deno.env.get("SUPABASE_URL")!,
              Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            );
            await supabase.from("batchleads_usage").insert({
              tenant_id: input.tenantId,
              storm_event_id: input.stormEventId ?? "unknown",
              polygon_id: input.polygonId ?? null,
              normalized_address_key: loc.normalized_address_key,
              cost: 0.15,
            });
          } catch (e) {
            console.error("[batchleads_usage log error]", e);
          }
        }

        // Re-merge (lowest priority — won't overwrite existing)
        merged = mergeResults(loc, [appraiserRes, taxRes, clerkRes, batchRes]);

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
  }

  // 6) People search for contact info (free via Firecrawl)
  let contactData: PeopleSearchResult | null = null;
  if (merged.owner_name && merged.owner_name !== "Unknown" && merged.owner_name !== "Unknown Owner") {
    contactData = await peopleSearch({
      ownerName: merged.owner_name,
      city: loc.city,
      state: loc.state,
      timeoutMs,
    }).catch((e) => {
      raw.people_search_error = String(e);
      return null;
    });
    if (contactData) {
      sources.people_search = true;
      raw.people_search = contactData;
    }
  }

  return {
    normalized_address_key: loc.normalized_address_key,
    property_address: merged.property_address ?? loc.normalized_address,
    ...merged,
    contact_phones: contactData?.phones ?? [],
    contact_emails: contactData?.emails ?? [],
    contact_age: contactData?.age ?? null,
    contact_relatives: contactData?.relatives ?? [],
    confidence_score: confidence,
    sources: { ...sources, used_batchleads: usedBatchleads },
    raw,
  };
}
