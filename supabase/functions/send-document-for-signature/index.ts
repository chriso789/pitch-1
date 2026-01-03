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
      .select("tenant_id, first_name, last_name, email")
      .eq("id", user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "No tenant found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: RequestBody = await req.json();
    const { document_id, document_type, recipients, email_subject, email_message, expire_days = 30 } = body;

    if (!document_id || !recipients?.length) {
      return new Response(JSON.stringify({ error: "document_id and recipients required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Creating signature envelope for ${document_type} ${document_id}`);

    // Fetch document metadata based on type
    let documentData: any = null;
    let pdfUrl: string | null = null;
    let contactId: string | null = null;
    let projectId: string | null = null;

    if (document_type === 'smart_doc_instance') {
      const { data } = await supabase
        .from("smart_doc_instances")
        .select("*, contact:contact_id(*), project:project_id(*)")
        .eq("id", document_id)
        .single();
      documentData = data;
      pdfUrl = data?.pdf_url;
      contactId = data?.contact_id;
      projectId = data?.project_id;
    } else if (document_type === 'estimate') {
      const { data } = await supabase
        .from("estimates")
        .select("*, contact:contact_id(*), project:project_id(*)")
        .eq("id", document_id)
        .single();
      documentData = data;
      pdfUrl = data?.pdf_url;
      contactId = data?.contact_id;
      projectId = data?.project_id;
    } else if (document_type === 'proposal') {
      const { data } = await supabase
        .from("proposals")
        .select("*, contact:contact_id(*), project:project_id(*)")
        .eq("id", document_id)
        .single();
      documentData = data;
      pdfUrl = data?.pdf_url;
      contactId = data?.contact_id;
      projectId = data?.project_id;
    }

    if (!documentData) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate PDF if not already created
    if (!pdfUrl && document_type === 'smart_doc_instance') {
      console.log("Generating PDF for smart doc instance...");
      const pdfResponse = await supabase.functions.invoke("smart-docs-pdf", {
        body: {
          instance_id: document_id,
          upload: "signed",
          filename: `document-${document_id}.pdf`
        }
      });
      
      if (pdfResponse.data?.pdf_url) {
        pdfUrl = pdfResponse.data.pdf_url;
        // Update instance with PDF URL
        await supabase
          .from("smart_doc_instances")
          .update({ pdf_url: pdfUrl })
          .eq("id", document_id);
      }
    }

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expire_days);

    // Create signature envelope
    const { data: envelope, error: envelopeError } = await supabase
      .from("signature_envelopes")
      .insert({
        tenant_id: profile.tenant_id,
        contact_id: contactId,
        project_id: projectId,
        document_type,
        document_id,
        document_url: pdfUrl,
        subject: email_subject || "Please sign this document",
        message: email_message || "Please review and sign the attached document.",
        status: "pending",
        expires_at: expiresAt.toISOString(),
        sent_by: user.id,
        metadata: {
          document_type,
          original_document_id: document_id
        }
      })
      .select()
      .single();

    if (envelopeError) {
      console.error("Error creating envelope:", envelopeError);
      throw envelopeError;
    }

    console.log(`Created envelope ${envelope.id}`);

    // Create recipients with access tokens
    const recipientPromises = recipients.map(async (recipient, index) => {
      const accessToken = crypto.randomUUID();
      
      const { data: recipientData, error: recipientError } = await supabase
        .from("signature_recipients")
        .insert({
          envelope_id: envelope.id,
          tenant_id: profile.tenant_id,
          name: recipient.name,
          email: recipient.email,
          role: recipient.role || "signer",
          routing_order: recipient.routing_order ?? index + 1,
          access_token: accessToken,
          status: "pending"
        })
        .select()
        .single();

      if (recipientError) {
        console.error("Error creating recipient:", recipientError);
        throw recipientError;
      }

      return {
        ...recipientData,
        signing_url: `${supabaseUrl.replace('.supabase.co', '.supabase.co')}/sign/${accessToken}`
      };
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
            recipient_name: recipient.name,
            recipient_email: recipient.email,
            access_token: recipient.access_token,
            sender_name: `${profile.first_name} ${profile.last_name}`.trim(),
            sender_email: profile.email,
            subject: email_subject || "Please sign this document",
            message: email_message || "Please review and sign the attached document.",
            document_url: pdfUrl
          }
        });
        return { email: recipient.email, sent: true };
      } catch (error) {
        console.error(`Failed to send email to ${recipient.email}:`, error);
        return { email: recipient.email, sent: false, error: String(error) };
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
        tenant_id: profile.tenant_id,
        event_type: "envelope_sent",
        event_data: {
          recipients: createdRecipients.map(r => ({ id: r.id, email: r.email })),
          email_results: emailResults
        },
        created_by: user.id
      });

    console.log(`Signature envelope ${envelope.id} created and sent successfully`);

    return new Response(JSON.stringify({
      success: true,
      envelope_id: envelope.id,
      recipients: createdRecipients.map(r => ({
        id: r.id,
        email: r.email,
        name: r.name,
        signing_url: r.signing_url
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
