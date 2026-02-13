import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { tenant_id, area_id, cell_size_deg = 0.005 } = await req.json();

    if (!tenant_id || !area_id) {
      return new Response(JSON.stringify({ error: "tenant_id and area_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load all area properties
    const { data: areaProps, error: apErr } = await supabase
      .from("canvass_area_properties")
      .select("property_id, lat, lng")
      .eq("tenant_id", tenant_id)
      .eq("area_id", area_id);

    if (apErr) throw apErr;
    if (!areaProps?.length) {
      return new Response(JSON.stringify({ cell_count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load visited property IDs
    const propertyIds = areaProps.map(p => p.property_id);
    const visitedSet = new Set<string>();

    // Chunked query for visits
    const CHUNK = 500;
    for (let i = 0; i < propertyIds.length; i += CHUNK) {
      const chunk = propertyIds.slice(i, i + CHUNK);
      const { data: visits } = await supabase
        .from("canvassiq_visits")
        .select("property_id")
        .eq("tenant_id", tenant_id)
        .in("property_id", chunk);
      if (visits) visits.forEach(v => visitedSet.add(v.property_id));
    }

    // Bucket into grid cells
    const cells = new Map<string, { lat: number; lng: number; total: number; contacted: number }>();

    for (const prop of areaProps) {
      if (!prop.lat || !prop.lng) continue;
      const cellLat = Math.floor(prop.lat / cell_size_deg) * cell_size_deg;
      const cellLng = Math.floor(prop.lng / cell_size_deg) * cell_size_deg;
      const key = `${cellLat.toFixed(4)}_${cellLng.toFixed(4)}`;

      if (!cells.has(key)) {
        cells.set(key, {
          lat: cellLat + cell_size_deg / 2,
          lng: cellLng + cell_size_deg / 2,
          total: 0,
          contacted: 0,
        });
      }
      const cell = cells.get(key)!;
      cell.total++;
      if (visitedSet.has(prop.property_id)) cell.contacted++;
    }

    // Upsert cells
    const rows = Array.from(cells.entries()).map(([key, cell]) => ({
      tenant_id,
      area_id,
      cell_key: key,
      center_lat: cell.lat,
      center_lng: cell.lng,
      total_properties: cell.total,
      contacted_properties: cell.contacted,
      uncontacted_properties: cell.total - cell.contacted,
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error: upsertErr } = await supabase
        .from("canvass_area_heat_cells")
        .upsert(rows, { onConflict: "tenant_id,area_id,cell_key" });
      if (upsertErr) throw upsertErr;
    }

    return new Response(JSON.stringify({ cell_count: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("canvass-area-build-heatmap error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
