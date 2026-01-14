import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Max attachment size for Resend (approximately 7MB to be safe)
const MAX_ATTACHMENT_SIZE = 7 * 1024 * 1024;

interface SendEmailRequest {
  to: string[];
  subject: string;
  body: string;
  contactId?: string;
  cc?: string[];
  bcc?: string[];
  document_ids?: string[]; // IDs of documents to attach
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { to, subject, body, contactId, cc, bcc, document_ids }: SendEmailRequest = await req.json();

    if (!to || to.length === 0 || !subject || !body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, subject, body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get sender's profile for email signature
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, email, company_name, tenant_id")
      .eq("id", user.id)
      .single();

    // Fetch and prepare document attachments if requested
    const attachments: Array<{ filename: string; content: string }> = [];
    const attachmentLinks: Array<{ filename: string; url: string }> = [];
    
    if (document_ids && document_ids.length > 0 && profile?.tenant_id) {
      console.log("Fetching documents for attachment:", document_ids);
      
      // Fetch document records
      const { data: documents, error: docError } = await supabase
        .from("documents")
        .select("id, filename, file_path, file_size, mime_type")
        .in("id", document_ids)
        .eq("tenant_id", profile.tenant_id);
      
      if (docError) {
        console.error("Error fetching documents:", docError);
      } else if (documents) {
        for (const doc of documents) {
          try {
            // Check if file size is within limits
            if (doc.file_size && doc.file_size > MAX_ATTACHMENT_SIZE) {
              // Generate a signed URL for large files
              const { data: signedUrlData } = await supabase.storage
                .from("documents")
                .createSignedUrl(doc.file_path, 60 * 60 * 24 * 7); // 7 days
              
              if (signedUrlData?.signedUrl) {
                attachmentLinks.push({
                  filename: doc.filename,
                  url: signedUrlData.signedUrl
                });
                console.log(`Document ${doc.filename} too large, will include as link`);
              }
            } else {
              // Download and attach the file
              const { data: fileData, error: downloadError } = await supabase.storage
                .from("documents")
                .download(doc.file_path);
              
              if (downloadError) {
                console.error(`Error downloading ${doc.filename}:`, downloadError);
                continue;
              }
              
              if (fileData) {
                // Convert to base64
                const arrayBuffer = await fileData.arrayBuffer();
                const base64Content = btoa(
                  String.fromCharCode(...new Uint8Array(arrayBuffer))
                );
                
                attachments.push({
                  filename: doc.filename,
                  content: base64Content
                });
                console.log(`Attached document: ${doc.filename}`);
              }
            }
          } catch (attachError) {
            console.error(`Error processing attachment ${doc.filename}:`, attachError);
          }
        }
      }
    }

    const repName = `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim();
    const repEmail = profile?.email || user.email;
    const companyName = profile?.company_name || "Your Company";
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";

    // Handle empty name to avoid malformed "from" field
    const fromAddress = repName 
      ? `${repName} <noreply@${fromDomain}>`
      : `noreply@${fromDomain}`;
    const replyTo = repEmail;

    console.log("Attempting to send email:", {
      from: fromAddress,
      to,
      subject,
      replyTo,
      fromDomain
    });

    // Build attachment links section for large files
    let attachmentLinksHtml = "";
    if (attachmentLinks.length > 0) {
      attachmentLinksHtml = `
        <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 8px;">
          <p style="margin: 0 0 10px 0; font-weight: bold;">📎 Additional Attachments (click to download):</p>
          <ul style="margin: 0; padding-left: 20px;">
            ${attachmentLinks.map(link => `<li><a href="${link.url}" style="color: #2563eb;">${link.filename}</a></li>`).join("")}
          </ul>
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #666;">Links expire in 7 days</p>
        </div>
      `;
    }

    // Send email via Resend
    const emailResponse = await resend.emails.send({
      from: fromAddress,
      replyTo: replyTo,
      to,
      cc,
      bcc,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          ${body.replace(/\n/g, "<br>")}
          ${attachmentLinksHtml}
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="margin: 0;"><strong>${repName}</strong></p>
            ${companyName ? `<p style="margin: 5px 0 0 0; color: #666;">${companyName}</p>` : ""}
            <p style="margin: 5px 0 0 0; color: #666;">${repEmail}</p>
          </div>
        </div>
      `,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    // Check for Resend errors BEFORE returning success
    if (emailResponse.error) {
      console.error("Resend API error:", emailResponse.error);
      return new Response(
        JSON.stringify({
          error: "Email failed to send",
          details: emailResponse.error.message,
          code: emailResponse.error.name,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const resendMessageId = emailResponse.data?.id;
    console.log("Email sent successfully. Resend ID:", resendMessageId);

    // Log to communication history with resend_message_id for tracking
    if (contactId && profile?.tenant_id) {
      const { error: logError } = await supabase.from("communication_history").insert({
        tenant_id: profile.tenant_id,
        contact_id: contactId,
        communication_type: "email",
        direction: "outbound",
        subject,
        content: body,
        rep_id: user.id,
        resend_message_id: resendMessageId,
        email_status: "sent",
        metadata: {
          to,
          cc,
          bcc,
          email_id: resendMessageId,
          attached_documents: document_ids || [],
          attachment_count: attachments.length,
          link_count: attachmentLinks.length,
        },
      });

      if (logError) {
        console.error("Failed to log email to communication_history:", logError);
      } else {
        console.log("Email logged with resend_message_id:", resendMessageId);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email sent successfully",
        emailId: resendMessageId,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-email function:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to send email",
        details: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);