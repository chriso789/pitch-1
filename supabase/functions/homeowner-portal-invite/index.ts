import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const FROM_DOMAIN = Deno.env.get("RESEND_FROM_DOMAIN") || "pitch-crm.ai";
    const APP_URL = Deno.env.get("APP_URL") || "https://pitch-crm.ai";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !user) throw new Error("Unauthorized");

    const { contact_id, mode = "invite" } = await req.json();
    if (!contact_id) throw new Error("contact_id required");

    // Fetch contact
    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("id, tenant_id, first_name, last_name, email")
      .eq("id", contact_id)
      .single();
    if (contactErr || !contact) throw new Error("Contact not found");
    if (!contact.email) throw new Error("Contact has no email");

    // Fetch tenant for branding
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name, logo_url")
      .eq("id", contact.tenant_id)
      .single();

    // Latest project for this contact
    const { data: project } = await supabase
      .from("projects")
      .select("id, name")
      .eq("tenant_id", contact.tenant_id)
      .eq("contact_id", contact_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Generate a customer portal token (re-uses existing /customer/:token route)
    const tokenChars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let token = "";
    for (let i = 0; i < 32; i++) token += tokenChars.charAt(Math.floor(Math.random() * tokenChars.length));
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error: tokenErr } = await supabase.from("customer_portal_tokens").insert({
      tenant_id: contact.tenant_id,
      project_id: project?.id || null,
      contact_id,
      token,
      expires_at: expiresAt,
      created_by: user.id,
    });
    if (tokenErr) throw tokenErr;

    const portalUrl = `${APP_URL}/customer/${token}`;
    const tenantName = tenant?.name || "Your Project Team";
    const isReminder = mode === "resend";
    const subject = isReminder
      ? `Reminder: Your ${tenantName} project portal`
      : `Welcome to your ${tenantName} project portal`;

    if (mode === "link_only") {
      return new Response(JSON.stringify({ success: true, portal_url: portalUrl, token }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
        ${tenant?.logo_url ? `<img src="${tenant.logo_url}" alt="${tenantName}" style="max-height:48px;margin-bottom:16px"/>` : ""}
        <h1 style="font-size:22px;margin:0 0 12px">Hi ${contact.first_name || ""},</h1>
        <p style="font-size:15px;line-height:1.55;color:#334155">
          ${isReminder ? "Here's another link" : `${tenantName} has set up`} your homeowner project portal.
          You can view photos, documents, signatures, payments, and message us anytime.
        </p>
        <p style="margin:24px 0">
          <a href="${portalUrl}" style="background:#2563eb;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">
            Open My Portal
          </a>
        </p>
        <p style="font-size:13px;color:#64748b">Or paste this link in your browser:<br/><a href="${portalUrl}">${portalUrl}</a></p>
        <p style="font-size:13px;color:#94a3b8;margin-top:32px">This link is valid for 30 days.</p>
      </div>
    `;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${tenantName} <noreply@${FROM_DOMAIN}>`,
        to: [contact.email],
        subject,
        html,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      throw new Error(`Email send failed: ${err}`);
    }

    return new Response(JSON.stringify({ success: true, portal_url: portalUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("homeowner-portal-invite error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) || "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
