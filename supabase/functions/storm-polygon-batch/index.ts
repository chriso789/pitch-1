// supabase/functions/storm-polygon-batch/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { polygonToBbox, samplePolygonGrid } from "../_shared/public_data/geo.ts";
import { fetchOverpassAddressesInPolygon } from "../_shared/public_data/overpass.ts";
import { normalizeAddressKey } from "../_shared/public_data/normalize.ts";

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
    const { tenant_id, storm_event_id, polygon_id, polygon_geojson } = body;

    if (!tenant_id || !storm_event_id || !polygon_id || !polygon_geojson) {
      return new Response(JSON.stringify({ error: "tenant_id, storm_event_id, polygon_id, polygon_geojson required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const maxCandidates = body.max_candidates ?? 600;
    const concurrency = Math.max(1, Math.min(10, body.concurrency ?? 6));
    const timeoutMs = body.timeout_ms ?? 15000;

    // 1) Discover candidate addresses
    const candidates: Array<{ lat: number; lng: number; address?: string; key?: string }> = [];

    // Try Overpass first
    const overpass = await fetchOverpassAddressesInPolygon(polygon_geojson, timeoutMs).catch(() => []);
    for (const a of overpass) {
      const formatted = a.formatted ?? `${a.house_number ?? ""} ${a.road ?? ""}`.trim();
      const key = normalizeAddressKey(formatted || `${a.lat},${a.lng}`);
      candidates.push({ lat: a.lat, lng: a.lng, address: formatted || undefined, key });
      if (candidates.length >= maxCandidates) break;
    }

    // Fallback: grid sampling
    if (candidates.length === 0) {
      const bbox = polygonToBbox(polygon_geojson);
      const grid = samplePolygonGrid(polygon_geojson, bbox, { spacingMeters: 35, maxPoints: maxCandidates });
      for (const p of grid) candidates.push({ lat: p.lat, lng: p.lng });
    }

    // 2) Deduplicate
    const uniq = new Map<string, { lat: number; lng: number; address?: string }>();
    for (const c of candidates) {
      const k = c.key ?? `${c.lat.toFixed(6)}_${c.lng.toFixed(6)}`;
      if (!uniq.has(k)) uniq.set(k, { lat: c.lat, lng: c.lng, address: c.address });
    }
    const finalCandidates = Array.from(uniq.values()).slice(0, maxCandidates);

    // 3) Enqueue
    const queueRows = finalCandidates.map((c) => ({
      tenant_id,
      storm_event_id,
      polygon_id,
      lat: c.lat,
      lng: c.lng,
      address: c.address ?? null,
      status: "queued",
    }));

    await supabase
      .from("storm_lookup_queue")
      .upsert(queueRows, { onConflict: "tenant_id,storm_event_id,polygon_id,lat,lng" });

    // 4) Process first batch inline
    const processed = await processQueueInline(supabase, {
      tenant_id, storm_event_id, polygon_id, concurrency, timeoutMs,
      maxBatch: Math.min(50, finalCandidates.length),
    });

    return new Response(JSON.stringify({
      success: true,
      discovered_candidates: finalCandidates.length,
      queued: queueRows.length,
      processed_inline: processed,
      next: "Call storm-polygon-worker to continue draining queue.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[storm-polygon-batch] error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processQueueInline(
  supabase: any,
  opts: { tenant_id: string; storm_event_id: string; polygon_id: string; concurrency: number; timeoutMs: number; maxBatch: number },
) {
  const { data: jobs } = await supabase
    .from("storm_lookup_queue")
    .select("*")
    .eq("tenant_id", opts.tenant_id)
    .eq("storm_event_id", opts.storm_event_id)
    .eq("polygon_id", opts.polygon_id)
    .eq("status", "queued")
    .limit(opts.maxBatch);

  if (!jobs?.length) return 0;

  let idx = 0;
  let done = 0;

  const workers = Array.from({ length: opts.concurrency }).map(async () => {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      try {
        await supabase.from("storm_lookup_queue").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", job.id);

        const { data, error } = await supabase.functions.invoke("storm-public-lookup", {
          body: {
            tenant_id: opts.tenant_id,
            storm_event_id: opts.storm_event_id,
            polygon_id: opts.polygon_id,
            lat: job.lat,
            lng: job.lng,
            address: job.address,
            timeout_ms: opts.timeoutMs,
          },
        });
        if (error) throw error;

        await supabase.from("storm_lookup_queue").update({ status: "done", result: data, updated_at: new Date().toISOString() }).eq("id", job.id);
        done++;
      } catch (e) {
        await supabase.from("storm_lookup_queue").update({ status: "error", error: String(e), updated_at: new Date().toISOString() }).eq("id", job.id);
      }
    }
  });

  await Promise.all(workers);
  return done;
}
