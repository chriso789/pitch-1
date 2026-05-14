import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { token } = await req.json();
    if (!token) return new Response(JSON.stringify({ error: "token required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: link } = await supabase
      .from("change_order_share_links")
      .select("*")
      .eq("token", token)
      .eq("is_active", true)
      .maybeSingle();
    if (!link) return new Response(JSON.stringify({ error: "invalid or expired link" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "link expired" }), { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!link.opened_at) {
      await supabase.from("change_order_share_links").update({ opened_at: new Date().toISOString() }).eq("id", link.id);
    }

    const { data: co } = await supabase
      .from("change_orders")
      .select("id, co_number, title, description, reason, original_scope, new_scope, cost_impact, time_impact_days, status, created_at, project_id, line_items, material_total, labor_total, customer_approved, customer_approved_at, tenant_id")
      .eq("id", link.change_order_id)
      .maybeSingle();
    if (!co) return new Response(JSON.stringify({ error: "change order not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: tenant } = await supabase
      .from("tenants")
      .select("name, logo_url, phone, email, address_street, address_city, address_state, address_zip, license_number")
      .eq("id", co.tenant_id)
      .maybeSingle();

    let customer: any = null;
    let pipelineEntryId: string | null = null;
    if (co.project_id) {
      const { data: pe } = await supabase
        .from("pipeline_entries")
        .select("id, lead_name, contacts!pipeline_entries_contact_id_fkey(first_name, last_name, address_street, address_city, address_state, address_zip, phone, email)")
        .eq("project_id", co.project_id)
        .limit(1)
        .maybeSingle();
      pipelineEntryId = (pe as any)?.id || null;
      const c: any = (pe as any)?.contacts;
      if (c) {
        customer = {
          name: (pe as any)?.lead_name || [c.first_name, c.last_name].filter(Boolean).join(" "),
          address_street: c.address_street, address_city: c.address_city,
          address_state: c.address_state, address_zip: c.address_zip,
          phone: c.phone, email: c.email,
        };
      }
    }

    return new Response(JSON.stringify({
      success: true,
      change_order: co,
      company: tenant,
      customer,
      pipeline_entry_id: pipelineEntryId,
      already_signed: !!link.signed_at,
      signed_at: link.signed_at,
      signed_by_name: link.signed_by_name,
      recipient_name: link.recipient_name,
      recipient_email: link.recipient_email,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
