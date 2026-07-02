// Emails a photo-report PDF (generated client-side) as an attachment via Resend.
// Mirrors the tenant-scoped auth + branding pattern used by send-document-email.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  lead_id?: string | null;
  contact_id?: string | null;
  tenant_id: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  recipient_name?: string;
  subject?: string;
  message?: string;
  property_address?: string;
  photo_count?: number;
  filename: string;
  pdf_base64: string; // no data: prefix
}

async function verifyTenantMembership(admin: any, userId: string, tenantId: string): Promise<boolean> {
  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id, active_tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.tenant_id === tenantId || profile?.active_tenant_id === tenantId) return true;

  const { data: access } = await admin
    .from("user_company_access")
    .select("id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (access) return true;

  const { data: masterRole } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "master")
    .maybeSingle();
  return !!masterRole;
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      return new Response(JSON.stringify({ success: false, error: "Email service not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resend = new Resend(resendApiKey);
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;

    if (!body.tenant_id || !Array.isArray(body.recipients) || body.recipients.length === 0
        || !body.pdf_base64 || !body.filename) {
      return new Response(JSON.stringify({
        success: false,
        error: "tenant_id, recipients[], pdf_base64, filename are required",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const recipients = body.recipients.map(r => r.trim()).filter(isEmail);
    const cc = (body.cc || []).map(r => r.trim()).filter(isEmail);
    const bcc = (body.bcc || []).map(r => r.trim()).filter(isEmail);
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No valid recipient emails" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Attachment size sanity: base64 ~ 1.37x raw. Cap ~15 MB raw.
    if (body.pdf_base64.length > 21_000_000) {
      return new Response(JSON.stringify({
        success: false,
        error: "PDF too large to email. Please reduce the number of photos.",
      }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const hasAccess = await verifyTenantMembership(admin, user.id, body.tenant_id);
    if (!hasAccess) {
      return new Response(JSON.stringify({ success: false, error: "Access denied" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("id, first_name, last_name, email, phone")
      .eq("id", user.id).single();

    const { data: tenant } = await admin
      .from("tenants")
      .select("id, name, logo_url, primary_color")
      .eq("id", body.tenant_id).single();

    const companyName = tenant?.name || "Our Team";
    const primaryColor = tenant?.primary_color || "#f97316";
    const logoUrl = tenant?.logo_url;

    const { data: emailDomain } = await admin
      .from("company_email_domains")
      .select("*")
      .eq("tenant_id", body.tenant_id)
      .eq("verification_status", "verified")
      .eq("is_active", true)
      .maybeSingle();

    const defaultFromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
    const fromEmail = emailDomain?.from_email || `photos@${defaultFromDomain}`;
    const fromName = emailDomain?.from_name || companyName;
    const replyTo = emailDomain?.reply_to_email || profile?.email;

    const firstName = (body.recipient_name || "").split(" ")[0] || "there";
    const safeMessage = (body.message || "").replace(/</g, "&lt;");
    const addr = body.property_address ? `<p style="margin:0 0 8px;color:#4b5563;font-size:14px;">${body.property_address.replace(/</g, "&lt;")}</p>` : "";
    const count = body.photo_count ?? undefined;

    const emailHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f4f4f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.08);">
<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#1a1a2e 100%);padding:28px;text-align:center;">
${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-height:56px;margin-bottom:12px;">` : ""}
<h1 style="color:#fff;margin:0;font-size:22px;font-weight:600;">Photo Report</h1>
</td></tr>
<tr><td style="padding:32px 28px;">
<p style="color:#111827;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${firstName},</p>
${addr}
${safeMessage ? `<p style="color:#374151;font-size:15px;line-height:1.6;margin:16px 0;">${safeMessage}</p>` : `<p style="color:#374151;font-size:15px;line-height:1.6;margin:16px 0;">The photo report${count ? ` (${count} photo${count !== 1 ? "s" : ""})` : ""} is attached to this email as a PDF.</p>`}
<p style="color:#6b7280;font-size:14px;line-height:1.6;margin:24px 0 0;">Reply to this email with any questions.</p>
</td></tr>
<tr><td style="background:#1a1a2e;padding:20px 28px;text-align:center;">
<p style="color:#9ca3af;font-size:13px;margin:0;">${profile?.first_name || ""} ${profile?.last_name || ""} · ${companyName}</p>
${profile?.phone ? `<p style="color:#6b7280;font-size:12px;margin:6px 0 0;">📞 ${profile.phone}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;

    const subjectLine = body.subject || `Photo Report${body.property_address ? ` — ${body.property_address}` : ""}`;

    const emailResult = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: recipients,
      ...(cc.length ? { cc } : {}),
      ...(bcc.length ? { bcc } : {}),
      reply_to: replyTo,
      subject: subjectLine,
      html: emailHtml,
      attachments: [{
        filename: body.filename,
        content: body.pdf_base64, // Resend accepts base64 string
      }],
    });

    if ((emailResult as any).error) {
      console.error("[send-photo-report-email] resend error:", (emailResult as any).error);
      return new Response(JSON.stringify({
        success: false,
        error: (emailResult as any).error?.message || "Resend failed",
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Best-effort activity log
    try {
      await admin.from("communication_history").insert({
        tenant_id: body.tenant_id,
        contact_id: body.contact_id || null,
        pipeline_entry_id: body.lead_id || null,
        rep_id: user.id,
        direction: "outbound",
        channel: "email",
        subject: subjectLine,
        body: `Photo report emailed to ${recipients.join(", ")}${cc.length ? ` (cc: ${cc.join(", ")})` : ""}`,
        metadata: {
          type: "photo_report",
          filename: body.filename,
          photo_count: body.photo_count ?? null,
          recipients, cc, bcc,
        },
      });
    } catch (e) {
      console.warn("[send-photo-report-email] communication_history insert failed", e);
    }

    return new Response(JSON.stringify({
      success: true,
      message_id: (emailResult as any).data?.id ?? null,
      recipients,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[send-photo-report-email] fatal", err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

Deno.serve(handler);
