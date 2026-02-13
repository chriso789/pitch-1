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

    const { tenant_id, area_id, user_ids } = await req.json();

    if (!tenant_id || !area_id || !Array.isArray(user_ids) || user_ids.length < 2) {
      return new Response(JSON.stringify({ error: "tenant_id, area_id, user_ids (>=2) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const k = user_ids.length;

    // Load area properties with coordinates
    const { data: props, error: pErr } = await supabase
      .from("canvass_area_properties")
      .select("property_id, lat, lng")
      .eq("tenant_id", tenant_id)
      .eq("area_id", area_id);

    if (pErr) throw pErr;
    if (!props?.length) {
      return new Response(JSON.stringify({ error: "No properties in area", counts: {} }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Simple k-means clustering
    const points = props.filter(p => p.lat && p.lng).map(p => ({
      id: p.property_id,
      lat: p.lat as number,
      lng: p.lng as number,
      cluster: 0,
    }));

    // Initialize centroids by picking evenly spaced points
    const sorted = [...points].sort((a, b) => a.lat - b.lat || a.lng - b.lng);
    const centroids: { lat: number; lng: number }[] = [];
    for (let i = 0; i < k; i++) {
      const idx = Math.floor((i / k) * sorted.length);
      centroids.push({ lat: sorted[idx].lat, lng: sorted[idx].lng });
    }

    // Run k-means (10 iterations max)
    for (let iter = 0; iter < 10; iter++) {
      // Assign points to nearest centroid
      for (const point of points) {
        let minDist = Infinity;
        let best = 0;
        for (let c = 0; c < k; c++) {
          const d = (point.lat - centroids[c].lat) ** 2 + (point.lng - centroids[c].lng) ** 2;
          if (d < minDist) { minDist = d; best = c; }
        }
        point.cluster = best;
      }

      // Update centroids
      for (let c = 0; c < k; c++) {
        const members = points.filter(p => p.cluster === c);
        if (members.length > 0) {
          centroids[c] = {
            lat: members.reduce((s, p) => s + p.lat, 0) / members.length,
            lng: members.reduce((s, p) => s + p.lng, 0) / members.length,
          };
        }
      }
    }

    // Balance clusters: swap edge points from largest to smallest
    const clusterSizes = Array.from({ length: k }, (_, i) => points.filter(p => p.cluster === i).length);
    const targetSize = Math.ceil(points.length / k);

    for (let pass = 0; pass < 5; pass++) {
      let swapped = false;
      for (let c = 0; c < k; c++) {
        const excess = clusterSizes[c] - targetSize;
        if (excess <= 0) continue;

        // Find smallest cluster
        let smallest = 0;
        for (let s = 1; s < k; s++) {
          if (clusterSizes[s] < clusterSizes[smallest]) smallest = s;
        }
        if (smallest === c) continue;

        // Move edge points (furthest from centroid c, closest to centroid smallest)
        const members = points.filter(p => p.cluster === c);
        members.sort((a, b) => {
          const da = (a.lat - centroids[c].lat) ** 2 + (a.lng - centroids[c].lng) ** 2;
          const db = (b.lat - centroids[c].lat) ** 2 + (b.lng - centroids[c].lng) ** 2;
          return db - da; // furthest first
        });

        const toMove = Math.min(excess, Math.ceil(excess / 2));
        for (let m = 0; m < toMove; m++) {
          members[m].cluster = smallest;
          clusterSizes[c]--;
          clusterSizes[smallest]++;
          swapped = true;
        }
      }
      if (!swapped) break;
    }

    // Write assignments
    const rows = points.map(p => ({
      tenant_id,
      area_id,
      user_id: user_ids[p.cluster],
      property_id: p.id,
    }));

    // Delete existing assignments for this area first
    await supabase
      .from("canvass_area_property_assignments")
      .delete()
      .eq("tenant_id", tenant_id)
      .eq("area_id", area_id);

    // Insert in chunks
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from("canvass_area_property_assignments")
        .insert(chunk);
      if (insErr) throw insErr;
    }

    // Build counts per rep
    const counts: Record<string, number> = {};
    for (const uid of user_ids) counts[uid] = 0;
    for (const p of points) counts[user_ids[p.cluster]]++;

    return new Response(JSON.stringify({ success: true, total: points.length, counts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("canvass-area-auto-split error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
