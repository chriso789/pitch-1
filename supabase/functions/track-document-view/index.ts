import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

function parseUA(ua: string) {
  let device = "Desktop";
  if (/mobile/i.test(ua)) device = "Mobile";
  else if (/tablet|ipad/i.test(ua)) device = "Tablet";
  let browser = "Unknown";
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";
  else if (/firefox/i.test(ua)) browser = "Firefox";
  else if (/edge/i.test(ua)) browser = "Edge";
  return { device, browser };
}

const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: "Token required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: link } = await supabase
      .from("quote_tracking_links")
      .select(`*, documents:document_id (id, tenant_id, filename, mime_type, file_path, document_type), contacts (first_name, last_name)`)
      .eq("token", token)
      .eq("is_active", true)
      .maybeSingle();

    if (!link || !link.document_id || !link.documents) {
      return new Response(JSON.stringify({ success: false, error: "Invalid or expired link" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return new Response(JSON.stringify({ success: false, error: "Link has expired" }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const doc = link.documents;
    const bucket = resolveStorageBucket(doc.document_type, doc.file_path);
    const candidates = new Set<string>([doc.file_path]);
    if (bucket === "documents" && doc.tenant_id && doc.file_path && !doc.file_path.startsWith(doc.tenant_id)) {
      candidates.add(`${doc.tenant_id}/${doc.file_path}`);
    }

    let signedUrl: string | null = null;
    for (const path of candidates) {
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 6 * 60 * 60);
      if (signed?.signedUrl) { signedUrl = signed.signedUrl; break; }
    }

    if (!signedUrl) {
      return new Response(JSON.stringify({ success: false, error: "Document file not available" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record view
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const ua = req.headers.get("user-agent") || "";
    const { device, browser } = parseUA(ua);
    const isFirstView = !link.last_viewed_at;

    await supabase.from("quote_tracking_links")
      .update({
        view_count: (link.view_count || 0) + 1,
        last_viewed_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    // Notify sender — only on first view (or every view? send-quote-email notifies every)
    const contactName = link.contacts
      ? `${link.contacts.first_name} ${link.contacts.last_name}`
      : link.recipient_name || "A customer";
    const viewWord = isFirstView ? "opened" : "viewed again";

    await supabase.from("user_notifications").insert({
      tenant_id: link.tenant_id,
      user_id: link.sent_by,
      title: "Document Viewed 👀",
      message: `${contactName} ${viewWord} ${doc.filename}`,
      type: "document_viewed",
      priority: isFirstView ? "high" : "normal",
      metadata: {
        tracking_link_id: link.id,
        document_id: doc.id,
        contact_id: link.contact_id,
        pipeline_entry_id: link.pipeline_entry_id,
        ip: clientIp, device, browser,
      },
    });

    // Realtime broadcast
    try {
      await supabase.channel(`broadcast:${link.tenant_id}:${link.sent_by}`).send({
        type: "broadcast",
        event: "document_viewed",
        payload: {
          document_id: doc.id,
          contact_name: contactName,
          filename: doc.filename,
        },
      });
    } catch (e) {
      console.warn("[track-document-view] broadcast failed", e);
    }

    return new Response(JSON.stringify({
      success: true,
      document: {
        id: doc.id,
        filename: doc.filename,
        mime_type: doc.mime_type,
        signed_url: signedUrl,
      },
      recipient_name: link.recipient_name,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[track-document-view] error", error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

Deno.serve(handler);
