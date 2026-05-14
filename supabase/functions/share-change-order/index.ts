import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization") || "";
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { change_order_id, recipient_email, recipient_name, message, app_origin } = await req.json();
    if (!change_order_id || !recipient_email) {
      return new Response(JSON.stringify({ error: "change_order_id and recipient_email required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: co, error: coErr } = await supabase
      .from("change_orders")
      .select("id, tenant_id, co_number, title, cost_impact, projects(tenant_id)")
      .eq("id", change_order_id)
      .maybeSingle();
    if (coErr || !co) return new Response(JSON.stringify({ error: "change order not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const tenantId = (co as any).tenant_id || (co as any).projects?.tenant_id;
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

    const { data: link, error: linkErr } = await supabase
      .from("change_order_share_links")
      .insert({
        tenant_id: tenantId,
        change_order_id,
        token,
        recipient_email,
        recipient_name: recipient_name || null,
        sent_by: user.id,
      })
      .select("id, token")
      .single();
    if (linkErr) throw linkErr;

    const origin = app_origin || "https://pitch-crm.ai";
    const url = `${origin}/co/${token}`;

    const { data: tenant } = await supabase
      .from("tenants").select("name, email").eq("id", tenantId).maybeSingle();
    const fromName = (tenant as any)?.name || "Pitch CRM";

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY) {
      const html = `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111">
          <h2 style="margin:0 0 12px">Change Order ${co.co_number} for your review</h2>
          <p style="margin:0 0 8px">Hi ${recipient_name || "there"},</p>
          <p style="margin:0 0 12px">${(message || `${fromName} has sent you a change order titled "${co.title}" for your approval.`).replace(/</g,"&lt;")}</p>
          <p style="margin:16px 0">
            <a href="${url}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Review &amp; Approve Change Order</a>
          </p>
          <p style="font-size:12px;color:#666">Or open this link: ${url}</p>
        </div>`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${fromName} <noreply@pitch-crm.ai>`,
          to: [recipient_email],
          subject: `Change Order ${co.co_number} — ${co.title} — please review`,
          html,
        }),
      });
    }

    return new Response(JSON.stringify({ success: true, token, url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
