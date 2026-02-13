// supabase/functions/storm-intel-batch-score/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { tenant_id, storm_event_id, concurrency = 6, limit = 500 } = body;

    if (!tenant_id || !storm_event_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id and storm_event_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch properties for this storm
    const { data: properties } = await supabase
      .from("storm_properties_public")
      .select("normalized_address_key")
      .eq("tenant_id", tenant_id)
      .eq("storm_event_id", storm_event_id)
      .limit(Math.min(limit, 1000));

    if (!properties?.length) {
      return new Response(
        JSON.stringify({ success: true, scored: 0, message: "No properties found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Process with controlled concurrency
    const keys = properties.map((p) => p.normalized_address_key);
    let scored = 0;
    let errors = 0;

    const conc = Math.max(1, Math.min(10, concurrency));

    for (let i = 0; i < keys.length; i += conc) {
      const batch = keys.slice(i, i + conc);
      const results = await Promise.allSettled(
        batch.map((key) =>
          fetch(`${supabaseUrl}/functions/v1/storm-intel-score`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ tenant_id, storm_event_id, normalized_address_key: key }),
          }).then((r) => {
            if (r.ok) scored++;
            else errors++;
          })
        ),
      );

      // Count rejected promises as errors
      for (const r of results) {
        if (r.status === "rejected") errors++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, total: keys.length, scored, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[storm-intel-batch-score] error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
