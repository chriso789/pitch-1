import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SignatureRecipient {
  name: string;
  email: string;
  role: string;
  routing_order?: number;
}

interface RequestBody {
  document_id: string;
  document_type: 'smart_doc_instance' | 'estimate' | 'proposal';
  recipients: SignatureRecipient[];
  email_subject?: string;
  email_message?: string;
  expire_days?: number;
  pipeline_entry_id?: string;
  contact_id?: string;
  cc?: string[];
  bcc?: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user profile for tenant
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id, first_name, last_name, email")
      .eq("id", user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: RequestBody = await req.json();
    const { document_id, document_type, recipients, email_subject, email_message, expire_days = 30, pipeline_entry_id, contact_id, cc, bcc } = body;

    if (!document_id || !recipients?.length) {
      return new Response(JSON.stringify({ error: "document_id and recipients required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Creating signature envelope for ${document_type} ${document_id}`);

    // Fetch document metadata based on type
    let documentTitle = email_subject || "Please sign this document";
    let pdfPath: string | null = null;
    let resolvedContactId: string | null = contact_id || null;
    let resolvedProjectId: string | null = null;
    let resolvedPipelineEntryId: string | null = pipeline_entry_id || null;

    if (document_type === 'smart_doc_instance') {
      const { data } = await supabase
        .from("smart_doc_instances")
        .select("id, pdf_url, contact_id, project_id, title")
        .eq("id", document_id)
        .single();
      if (data) {
        pdfPath = data.pdf_url;
        resolvedContactId = resolvedContactId || data.contact_id;
        resolvedProjectId = data.project_id;
        documentTitle = email_subject || `Please sign: ${data.title || 'Document'}`;
      }
    } else if (document_type === 'estimate') {
      const { data } = await supabase
        .from("enhanced_estimates")
        .select("id, pdf_url, contact_id, pipeline_entry_id, estimate_number, display_name")
        .eq("id", document_id)
        .single();
      if (data) {
        pdfPath = data.pdf_url;
        resolvedContactId = resolvedContactId || data.contact_id;
        resolvedPipelineEntryId = resolvedPipelineEntryId || data.pipeline_entry_id;
        documentTitle = email_subject || `Please sign: ${data.display_name || data.estimate_number || 'Estimate'}`;
      } else {
        return new Response(JSON.stringify({ error: "Estimate not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (document_type === 'proposal') {
      const { data } = await supabase
        .from("proposals")
        .select("id, pdf_url, contact_id, project_id")
        .eq("id", document_id)
        .single();
      if (data) {
        pdfPath = data.pdf_url;
        resolvedContactId = resolvedContactId || data.contact_id;
        resolvedProjectId = data.project_id;
      }
    }

    // Generate a signed URL for the PDF if we have a storage path
    let documentUrl: string | null = null;
    if (pdfPath) {
      const { data: signedUrlData } = await supabase.storage
        .from("documents")
        .createSignedUrl(pdfPath, 60 * 60 * 24 * 30); // 30 days
      documentUrl = signedUrlData?.signedUrl || null;
    }

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expire_days);

    // Create signature envelope using actual table columns
    const { data: envelope, error: envelopeError } = await supabase
      .from("signature_envelopes")
      .insert({
        tenant_id: tenantId,
        title: documentTitle,
        estimate_id: document_type === 'estimate' ? document_id : null,
        contact_id: resolvedContactId,
        project_id: resolvedProjectId,
        pipeline_entry_id: resolvedPipelineEntryId,
        generated_pdf_path: pdfPath,
        status: "pending",
        expires_at: expiresAt.toISOString(),
        created_by: user.id,
      })
      .select()
      .single();

    if (envelopeError) {
      console.error("Error creating envelope:", envelopeError);
      throw envelopeError;
    }

    console.log(`Created envelope ${envelope.id} (${envelope.envelope_number})`);

    // Create recipients with access tokens
    const recipientPromises = recipients.map(async (recipient, index) => {
      const accessToken = crypto.randomUUID();
      
      const { data: recipientData, error: recipientError } = await supabase
        .from("signature_recipients")
        .insert({
          envelope_id: envelope.id,
          tenant_id: tenantId,
          recipient_name: recipient.name,
          recipient_email: recipient.email,
          recipient_role: recipient.role || "signer",
          signing_order: recipient.routing_order ?? index + 1,
          access_token: accessToken,
          status: "pending"
        })
        .select()
        .single();

      if (recipientError) {
        console.error("Error creating recipient:", recipientError);
        throw recipientError;
      }

      return { ...recipientData, access_token: accessToken };
    });

    const createdRecipients = await Promise.all(recipientPromises);

    // Link envelope to smart doc instance if applicable
    if (document_type === 'smart_doc_instance') {
      await supabase
        .from("smart_doc_instances")
        .update({ signature_envelope_id: envelope.id })
        .eq("id", document_id);
    }

    // Send email invitations to recipients
    const emailPromises = createdRecipients.map(async (recipient) => {
      try {
        await supabase.functions.invoke("email-signature-request", {
          body: {
            envelope_id: envelope.id,
            recipient_id: recipient.id,
            recipient_name: recipient.recipient_name,
            recipient_email: recipient.recipient_email,
            access_token: recipient.access_token,
            sender_name: `${profile!.first_name} ${profile!.last_name}`.trim(),
            sender_email: profile!.email,
            subject: documentTitle,
            message: email_message || "Please review and sign the attached document.",
            document_url: documentUrl,
            ...(cc?.length ? { cc } : {}),
            ...(bcc?.length ? { bcc } : {}),
          }
        });
        return { email: recipient.recipient_email, sent: true };
      } catch (error) {
        console.error(`Failed to send email to ${recipient.recipient_email}:`, error);
        return { email: recipient.recipient_email, sent: false, error: String(error) };
      }
    });

    const emailResults = await Promise.all(emailPromises);

    // Update envelope status to sent
    await supabase
      .from("signature_envelopes")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", envelope.id);

    // Log signature event
    await supabase
      .from("signature_events")
      .insert({
        envelope_id: envelope.id,
        tenant_id: tenantId,
        event_type: "envelope_sent",
        event_description: `Signature request sent to ${createdRecipients.length} recipient(s)`,
        event_metadata: {
          recipients: createdRecipients.map(r => ({ id: r.id, email: r.recipient_email })),
          email_results: emailResults,
          document_type,
        },
      });

    console.log(`Signature envelope ${envelope.envelope_number} sent successfully`);

    return new Response(JSON.stringify({
      success: true,
      envelope_id: envelope.id,
      envelope_number: envelope.envelope_number,
      recipients: createdRecipients.map(r => ({
        id: r.id,
        email: r.recipient_email,
        name: r.recipient_name,
      })),
      email_results: emailResults
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in send-document-for-signature:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
