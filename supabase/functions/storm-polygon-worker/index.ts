// supabase/functions/storm-polygon-worker/index.ts

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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { tenant_id, storm_event_id, polygon_id } = body;

    if (!tenant_id || !storm_event_id || !polygon_id) {
      return new Response(JSON.stringify({ error: "tenant_id, storm_event_id, polygon_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const concurrency = Math.max(1, Math.min(10, body.concurrency ?? 6));
    const take = Math.max(1, Math.min(500, body.take ?? 100));
    const timeoutMs = body.timeout_ms ?? 15000;

    const { data: jobs } = await supabase
      .from("storm_lookup_queue")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("storm_event_id", storm_event_id)
      .eq("polygon_id", polygon_id)
      .eq("status", "queued")
      .limit(take);

    if (!jobs?.length) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: "Queue empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let idx = 0;
    let done = 0;

    const workers = Array.from({ length: concurrency }).map(async () => {
      while (idx < jobs.length) {
        const job = jobs[idx++];
        try {
          await supabase.from("storm_lookup_queue").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", job.id);

          const { data, error } = await supabase.functions.invoke("storm-public-lookup", {
            body: {
              tenant_id,
              storm_event_id,
              polygon_id,
              lat: job.lat,
              lng: job.lng,
              address: job.address,
              timeout_ms: timeoutMs,
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

    return new Response(JSON.stringify({ success: true, processed: done }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[storm-polygon-worker] error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
