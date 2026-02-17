// supabase/functions/property-enrich-details/index.ts
// Main orchestrator: FCC geo → public cache → contact cache → DNC gate → scoring cache

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveLocation } from "../_shared/public_data/locationResolver.ts";
import { fccArea, normalizeCountyName } from "../_shared/geo/fccArea.ts";
import { getCountyContext } from "../_shared/public_data/countyResolver.ts";
import { lookupPropertyPublic } from "../_shared/public_data/publicLookupPipeline.ts";
import { computeScores } from "../_shared/scoring/index.ts";
import { applyDncGate } from "../_shared/dnc/gate.ts";
import { toE164US } from "../_shared/dnc/normalize.ts";
import { batchDataSkipTrace } from "../_shared/public_data/sources/batchdata/skipTrace.ts";
import type {
  PropertyEnrichDetailsRequest,
  PropertyEnrichDetailsResponse,
  PhoneCandidate,
} from "../_shared/types/contracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function ttlFresh(updatedAt: string, days: number): boolean {
  return Date.now() - new Date(updatedAt).getTime() < days * 24 * 3600 * 1000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json()) as PropertyEnrichDetailsRequest;
    const { tenant_id, include_contact = false, force_refresh = false } = body;

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.lat && !body.lng && !body.address) {
      return new Response(
        JSON.stringify({ error: "Provide lat/lng or address" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const timeoutMs = 15000;

    // 1) Resolve location
    const loc = await resolveLocation({
      lat: body.lat,
      lng: body.lng,
      address: body.address,
      timeoutMs,
    });

    // 2) FCC geo detect
    const geo = await fccArea(loc.lat, loc.lng).catch(() => ({} as any));
    const state = (geo.stateCode ?? loc.state ?? "").toUpperCase();
    const county = normalizeCountyName(geo.countyName ?? loc.county_hint ?? "");
    const county_fips = geo.countyFips ?? null;
    const state_fips = geo.stateFips ?? null;

    // 3) PUBLIC CACHE
    const { data: cachedPublic } = await supabase
      .from("public_property_cache")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("normalized_address_key", loc.normalized_address_key)
      .maybeSingle();

    const publicFresh = !!(
      cachedPublic && !force_refresh && ttlFresh(cachedPublic.updated_at, 30)
    );
    let publicRow: any = cachedPublic;

    if (!publicFresh) {
      // Use existing county resolver + pipeline
      const countyCtx = await getCountyContext({
        lat: loc.lat,
        lng: loc.lng,
        state: loc.state,
        county_hint: loc.county_hint,
        timeoutMs,
      });

      const result = await lookupPropertyPublic({
        loc,
        county: countyCtx,
        includeTax: true,
        includeClerk: true,
        timeoutMs,
        tenantId: tenant_id,
      });

      const upsertRow = {
        tenant_id,
        normalized_address_key: loc.normalized_address_key,
        state,
        county,
        county_fips,
        state_fips,
        parcel_id: result.parcel_id ?? null,
        owner_name: result.owner_name ?? null,
        mailing_address: result.owner_mailing_address ?? null,
        homestead: result.homestead ?? null,
        assessed_value: result.assessed_value ?? null,
        last_sale_date: result.last_sale_date && !isNaN(Date.parse(result.last_sale_date))
          ? result.last_sale_date
          : null,
        last_sale_amount: result.last_sale_amount ?? null,
        year_built: result.year_built ?? null,
        raw_county_payload: result.raw ?? null,
        source: Object.keys(result.sources || {}).filter((k) => result.sources[k]).join(",") || "pipeline",
        confidence_score: result.confidence_score ?? 0,
        updated_at: new Date().toISOString(),
      };

      const { data: saved } = await supabase
        .from("public_property_cache")
        .upsert(upsertRow, { onConflict: "tenant_id,normalized_address_key" })
        .select()
        .single();

      publicRow = saved ?? upsertRow;
    }

    // 4) CONTACT CACHE (only when requested)
    const { data: cachedContact } = await supabase
      .from("contact_enrichment_cache")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("normalized_address_key", loc.normalized_address_key)
      .maybeSingle();

    const contactFresh = !!(
      cachedContact && !force_refresh && ttlFresh(cachedContact.updated_at, 14)
    );
    let contactRow: any = cachedContact;

    if (include_contact && !contactFresh) {
      // Call BatchData skip trace
      const batch = await batchDataSkipTrace({
        street: loc.street || loc.normalized_address || "",
        city: loc.city || "",
        state: loc.state || state || "",
        zip: loc.zip || "",
        timeoutMs: 15000,
      });

      const toPhoneCandidates: PhoneCandidate[] = (batch?.phones || [])
        .map((p: any) => {
          const e164 = toE164US(p.number ?? "");
          if (!e164) return null;
          const ptype = (p.type || "unknown").toLowerCase();
          return {
            number_e164: e164,
            type: ptype === "mobile" || ptype === "landline" ? ptype : "unknown",
            raw: p,
          } as PhoneCandidate;
        })
        .filter(Boolean) as PhoneCandidate[];

      const upsertContact = {
        tenant_id,
        normalized_address_key: loc.normalized_address_key,
        owner_name: publicRow?.owner_name ?? null,
        phones: toPhoneCandidates,
        emails: (batch?.emails || []).map((e: string) => ({ address: e, type: "personal" })),
        relatives: batch?.relatives ?? [],
        age: batch?.age ?? null,
        batchdata_payload: batch?.raw ?? null,
        cost: 0.15,
        updated_at: new Date().toISOString(),
      };

      const { data: savedContact } = await supabase
        .from("contact_enrichment_cache")
        .upsert(upsertContact, { onConflict: "tenant_id,normalized_address_key" })
        .select()
        .single();

      contactRow = savedContact ?? upsertContact;
    }

    // 5) DNC GATE (annotate phones before returning)
    let gatedContact = null;
    if (contactRow?.phones?.length) {
      const phoneNums = (contactRow.phones as PhoneCandidate[]).map((p) => p.number_e164);

      const { data: dncCached } = await supabase
        .from("dnc_scrub_results")
        .select("phone_e164,is_dnc,is_wireless")
        .eq("tenant_id", tenant_id)
        .in("phone_e164", phoneNums);

      const dncMap: Record<string, { is_dnc: boolean | null; is_wireless: boolean | null }> = {};
      for (const r of (dncCached || []) as any[]) {
        dncMap[r.phone_e164] = { is_dnc: r.is_dnc ?? null, is_wireless: r.is_wireless ?? null };
      }

      const gatedPhones = applyDncGate(contactRow.phones, dncMap);

      gatedContact = {
        phones: gatedPhones,
        emails: contactRow.emails ?? [],
        age: contactRow.age ?? null,
        relatives: contactRow.relatives ?? [],
        cached: contactFresh,
      };
    } else if (contactRow) {
      gatedContact = {
        phones: [],
        emails: contactRow.emails ?? [],
        age: contactRow.age ?? null,
        relatives: contactRow.relatives ?? [],
        cached: contactFresh,
      };
    }

    // 6) SCORES CACHE
    const { data: cachedScores } = await supabase
      .from("property_scores_cache")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("normalized_address_key", loc.normalized_address_key)
      .maybeSingle();

    const scoresFresh = !!(
      cachedScores && !force_refresh && ttlFresh(cachedScores.updated_at, 7)
    );
    let scoresBlock: any = cachedScores;

    if (!scoresFresh) {
      const computed = computeScores({
        assessed_value: publicRow?.assessed_value ?? null,
        last_sale_date: publicRow?.last_sale_date ?? null,
        last_sale_amount: publicRow?.last_sale_amount ?? null,
        homestead: publicRow?.homestead ?? null,
        owner_name: publicRow?.owner_name ?? null,
        mailing_address: publicRow?.mailing_address ?? null,
        property_address: loc.normalized_address ?? loc.street ?? null,
        year_built: publicRow?.year_built ?? null,
      });

      const upsertScores = {
        tenant_id,
        normalized_address_key: loc.normalized_address_key,
        equity_score: computed.equity.score,
        equity_reasons: computed.equity.reasons,
        absentee_score: computed.absentee.score,
        absentee_reasons: computed.absentee.reasons,
        roof_age_score: computed.roof_age.score,
        roof_age_reasons: computed.roof_age.reasons,
        updated_at: new Date().toISOString(),
      };

      const { data: savedScores } = await supabase
        .from("property_scores_cache")
        .upsert(upsertScores, { onConflict: "tenant_id,normalized_address_key" })
        .select()
        .single();

      scoresBlock = savedScores ?? upsertScores;
    }

    const resp: PropertyEnrichDetailsResponse = {
      success: true,
      normalized_address_key: loc.normalized_address_key,
      geo: {
        state,
        county,
        state_fips: state_fips ?? undefined,
        county_fips: county_fips ?? undefined,
      },
      public: publicRow ?? null,
      contact: gatedContact,
      scores: {
        equity: { score: scoresBlock?.equity_score ?? 0, reasons: scoresBlock?.equity_reasons ?? [] },
        absentee: { score: scoresBlock?.absentee_score ?? 0, reasons: scoresBlock?.absentee_reasons ?? [] },
        roof_age: { score: scoresBlock?.roof_age_score ?? 0, reasons: scoresBlock?.roof_age_reasons ?? [] },
        cached: scoresFresh,
      },
      cached: { public: publicFresh, contact: contactFresh },
    };

    return new Response(JSON.stringify(resp), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[property-enrich-details] Error:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
