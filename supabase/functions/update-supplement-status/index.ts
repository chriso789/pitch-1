import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_STATUSES = [
  "draft",
  "review_ready",
  "submitted",
  "approved",
  "partially_approved",
  "denied",
  "resubmitted",
  "closed",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { supplement_case_id, status, notes, created_by, approved_total } = body;

    if (!ALLOWED_STATUSES.includes(status)) {
      return new Response(JSON.stringify({ error: "Invalid status" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updates: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === "submitted") updates.submitted_at = new Date().toISOString();
    if (status === "approved") updates.approved_at = new Date().toISOString();
    if (status === "denied") updates.denied_at = new Date().toISOString();
    if (status === "resubmitted") updates.resubmitted_at = new Date().toISOString();
    if (approved_total !== undefined) updates.supplement_approved_total = approved_total;

    const { error } = await supabase
      .from("supplement_cases")
      .update(updates)
      .eq("id", supplement_case_id);

    if (error) {
      return new Response(JSON.stringify({ error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("supplement_activity_log").insert({
      supplement_case_id,
      activity_type: status,
      notes: notes || `Status changed to ${status}`,
      created_by: created_by || null,
    });

    return new Response(JSON.stringify({ success: true, status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
