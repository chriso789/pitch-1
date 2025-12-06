import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
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
        final_pdf_url: envelope.final_pdf_url,
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

    // Get all signatures
    const { data: signatures } = await supabase
      .from('digital_signatures')
      .select('*')
      .eq('envelope_id', envelope.id);

    // Generate final PDF hash for tamper evidence
    // In production, this would merge signatures onto the PDF using pdf-lib
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

    // Store final PDF (in production, this would be the actual merged PDF)
    const finalPdfFileName = `${envelope.tenant_id}/${envelope.id}/final_signed.pdf`;
    
    // For now, we'll just update the envelope status
    // In production, use pdf-lib to flatten signatures onto the PDF
    const { error: updateError } = await supabase
      .from('signature_envelopes')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        final_pdf_hash: finalPdfHash,
        // final_pdf_url would be set after actual PDF generation
      })
      .eq('id', envelope.id);

    if (updateError) {
      console.error('Envelope update error:', updateError);
      return errorResponse('DATABASE_ERROR', 'Failed to finalize envelope', 500);
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
      },
    });

    // Notify all recipients with completion
    for (const recipient of recipients || []) {
      // In production, send email with final PDF attached
      console.log(`Would send completion email to: ${recipient.email}`);
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
      recipients_count: recipients?.length || 0,
      signatures_count: signatures?.length || 0,
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
});
