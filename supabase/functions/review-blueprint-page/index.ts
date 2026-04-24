// Updates a plan_pages row's review_status (approved/rejected/pending) and logs the action.
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
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userData?.user?.id ?? null;

    const { page_id, review_status } = await req.json();
    if (!page_id || !review_status) throw new Error("page_id and review_status required");
    if (!["pending", "approved", "rejected"].includes(review_status)) {
      throw new Error("invalid review_status");
    }

    const { data: page, error: pErr } = await supabase
      .from("plan_pages").select("id, document_id, tenant_id").eq("id", page_id).single();
    if (pErr) throw pErr;

    const { error } = await supabase
      .from("plan_pages")
      .update({ review_status, updated_at: new Date().toISOString() })
      .eq("id", page_id);
    if (error) throw error;

    await supabase.from("plan_review_actions").insert({
      tenant_id: page.tenant_id,
      document_id: page.document_id,
      page_id,
      user_id: userId,
      action: `page_${review_status}`,
      target_table: "plan_pages",
      target_id: page_id,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: String((err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err)) || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
