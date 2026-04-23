// Returns a blueprint document with pages, geometry, dimensions, pitch notes, detail refs, and specs.
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

    const authHeader = req.headers.get("Authorization") || "";
    const { data: userData, error: uErr } =
      await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (uErr || !userData?.user) throw new Error("unauthorized");

    let document_id: string | null = null;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      document_id = body?.document_id ?? null;
    }
    if (!document_id) {
      const url = new URL(req.url);
      document_id = url.searchParams.get("document_id");
    }
    if (!document_id) throw new Error("document_id required");

    const { data: prof } = await supabase
      .from("profiles").select("tenant_id").eq("id", userData.user.id).maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) throw new Error("no tenant for user");

    const { data: document, error: docErr } = await supabase
      .from("plan_documents").select("*")
      .eq("id", document_id).eq("tenant_id", tenantId).single();
    if (docErr) throw docErr;

    const { data: pages, error: pagesErr } = await supabase
      .from("plan_pages").select("*")
      .eq("document_id", document_id).order("page_number");
    if (pagesErr) throw pagesErr;

    const pageIds = (pages || []).map((p: any) => p.id);
    const empty = { data: [], error: null } as const;
    const [geom, dims, pitch, refs, specs] = await Promise.all([
      pageIds.length ? supabase.from("plan_geometry").select("*").in("page_id", pageIds) : empty,
      pageIds.length ? supabase.from("plan_dimensions").select("*").in("page_id", pageIds) : empty,
      pageIds.length ? supabase.from("plan_pitch_notes").select("*").in("page_id", pageIds) : empty,
      pageIds.length ? supabase.from("plan_detail_refs").select("*").in("page_id", pageIds) : empty,
      supabase.from("plan_specs").select("*").eq("document_id", document_id),
    ]);
    for (const r of [geom, dims, pitch, refs, specs]) if (r.error) throw r.error;

    return new Response(JSON.stringify({
      ok: true,
      document,
      pages: pages || [],
      geometry: geom.data || [],
      dimensions: dims.data || [],
      pitch_notes: pitch.data || [],
      detail_refs: refs.data || [],
      specs: specs.data || [],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
