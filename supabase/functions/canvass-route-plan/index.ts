// supabase/functions/canvass-route-plan/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { haversineMeters } from "../_shared/routing/haversine.ts";
import { planRoute } from "../_shared/routing/routePlanner.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { tenant_id, storm_event_id, user_id, start_lat, start_lng } = body;
    const take = Math.min(200, body.take ?? 80);
    const minP = body.min_priority ?? 60;

    if (!tenant_id || !storm_event_id || start_lat == null || start_lng == null) {
      return new Response(
        JSON.stringify({ error: "tenant_id, storm_event_id, start_lat, start_lng required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: intelRows } = await supabase
      .from("storm_property_intel")
      .select("normalized_address_key, priority_score, property_snapshot")
      .eq("tenant_id", tenant_id)
      .eq("storm_event_id", storm_event_id)
      .gte("priority_score", minP)
      .order("priority_score", { ascending: false })
      .limit(take);

    const stops = (intelRows ?? [])
      .map((r: any) => ({
        key: r.normalized_address_key,
        priority: r.priority_score,
        address: r.property_snapshot?.property_address,
        lat: r.property_snapshot?.lat,
        lng: r.property_snapshot?.lng,
      }))
      .filter((s: any) => typeof s.lat === "number" && typeof s.lng === "number");

    const plan = planRoute({ start: { lat: start_lat, lng: start_lng }, stops });

    // Calculate total distance
    let dist = 0;
    let prev = { lat: start_lat, lng: start_lng };
    for (const s of plan.orderedStops) {
      dist += haversineMeters(prev.lat, prev.lng, s.lat, s.lng);
      prev = s;
    }

    const routeRow = {
      tenant_id,
      storm_event_id,
      user_id: user_id ?? null,
      name: `Storm route (${new Date().toISOString().slice(0, 10)})`,
      start_lat,
      start_lng,
      planned_stops: plan.orderedStops,
      metrics: {
        total_stops: plan.orderedStops.length,
        total_distance_miles: dist / 1609.344,
        algo: plan.meta,
      },
    };

    const { data: saved } = await supabase.from("canvass_routes").insert(routeRow).select().single();

    return new Response(
      JSON.stringify({ success: true, route: saved ?? routeRow }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[canvass-route-plan] error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
