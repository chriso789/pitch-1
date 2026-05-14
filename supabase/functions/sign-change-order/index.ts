import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { token, signed_by_name, signed_by_email, signature_data_url } = await req.json();
    if (!token || !signed_by_name) {
      return new Response(JSON.stringify({ error: "token and signed_by_name required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: link } = await supabase
      .from("change_order_share_links")
      .select("*").eq("token", token).eq("is_active", true).maybeSingle();
    if (!link) return new Response(JSON.stringify({ error: "invalid link" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (link.signed_at) return new Response(JSON.stringify({ error: "already signed" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "";
    const ua = req.headers.get("user-agent") || "";
    const now = new Date().toISOString();

    await supabase.from("change_order_share_links").update({
      signed_at: now,
      signed_by_name,
      signed_by_email: signed_by_email || link.recipient_email,
      signature_data_url: signature_data_url || null,
      signature_ip: ip,
      signature_user_agent: ua,
    }).eq("id", link.id);

    await supabase.from("change_orders").update({
      customer_approved: true,
      customer_approved_at: now,
      status: "approved",
      approved_date: now,
    }).eq("id", link.change_order_id);

    return new Response(JSON.stringify({ success: true, signed_at: now }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
