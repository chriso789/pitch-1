import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveLocation } from "../_shared/public_data/locationResolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { tenant_id, user_id, lat, lng, label, run_enrichment = true, timeout_ms = 15000 } = body;

    if (!tenant_id || !user_id || typeof lat !== "number" || typeof lng !== "number") {
      return new Response(JSON.stringify({ error: "tenant_id, user_id, lat, lng required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const loc = await resolveLocation({ lat, lng, timeoutMs: timeout_ms });

    const insertRow: Record<string, unknown> = {
      tenant_id,
      lat: loc.lat,
      lng: loc.lng,
      normalized_address_key: loc.normalized_address_key,
      address: {
        street: loc.street,
        city: loc.city,
        state: loc.state,
        zip: loc.zip,
        formatted: loc.normalized_address,
      },
      manual_pin: true,
      created_by: user_id,
      source: "manual_pin",
    };

    const { data: saved, error } = await supabase
      .from("canvassiq_properties")
      .upsert(insertRow, { onConflict: "tenant_id,normalized_address_key" })
      .select()
      .single();

    if (error) {
      console.error("Insert error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Optional enrichment (fire-and-forget)
    if (run_enrichment) {
      supabase.functions.invoke("storm-public-lookup", {
        body: { tenant_id, lat: loc.lat, lng: loc.lng, address: loc.normalized_address, timeout_ms },
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, property: saved, location: loc }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("canvass-drop-pin error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
