import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendDocumentSmsRequest {
  document_id: string;
  contact_id?: string | null;
  recipient_phone: string;
  recipient_name: string;
  message?: string;
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

    const body: SendDocumentSmsRequest = await req.json();
    if (!body.document_id || !body.recipient_phone || !body.recipient_name) {
      return new Response(
        JSON.stringify({ success: false, error: "document_id, recipient_phone, recipient_name required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: doc } = await admin
      .from("documents")
      .select("id, tenant_id, pipeline_entry_id, contact_id, document_type, filename, file_path, mime_type")
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

    const { data: tenant } = await admin
      .from("tenants").select("id, name").eq("id", doc.tenant_id).single();
    const companyName = tenant?.name || "Our Company";

    // Tracking link (re-using same table as email share)
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
        recipient_email: null,
        recipient_name: body.recipient_name,
        sent_by: user.id,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select().single();

    if (trackingError) {
      console.error("[send-document-sms] tracking link error:", trackingError);
      return new Response(JSON.stringify({ success: false, error: "Failed to create tracking link" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { getPublicAppUrl } = await import("../_shared/public-app-url.ts");
    const appUrl = getPublicAppUrl();
    const viewUrl = `${appUrl}/view-document/${trackingToken}`;

    const docLabel = doc.filename || "your document";
    const isInvoice = (doc.document_type || "").toLowerCase().includes("invoice") || docLabel.toLowerCase().includes("invoice");
    const docNoun = isInvoice ? "invoice" : "document";
    const firstName = body.recipient_name.split(" ")[0];

    // Generate a long-lived signed URL to the PDF so we can attach it as MMS media.
    // Fallback link is always included in the body in case the carrier strips media.
    let mediaUrls: string[] = [];
    if (doc.file_path) {
      const { data: signed, error: signErr } = await admin.storage
        .from("documents")
        .createSignedUrl(doc.file_path, 60 * 60 * 24 * 30); // 30 days
      if (signErr) {
        console.warn("[send-document-sms] signed url failed:", signErr);
      } else if (signed?.signedUrl) {
        mediaUrls = [signed.signedUrl];
      }
    }

    const smsBody = body.message?.trim()
      ? `${body.message.trim()}\n\nCan't open the PDF? View it here: ${viewUrl}`
      : `Hi ${firstName}, your ${docNoun} from ${companyName} is attached. Can't open the PDF? View it here: ${viewUrl}`;

    // Call telnyx-send-sms via internal invoke
    const smsResp = await fetch(`${supabaseUrl}/functions/v1/telnyx-send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authHeader.replace("Bearer ", "")}`,
      },
      body: JSON.stringify({
        to: body.recipient_phone,
        message: smsBody,
        contactId: body.contact_id || doc.contact_id || null,
        mediaUrls,
      }),
    });

    const smsResult = await smsResp.json().catch(() => ({}));
    if (!smsResp.ok || smsResult?.error) {
      console.error("[send-document-sms] telnyx error:", smsResult);
      return new Response(JSON.stringify({ success: false, error: smsResult?.error || "SMS send failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (doc.pipeline_entry_id) {
      await admin.from("internal_notes").insert({
        tenant_id: doc.tenant_id,
        pipeline_entry_id: doc.pipeline_entry_id,
        contact_id: body.contact_id || doc.contact_id || null,
        author_id: user.id,
        content: `📱 ${isInvoice ? "Invoice" : "Document"} **${docLabel}** texted to ${body.recipient_name} (${body.recipient_phone}).`,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Document SMS sent successfully",
      tracking_link_id: trackingLink.id,
      view_url: viewUrl,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[send-document-sms] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
};

Deno.serve(handler);
