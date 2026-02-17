// supabase/functions/dnc-scrub/index.ts
// DNC scrubbing edge function — checks cache, scrubs missing, upserts results

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { scrubPhonesMock } from "../_shared/dnc/providers/mockProvider.ts";
import type { DNCScrubRequest, DNCScrubResponse } from "../_shared/types/contracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json()) as DNCScrubRequest;
    const { tenant_id, phones_e164 } = body;
    if (!tenant_id || !phones_e164?.length) {
      return new Response(
        JSON.stringify({ error: "tenant_id and phones_e164[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1) Pull cached scrubs (TTL: 31 days)
    const { data: cached } = await supabase
      .from("dnc_scrub_results")
      .select("phone_e164,is_dnc,is_wireless,scrubbed_at,source")
      .eq("tenant_id", tenant_id)
      .in("phone_e164", phones_e164);

    const now = Date.now();
    const freshMap: Record<string, { is_dnc: boolean | null; is_wireless: boolean | null; source?: string }> = {};
    const needs: string[] = [];

    for (const p of phones_e164) {
      const row = (cached || []).find((x: any) => x.phone_e164 === p);
      if (!row) {
        needs.push(p);
        continue;
      }
      const ageDays = (now - new Date(row.scrubbed_at).getTime()) / (24 * 3600 * 1000);
      if (ageDays <= 31) {
        freshMap[p] = { is_dnc: row.is_dnc, is_wireless: row.is_wireless, source: row.source };
      } else {
        needs.push(p);
      }
    }

    // 2) Scrub missing/stale — swap to scrubPhonesHttp when ready
    let newMap: Record<string, { is_dnc: boolean | null; is_wireless: boolean | null; source?: string }> = {};
    if (needs.length) {
      newMap = await scrubPhonesMock(needs);

      // 3) Upsert results
      const rows = Object.entries(newMap).map(([phone_e164, r]) => ({
        tenant_id,
        phone_e164,
        is_dnc: r.is_dnc ?? null,
        is_wireless: r.is_wireless ?? null,
        source: r.source ?? "unknown",
        raw: r,
        scrubbed_at: new Date().toISOString(),
      }));

      if (rows.length) {
        await supabase
          .from("dnc_scrub_results")
          .upsert(rows, { onConflict: "tenant_id,phone_e164" });
      }
    }

    const results = { ...freshMap, ...newMap };
    const resp: DNCScrubResponse = { success: true, results };

    return new Response(JSON.stringify(resp), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[dnc-scrub] Error:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
