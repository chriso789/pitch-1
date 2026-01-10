// ============================================================================
// REPORT PACKET SIGN
// Captures signature and generates signed PDF
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SignRequest {
  viewer_token: string;
  signer_name: string;
  signer_email: string;
  signature_data: string; // Base64 PNG or stroke data
  signature_type: 'drawn' | 'typed' | 'uploaded';
  consent_agreed: boolean;
  consent_text?: string;
  browser_info?: {
    screen_resolution?: string;
    timezone?: string;
    language?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: SignRequest = await req.json();
    const { 
      viewer_token, 
      signer_name, 
      signer_email, 
      signature_data, 
      signature_type,
      consent_agreed,
      consent_text,
      browser_info 
    } = body;

    // Validation
    if (!viewer_token || !signer_name || !signer_email || !signature_data || !consent_agreed) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'All fields required and consent must be agreed' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(signer_email)) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'INVALID_EMAIL', message: 'Invalid email format' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get viewer and packet
    const { data: viewer, error: viewerError } = await supabase
      .from('report_packet_viewers')
      .select('id, tenant_id, packet_id, is_revoked')
      .eq('viewer_token', viewer_token)
      .single();

    if (viewerError || !viewer || viewer.is_revoked) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or revoked token' } }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get packet
    const { data: packet, error: packetError } = await supabase
      .from('report_packets')
      .select('*')
      .eq('id', viewer.packet_id)
      .single();

    if (packetError || !packet) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'PACKET_NOT_FOUND', message: 'Report not found' } }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already signed
    if (packet.status === 'signed') {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ALREADY_SIGNED', message: 'This report has already been signed' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check expiration
    if (packet.expires_at && new Date(packet.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'PACKET_EXPIRED', message: 'This report has expired' } }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get client info
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    const signedAt = new Date().toISOString();

    // Build audit trail
    const auditTrail = {
      timestamp: signedAt,
      ip: clientIp,
      user_agent: userAgent,
      consent_text: consent_text || 'I agree that this signature is legally binding and represents my acceptance of the terms outlined in this document.',
      consent_agreed: true,
      signer_name,
      signer_email,
      signature_type,
      packet_version: packet.render_version,
      packet_hash: packet.final_pdf_hash,
      browser_info: browser_info || {},
      verification_method: 'email_link'
    };

    // Save signature image to storage
    let signatureImagePath: string | null = null;
    if (signature_data.startsWith('data:image')) {
      const base64Data = signature_data.split(',')[1];
      const signatureBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      
      signatureImagePath = `${viewer.tenant_id}/${viewer.packet_id}/signature-${Date.now()}.png`;
      await supabase.storage
        .from('report-packets')
        .upload(signatureImagePath, signatureBytes, {
          contentType: 'image/png'
        });
    }

    // Generate signed PDF with signature certificate
    let signedPdfPath: string | null = null;
    let signedPdfHash: string | null = null;

    if (packet.final_pdf_storage_path) {
      try {
        // Download original PDF
        const { data: originalPdf } = await supabase.storage
          .from('report-packets')
          .download(packet.final_pdf_storage_path);

        if (originalPdf) {
          const pdfBytes = await originalPdf.arrayBuffer();
          const pdfDoc = await PDFDocument.load(pdfBytes);
          
          // Add signature certificate page
          const certPage = pdfDoc.addPage([612, 792]);
          const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
          const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
          
          const { width, height } = certPage.getSize();

          // Header
          certPage.drawRectangle({
            x: 0,
            y: height - 80,
            width,
            height: 80,
            color: rgb(0.08, 0.46, 0.08) // Green for signed
          });

          certPage.drawText('SIGNATURE CERTIFICATE', {
            x: 50,
            y: height - 50,
            size: 20,
            font: helveticaBold,
            color: rgb(1, 1, 1)
          });

          // Certificate content
          let yPos = height - 130;

          certPage.drawText('Document Signed Electronically', {
            x: 50,
            y: yPos,
            size: 16,
            font: helveticaBold,
            color: rgb(0.2, 0.2, 0.2)
          });
          yPos -= 40;

          const certFields = [
            ['Signer Name:', signer_name],
            ['Signer Email:', signer_email],
            ['Signed At:', new Date(signedAt).toLocaleString('en-US', { 
              dateStyle: 'full', 
              timeStyle: 'long' 
            })],
            ['IP Address:', clientIp],
            ['Document Version:', `v${packet.render_version}`],
            ['Document Hash:', packet.final_pdf_hash?.substring(0, 32) + '...']
          ];

          for (const [label, value] of certFields) {
            certPage.drawText(label, {
              x: 50,
              y: yPos,
              size: 11,
              font: helveticaBold,
              color: rgb(0.3, 0.3, 0.3)
            });
            certPage.drawText(String(value), {
              x: 180,
              y: yPos,
              size: 11,
              font: helvetica,
              color: rgb(0.2, 0.2, 0.2)
            });
            yPos -= 25;
          }

          // Consent text
          yPos -= 20;
          certPage.drawText('Consent Statement:', {
            x: 50,
            y: yPos,
            size: 11,
            font: helveticaBold,
            color: rgb(0.3, 0.3, 0.3)
          });
          yPos -= 20;
          
          const consentLines = (consent_text || auditTrail.consent_text).match(/.{1,80}/g) || [];
          for (const line of consentLines.slice(0, 3)) {
            certPage.drawText(line, {
              x: 50,
              y: yPos,
              size: 10,
              font: helvetica,
              color: rgb(0.4, 0.4, 0.4)
            });
            yPos -= 15;
          }

          // Embed signature image if available
          if (signature_data.startsWith('data:image')) {
            try {
              const base64Data = signature_data.split(',')[1];
              const signatureBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
              const signatureImage = await pdfDoc.embedPng(signatureBytes);
              
              const sigDims = signatureImage.scale(0.5);
              certPage.drawImage(signatureImage, {
                x: 50,
                y: yPos - 100,
                width: Math.min(sigDims.width, 300),
                height: Math.min(sigDims.height, 80)
              });
            } catch (e) {
              console.log('Could not embed signature image:', e);
            }
          }

          // Footer
          certPage.drawText('This document was electronically signed using PITCH CRM', {
            x: 50,
            y: 60,
            size: 9,
            font: helvetica,
            color: rgb(0.5, 0.5, 0.5)
          });
          certPage.drawText(`Certificate ID: ${viewer.packet_id}`, {
            x: 50,
            y: 45,
            size: 9,
            font: helvetica,
            color: rgb(0.5, 0.5, 0.5)
          });

          // Save signed PDF
          const signedPdfBytes = await pdfDoc.save();
          const hashBuffer = await crypto.subtle.digest('SHA-256', signedPdfBytes);
          signedPdfHash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

          signedPdfPath = `${viewer.tenant_id}/${viewer.packet_id}/signed-${Date.now()}.pdf`;
          await supabase.storage
            .from('report-packets')
            .upload(signedPdfPath, signedPdfBytes, {
              contentType: 'application/pdf'
            });

          // Create file record
          await supabase.from('report_packet_files').insert({
            tenant_id: viewer.tenant_id,
            packet_id: viewer.packet_id,
            kind: 'signed_pdf',
            storage_path: signedPdfPath,
            storage_bucket: 'report-packets',
            filename: 'signed-document.pdf',
            content_type: 'application/pdf',
            byte_size: signedPdfBytes.byteLength,
            sha256: signedPdfHash,
            page_count: pdfDoc.getPageCount()
          });
        }
      } catch (e) {
        console.error('Error generating signed PDF:', e);
      }
    }

    // Create signature record
    const { data: signature, error: sigError } = await supabase
      .from('report_packet_signatures')
      .insert({
        tenant_id: viewer.tenant_id,
        packet_id: viewer.packet_id,
        viewer_id: viewer.id,
        signer_name,
        signer_email,
        signature_image_path: signatureImagePath,
        signed_at: signedAt,
        ip: clientIp,
        user_agent: userAgent,
        consent_checked: true,
        consent_text: consent_text || auditTrail.consent_text,
        packet_render_version_signed: packet.render_version,
        packet_hash_signed: packet.final_pdf_hash || '',
        audit_trail: auditTrail,
        signed_pdf_storage_path: signedPdfPath,
        signed_pdf_hash: signedPdfHash
      })
      .select('id')
      .single();

    if (sigError) {
      console.error('Signature insert error:', sigError);
      return new Response(
        JSON.stringify({ success: false, error: { code: 'SIGNATURE_ERROR', message: 'Failed to save signature' } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update packet status
    await supabase
      .from('report_packets')
      .update({ status: 'signed', updated_at: signedAt })
      .eq('id', viewer.packet_id);

    // Log events
    await supabase.from('report_packet_events').insert({
      tenant_id: viewer.tenant_id,
      packet_id: viewer.packet_id,
      event_type: 'signature_completed',
      actor_type: 'external_viewer',
      viewer_id: viewer.id,
      meta: {
        signature_id: signature?.id,
        signer_name,
        signer_email,
        ip: clientIp
      }
    });

    // Send confirmation email to signer
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (resendApiKey) {
      const branding = packet.branding_snapshot as Record<string, string>;
      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'reports@pitchcrm.io';

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `${branding?.company_name || 'PITCH CRM'} <${fromEmail}>`,
            to: [signer_email],
            subject: 'Document Signed Successfully',
            html: `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #15803d; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0;">✓ Document Signed</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb;">
    <p>Hi ${signer_name},</p>
    <p>Your signature has been recorded successfully.</p>
    <p><strong>Signed at:</strong> ${new Date(signedAt).toLocaleString()}</p>
    <p><strong>Document:</strong> ${packet.title}</p>
    <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
      A copy of the signed document will be sent to you for your records.
    </p>
  </div>
</body>
</html>`
          })
        });
      } catch (e) {
        console.log('Could not send confirmation email:', e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          signature_id: signature?.id,
          signed_at: signedAt,
          signed_pdf_available: !!signedPdfPath
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
