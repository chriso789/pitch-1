// supabase/functions/canvass-area-build-membership/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Ray-casting point-in-polygon
function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0]; // GeoJSON is [lng, lat]
    const xj = polygon[j][1], yj = polygon[j][0];
    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { tenant_id, area_id } = await req.json();

    if (!tenant_id || !area_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id and area_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load the area polygon
    const { data: area, error: areaErr } = await supabase
      .from("canvass_areas")
      .select("polygon_geojson")
      .eq("id", area_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (areaErr || !area) {
      return new Response(
        JSON.stringify({ error: "Area not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Extract coordinates from GeoJSON (support Polygon geometry or Feature)
    const geojson = area.polygon_geojson;
    const coords: number[][] = geojson?.coordinates?.[0] ||
      geojson?.geometry?.coordinates?.[0] || [];

    if (coords.length < 3) {
      return new Response(
        JSON.stringify({ error: "Invalid polygon (< 3 vertices)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Compute bounding box from polygon
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const c of coords) {
      const lng = c[0], lat = c[1];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }

    // Query candidates within bbox from canvassiq_properties
    const { data: candidates, error: queryErr } = await supabase
      .from("canvassiq_properties")
      .select("id, lat, lng")
      .eq("tenant_id", tenant_id)
      .gte("lat", minLat)
      .lte("lat", maxLat)
      .gte("lng", minLng)
      .lte("lng", maxLng)
      .limit(5000);

    if (queryErr) {
      console.error("[canvass-area-build-membership] query error", queryErr);
      return new Response(
        JSON.stringify({ error: "Failed to query properties" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Filter by point-in-polygon
    const members = (candidates || []).filter(
      (p: any) => p.lat != null && p.lng != null && pointInPolygon(p.lat, p.lng, coords)
    );

    // Batch upsert membership rows
    if (members.length > 0) {
      const rows = members.map((p: any) => ({
        tenant_id,
        area_id,
        property_id: p.id,
        lat: p.lat,
        lng: p.lng,
      }));

      // Upsert in chunks of 500
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        await supabase
          .from("canvass_area_properties")
          .upsert(chunk, { onConflict: "tenant_id,area_id,property_id" });
      }
    }

    return new Response(
      JSON.stringify({ success: true, inserted: members.length, total_in_area: members.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[canvass-area-build-membership] error", e);
    return new Response(
      JSON.stringify({ error: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
