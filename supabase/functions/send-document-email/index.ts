import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendDocumentEmailRequest {
  document_id: string;
  contact_id?: string | null;
  recipient_email: string;
  recipient_name: string;
  subject?: string;
  message?: string;
  cc?: string[];
  bcc?: string[];
}

function resolveStorageBucket(documentType?: string | null, filePath?: string | null): string {
  if (documentType === "company_resource") return "smartdoc-assets";
  if (filePath?.startsWith("company-docs/")) return "smartdoc-assets";
  if (
    documentType === "photo" ||
    documentType === "inspection_photo" ||
    documentType === "required_photos" ||
    filePath?.includes("/leads/")
  ) {
    return filePath?.includes("/leads/") ? "customer-photos" : "documents";
  }
  return "documents";
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

const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      return new Response(JSON.stringify({ success: false, error: "Email service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resend = new Resend(resendApiKey);
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: SendDocumentEmailRequest = await req.json();
    if (!body.document_id || !body.recipient_email || !body.recipient_name) {
      return new Response(
        JSON.stringify({ success: false, error: "document_id, recipient_email, recipient_name required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: doc } = await admin
      .from("documents")
      .select("id, tenant_id, pipeline_entry_id, contact_id, document_type, file_path, filename, mime_type")
      .eq("id", body.document_id)
      .maybeSingle();
    if (!doc) {
      return new Response(JSON.stringify({ success: false, error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hasAccess = await verifyTenantMembership(admin, user.id, doc.tenant_id);
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
      .select("id, name, logo_url, primary_color, secondary_color")
      .eq("id", doc.tenant_id).single();

    const companyName = tenant?.name || "Our Company";
    const primaryColor = tenant?.primary_color || "#f97316";
    const logoUrl = tenant?.logo_url;

    const { data: emailDomain } = await admin
      .from("company_email_domains")
      .select("*")
      .eq("tenant_id", doc.tenant_id)
      .eq("verification_status", "verified")
      .eq("is_active", true)
      .maybeSingle();

    // Tracking link
    const trackingToken = crypto.randomUUID();
    const tokenHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(trackingToken));
    const tokenHash = Array.from(new Uint8Array(tokenHashBuf))
      .map(b => b.toString(16).padStart(2, "0")).join("");

    const { data: trackingLink, error: trackingError } = await admin
      .from("quote_tracking_links")
      .insert({
        tenant_id: doc.tenant_id,
        token: trackingToken,
        token_hash: tokenHash,
        document_id: doc.id,
        contact_id: body.contact_id || doc.contact_id || null,
        pipeline_entry_id: doc.pipeline_entry_id,
        recipient_email: body.recipient_email,
        recipient_name: body.recipient_name,
        sent_by: user.id,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select().single();

    if (trackingError) {
      console.error("[send-document-email] tracking link error:", trackingError);
      return new Response(JSON.stringify({ success: false, error: "Failed to create tracking link" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appUrl = Deno.env.get("FRONTEND_URL") || Deno.env.get("APP_URL") || "https://pitch-crm.ai";
    const viewUrl = `${appUrl}/view-document/${trackingToken}`;

    const defaultFromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
    const fromEmail = emailDomain?.from_email || `documents@${defaultFromDomain}`;
    const fromName = emailDomain?.from_name || companyName;
    const replyTo = emailDomain?.reply_to_email || profile?.email;

    const docLabel = doc.filename || "your document";
    const isInvoice = (doc.document_type || "").toLowerCase().includes("invoice") || docLabel.toLowerCase().includes("invoice");
    const docNoun = isInvoice ? "Invoice" : "Document";

    const emailHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f4f4f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.1);">
<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#1a1a2e 100%);padding:32px;text-align:center;">
${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-height:60px;margin-bottom:16px;">` : ""}
<h1 style="color:#fff;margin:0;font-size:24px;font-weight:600;">Your ${docNoun} is Ready</h1>
</td></tr>
<tr><td style="padding:40px 32px;">
<p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 24px;">Hi ${body.recipient_name.split(" ")[0]},</p>
${body.message
  ? `<p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 24px;">${body.message.replace(/</g, "&lt;")}</p>`
  : `<p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 24px;">Please find your ${docNoun.toLowerCase()} attached. Click the button below to view it online.</p>`}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:24px 0;"><tr><td style="padding:24px;">
<table width="100%"><tr>
<td style="color:#6b7280;font-size:14px;">${docNoun}</td>
<td style="text-align:right;color:#111827;font-weight:600;font-size:14px;">${docLabel}</td>
</tr></table></td></tr></table>
<table width="100%"><tr><td align="center" style="padding:16px 0 32px;">
<a href="${viewUrl}" style="display:inline-block;background:linear-gradient(135deg,${primaryColor} 0%,#ea580c 100%);color:#fff;text-decoration:none;padding:16px 48px;border-radius:8px;font-weight:600;font-size:16px;">View ${docNoun} →</a>
</td></tr></table>
<p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0;">If you have questions, reply to this email or give us a call.</p>
</td></tr>
<tr><td style="background:#1a1a2e;padding:24px 32px;text-align:center;">
<p style="color:#9ca3af;font-size:14px;margin:0 0 8px;">Sent by ${profile?.first_name || ""} ${profile?.last_name || ""} at ${companyName}</p>
<p style="color:#6b7280;font-size:12px;margin:0;">${profile?.phone ? `📞 ${profile.phone} | ` : ""}📧 ${replyTo || ""}</p>
</td></tr></table></td></tr></table></body></html>`;

    const subjectLine = body.subject || `${docNoun} from ${companyName} - ${docLabel}`;

    const emailResult = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [body.recipient_email],
      ...(body.cc?.length ? { cc: body.cc } : {}),
      ...(body.bcc?.length ? { bcc: body.bcc } : {}),
      reply_to: replyTo,
      subject: subjectLine,
      html: emailHtml,
    });

    if ((emailResult as any).error) {
      console.error("[send-document-email] resend error:", (emailResult as any).error);
      return new Response(JSON.stringify({ success: false, error: (emailResult as any).error?.message || "Resend failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log to communication_history — opens auto-tracked via resend webhook
    await admin.from("communication_history").insert({
      tenant_id: doc.tenant_id,
      contact_id: body.contact_id || doc.contact_id || null,
      pipeline_entry_id: doc.pipeline_entry_id,
      rep_id: user.id,
      communication_type: "email",
      direction: "outbound",
      subject: subjectLine,
      content: body.message || `${docNoun} ${docLabel} emailed to ${body.recipient_email}`,
      from_address: fromEmail,
      to_address: body.recipient_email,
      delivery_status: "sent",
      resend_message_id: emailResult.data?.id || null,
      metadata: {
        tracking_link_id: trackingLink.id,
        document_id: doc.id,
        document_filename: doc.filename,
        document_type: doc.document_type,
        source: "send-document-email",
        ...(body.cc?.length ? { cc: body.cc } : {}),
        ...(body.bcc?.length ? { bcc: body.bcc } : {}),
      },
    });

    if (doc.pipeline_entry_id) {
      await admin.from("internal_notes").insert({
        tenant_id: doc.tenant_id,
        pipeline_entry_id: doc.pipeline_entry_id,
        contact_id: body.contact_id || doc.contact_id || null,
        author_id: user.id,
        content: `📧 ${docNoun} **${docLabel}** emailed to ${body.recipient_name} (${body.recipient_email})${body.cc?.length ? ` — cc: ${body.cc.join(", ")}` : ""}${body.bcc?.length ? ` — bcc: ${body.bcc.join(", ")}` : ""}.`,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: `${docNoun} email sent successfully`,
      tracking_link_id: trackingLink.id,
      view_url: viewUrl,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[send-document-email] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
};

Deno.serve(handler);
