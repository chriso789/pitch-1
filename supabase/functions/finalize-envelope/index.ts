import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import {
  createServiceClient,
  hashToken,
  logAuditEvent,
  createNotification,
  successResponse,
  errorResponse,
  handleCors,
  getClientInfo,
} from '../_shared/utils.ts';

// ============================================================================
// FINALIZE ENVELOPE - Generate final PDF with signatures and complete envelope
// ============================================================================

interface FinalizeEnvelopeRequest {
  envelope_id: string;
}

serve(async (req: Request) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only POST requests allowed', 405);
  }

  try {
    const supabase = createServiceClient();
    const { ip, userAgent } = getClientInfo(req);

    // Parse input
    const body: FinalizeEnvelopeRequest = await req.json();
    
    if (!body.envelope_id) {
      return errorResponse('VALIDATION_ERROR', 'Missing envelope_id', 400);
    }

    // Get envelope
    const { data: envelope, error: envelopeError } = await supabase
      .from('signature_envelopes')
      .select('*')
      .eq('id', body.envelope_id)
      .single();

    if (envelopeError || !envelope) {
      console.error('Envelope lookup error:', envelopeError);
      return errorResponse('NOT_FOUND', 'Envelope not found', 404);
    }

    // Check if already completed
    if (envelope.status === 'completed') {
      return successResponse({
        message: 'Envelope already completed',
        envelope_id: envelope.id,
        signed_pdf_path: envelope.signed_pdf_path,
      });
    }

    // Verify all recipients have signed
    const { data: recipients, error: recipientsError } = await supabase
      .from('signature_recipients')
      .select('id, name, email, status, signed_at')
      .eq('envelope_id', envelope.id);

    if (recipientsError) {
      console.error('Recipients lookup error:', recipientsError);
      return errorResponse('DATABASE_ERROR', 'Failed to fetch recipients', 500);
    }

    const unsignedRecipients = recipients?.filter(r => r.status !== 'signed') || [];
    if (unsignedRecipients.length > 0) {
      return errorResponse('INCOMPLETE', 'Not all recipients have signed', 400, {
        unsigned_recipients: unsignedRecipients.map(r => ({ name: r.name, email: r.email })),
      });
    }

    // Get all signatures with their images
    const { data: signatures } = await supabase
      .from('digital_signatures')
      .select('*, recipient:signature_recipients(name, email)')
      .eq('envelope_id', envelope.id);

    console.log(`Processing ${signatures?.length || 0} signatures for envelope ${envelope.id}`);

    // Download the original PDF
    let signedPdfBytes: Uint8Array | null = null;
    let signedPdfPath: string | null = null;

    if (envelope.generated_pdf_path) {
      try {
        console.log(`Downloading original PDF from: ${envelope.generated_pdf_path}`);
        
        // Try to download from documents bucket first, then smartdoc-renditions
        let pdfData: Blob | null = null;
        
        const { data: docsPdf, error: docsErr } = await supabase.storage
          .from('documents')
          .download(envelope.generated_pdf_path);
        
        if (docsPdf && !docsErr) {
          pdfData = docsPdf;
        } else {
          const { data: smartPdf, error: smartErr } = await supabase.storage
            .from('smartdoc-renditions')
            .download(envelope.generated_pdf_path);
          
          if (smartPdf && !smartErr) {
            pdfData = smartPdf;
          } else {
            console.error('Could not download PDF from any bucket:', docsErr, smartErr);
          }
        }

        if (pdfData) {
          const pdfBytes = await pdfData.arrayBuffer();
          const pdfDoc = await PDFDocument.load(pdfBytes);
          
          // Add signature certificate page
          const certPage = pdfDoc.addPage([612, 792]);
          const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
          const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
          
          const { height } = certPage.getSize();
          
          // Header
          certPage.drawText('SIGNATURE CERTIFICATE', {
            x: 50,
            y: height - 60,
            size: 18,
            font: helveticaBold,
            color: rgb(0, 0.3, 0.6),
          });
          
          certPage.drawText(envelope.title || 'Document', {
            x: 50,
            y: height - 85,
            size: 12,
            font: helvetica,
            color: rgb(0.3, 0.3, 0.3),
          });
          
          // Divider line
          certPage.drawLine({
            start: { x: 50, y: height - 100 },
            end: { x: 562, y: height - 100 },
            thickness: 1,
            color: rgb(0.8, 0.8, 0.8),
          });
          
          let yPos = height - 140;
          
          // Add each signature
          for (const sig of signatures || []) {
            const recipientName = sig.recipient?.name || 'Unknown';
            const recipientEmail = sig.recipient?.email || '';
            
            certPage.drawText(`Signer: ${recipientName}`, {
              x: 50,
              y: yPos,
              size: 11,
              font: helveticaBold,
              color: rgb(0, 0, 0),
            });
            
            certPage.drawText(`Email: ${recipientEmail}`, {
              x: 50,
              y: yPos - 18,
              size: 10,
              font: helvetica,
              color: rgb(0.3, 0.3, 0.3),
            });
            
            certPage.drawText(`Signed: ${new Date(sig.signed_at).toLocaleString()}`, {
              x: 50,
              y: yPos - 34,
              size: 10,
              font: helvetica,
              color: rgb(0.3, 0.3, 0.3),
            });
            
            certPage.drawText(`IP Address: ${sig.ip_address || 'Unknown'}`, {
              x: 50,
              y: yPos - 50,
              size: 10,
              font: helvetica,
              color: rgb(0.3, 0.3, 0.3),
            });
            
            // Embed signature image if available
            if (sig.signature_image_path) {
              try {
                const { data: sigImageData } = await supabase.storage
                  .from('signatures')
                  .download(sig.signature_image_path);
                
                if (sigImageData) {
                  const sigBytes = new Uint8Array(await sigImageData.arrayBuffer());
                  let signatureImage;
                  
                  // Try PNG first, fall back to JPEG
                  try {
                    signatureImage = await pdfDoc.embedPng(sigBytes);
                  } catch {
                    signatureImage = await pdfDoc.embedJpg(sigBytes);
                  }
                  
                  const sigDims = signatureImage.scale(0.4);
                  certPage.drawImage(signatureImage, {
                    x: 300,
                    y: yPos - 60,
                    width: Math.min(sigDims.width, 200),
                    height: Math.min(sigDims.height, 60),
                  });
                }
              } catch (e) {
                console.log('Could not embed signature image:', e);
              }
            }
            
            // Consent statement
            certPage.drawText('✓ "I agree that this electronic signature is legally binding"', {
              x: 50,
              y: yPos - 75,
              size: 9,
              font: helvetica,
              color: rgb(0.2, 0.5, 0.2),
            });
            
            yPos -= 120;
          }
          
          // Footer with hash
          const pdfHash = sig.signature_hash || await hashToken(JSON.stringify({ envelope_id: envelope.id, signatures: signatures?.map(s => s.id) }));
          certPage.drawText(`Document Hash: ${pdfHash.substring(0, 32)}...`, {
            x: 50,
            y: 60,
            size: 8,
            font: helvetica,
            color: rgb(0.5, 0.5, 0.5),
          });
          
          certPage.drawText(`Generated: ${new Date().toISOString()}`, {
            x: 50,
            y: 45,
            size: 8,
            font: helvetica,
            color: rgb(0.5, 0.5, 0.5),
          });
          
          // Save the modified PDF
          signedPdfBytes = await pdfDoc.save();
          signedPdfPath = `${envelope.tenant_id}/${envelope.id}/signed_${Date.now()}.pdf`;
          
          // Upload to documents bucket
          const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(signedPdfPath, signedPdfBytes, {
              contentType: 'application/pdf',
              upsert: true,
            });
          
          if (uploadError) {
            console.error('Failed to upload signed PDF:', uploadError);
          } else {
            console.log(`Signed PDF uploaded to: ${signedPdfPath}`);
          }
        }
      } catch (pdfError) {
        console.error('Error processing PDF:', pdfError);
        // Continue without PDF - envelope can still be marked complete
      }
    }

    // Generate final PDF hash for tamper evidence
    const pdfContent = JSON.stringify({
      envelope_id: envelope.id,
      title: envelope.title,
      completed_at: new Date().toISOString(),
      recipients: recipients?.map(r => ({
        name: r.name,
        email: r.email,
        signed_at: r.signed_at,
      })),
      signatures: signatures?.map(s => ({
        id: s.id,
        signature_hash: s.signature_hash,
        signed_at: s.signed_at,
        ip_address: s.ip_address,
      })),
    });
    
    const finalPdfHash = await hashToken(pdfContent);

    // Update envelope with completion status and signed PDF path
    const { error: updateError } = await supabase
      .from('signature_envelopes')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        final_pdf_hash: finalPdfHash,
        signed_pdf_path: signedPdfPath,
      })
      .eq('id', envelope.id);

    if (updateError) {
      console.error('Envelope update error:', updateError);
      return errorResponse('DATABASE_ERROR', 'Failed to finalize envelope', 500);
    }

    // Create a document record for the signed PDF so it appears in Documents tab
    let documentId: string | null = null;
    if (signedPdfPath && signedPdfBytes) {
      const recipientNames = recipients?.map(r => r.name).join(', ') || 'Unknown';
      
      const { data: docRecord, error: docError } = await supabase
        .from('documents')
        .insert({
          tenant_id: envelope.tenant_id,
          pipeline_entry_id: envelope.pipeline_entry_id,
          filename: `${envelope.title || 'Document'} (Signed).pdf`,
          file_path: signedPdfPath,
          file_size: signedPdfBytes.byteLength,
          mime_type: 'application/pdf',
          document_type: 'contract',
          description: `Signed on ${new Date().toLocaleDateString()} by ${recipientNames}`,
          uploaded_by: null, // System-generated
        })
        .select('id')
        .single();
      
      if (docError) {
        console.error('Failed to create document record:', docError);
      } else {
        documentId = docRecord?.id;
        console.log(`Created document record: ${documentId}`);
      }
    }

    // Notify sender
    await createNotification(supabase, {
      tenant_id: envelope.tenant_id,
      user_id: envelope.created_by,
      type: 'envelope_completed',
      title: 'Envelope Completed',
      message: `"${envelope.title}" has been signed by all recipients`,
      action_url: `/signature-envelopes/${envelope.id}`,
      metadata: {
        envelope_id: envelope.id,
        completed_at: new Date().toISOString(),
        recipients_count: recipients?.length || 0,
        signed_pdf_path: signedPdfPath,
        document_id: documentId,
      },
    });

    // --- Send completion emails to all recipients AND the sender ---
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY && signedPdfPath) {
      try {
        // Get tenant info for branding
        const { data: tenant } = await supabase
          .from("tenants")
          .select("name, settings")
          .eq("id", envelope.tenant_id)
          .single();

        const tenantName = tenant?.name || "PITCH CRM";
        const tenantSettings = (tenant?.settings as Record<string, any>) || {};
        const primaryColor = tenantSettings.primary_color || "#2563eb";

        // Get company email domain
        const { data: emailDomain } = await supabase
          .from("company_email_domains")
          .select("*")
          .eq("tenant_id", envelope.tenant_id)
          .eq("verification_status", "verified")
          .eq("is_active", true)
          .maybeSingle();

        const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
        const fromEmail = emailDomain?.from_email || `signatures@${fromDomain}`;
        const fromName = emailDomain?.from_name || tenantName;

        // Generate a signed URL for the completed PDF
        const { data: signedUrlData } = await supabase.storage
          .from("documents")
          .createSignedUrl(signedPdfPath, 60 * 60 * 24 * 30); // 30 days

        const downloadUrl = signedUrlData?.signedUrl || "";

        // Build signature summary for the email
        const signatureSummary = (signatures || []).map(sig => {
          const recipientData = sig.recipient as any;
          return `
            <tr>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px;">${recipientData?.name || 'Unknown'}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px;">${recipientData?.email || ''}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px;">${sig.signed_at ? new Date(sig.signed_at).toLocaleString() : 'N/A'}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px;">${sig.ip_address || 'N/A'}</td>
            </tr>`;
        }).join('');

        const completionHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 40px 20px;">
      <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <tr><td style="background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); padding: 32px 40px; text-align: center;">
          <h1 style="margin: 0; color: #ffffff; font-size: 24px;">✅ Document Signed</h1>
        </td></tr>
        <tr><td style="padding: 40px;">
          <p style="margin: 0 0 16px; color: #374151; font-size: 16px; line-height: 1.6;">
            All parties have signed <strong>"${envelope.title || 'Document'}"</strong>. A copy of the signed document is attached below for your records.
          </p>
          <h3 style="margin: 24px 0 12px; color: #111827; font-size: 16px;">Signature Details</h3>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
            <thead><tr style="background-color: #f9fafb;">
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">Name</th>
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">Email</th>
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">Signed At</th>
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">IP Address</th>
            </tr></thead>
            <tbody>${signatureSummary}</tbody>
          </table>
          <table role="presentation" style="width: 100%; margin: 32px 0;">
            <tr><td style="text-align: center;">
              ${downloadUrl ? `<a href="${downloadUrl}" style="display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, #1e40af 100%); color: #ffffff; text-decoration: none; padding: 14px 36px; font-size: 16px; font-weight: 600; border-radius: 8px;">Download Signed Document</a>` : ''}
            </td></tr>
          </table>
          <p style="margin: 0; color: #6b7280; font-size: 12px;">Document Hash: ${finalPdfHash.substring(0, 32)}...</p>
        </td></tr>
        <tr><td style="background-color: #f9fafb; padding: 20px 40px; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">Sent via ${tenantName}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

        // Collect all email addresses: recipients + sender
        const emailAddresses: string[] = [];
        for (const r of recipients || []) {
          if (r.email) emailAddresses.push(r.email);
        }

        // Also get sender email
        if (envelope.created_by) {
          const { data: senderProfile } = await supabase
            .from("profiles")
            .select("email")
            .eq("id", envelope.created_by)
            .single();
          if (senderProfile?.email) emailAddresses.push(senderProfile.email);
        }

        // Send to each address
        for (const email of emailAddresses) {
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: `${fromName} <${fromEmail}>`,
                to: [email],
                subject: `✅ Signed: ${envelope.title || 'Document'}`,
                html: completionHtml,
              }),
            });
            console.log(`Completion email sent to ${email}`);
          } catch (emailErr) {
            console.error(`Failed to send completion email to ${email}:`, emailErr);
          }
        }
      } catch (emailError) {
        console.error("Error sending completion emails:", emailError);
      }
    }

    // Log audit event
    await logAuditEvent(supabase, {
      tenant_id: envelope.tenant_id,
      actor_type: 'system',
      action: 'envelope.completed',
      target_type: 'signature_envelope',
      target_id: envelope.id,
      ip_address: ip,
      user_agent: userAgent,
      metadata: {
        final_pdf_hash: finalPdfHash,
        recipients_count: recipients?.length || 0,
        signatures_count: signatures?.length || 0,
        signed_pdf_path: signedPdfPath,
        document_id: documentId,
      },
    });

    // Log individual signature events for compliance
    for (const sig of signatures || []) {
      await logAuditEvent(supabase, {
        tenant_id: envelope.tenant_id,
        actor_type: 'system',
        action: 'signature.finalized',
        target_type: 'digital_signature',
        target_id: sig.id,
        metadata: {
          envelope_id: envelope.id,
          signature_hash: sig.signature_hash,
          recipient_id: sig.recipient_id,
        },
      });
    }

    console.log(`Envelope finalized: ${envelope.id}, recipients: ${recipients?.length}, hash: ${finalPdfHash.substring(0, 16)}...`);

    return successResponse({
      envelope_id: envelope.id,
      status: 'completed',
      completed_at: new Date().toISOString(),
      final_pdf_hash: finalPdfHash,
      signed_pdf_path: signedPdfPath,
      document_id: documentId,
      recipients_count: recipients?.length || 0,
      signatures_count: signatures?.length || 0,
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
});
