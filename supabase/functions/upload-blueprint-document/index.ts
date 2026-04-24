// Records a new uploaded blueprint and queues the classify_pages job.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve user + tenant from JWT
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) throw new Error("unauthorized");
    const userId = userData.user.id;

    const { data: prof } = await supabase
      .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) throw new Error("no tenant for user");

    const body = await req.json();
    const { property_address, file_name, file_path, contact_id, pipeline_entry_id } = body || {};
    if (!file_name || !file_path) {
      return new Response(JSON.stringify({ error: "file_name and file_path required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: doc, error } = await supabase
      .from("plan_documents")
      .insert({
        tenant_id: tenantId,
        uploaded_by: userId,
        contact_id: contact_id ?? null,
        pipeline_entry_id: pipeline_entry_id ?? null,
        property_address: property_address ?? null,
        file_name,
        file_path,
        status: "uploaded",
      })
      .select()
      .single();
    if (error) throw error;

    await supabase.from("plan_parse_jobs").insert({
      tenant_id: tenantId,
      document_id: doc.id,
      job_type: "classify_pages",
      status: "queued",
      input_json: { file_path },
    });

    return new Response(JSON.stringify({ ok: true, document: doc }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: String((err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err)) || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
