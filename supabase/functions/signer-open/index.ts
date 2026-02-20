import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import {
  createServiceClient,
  logAuditEvent,
  createNotification,
  successResponse,
  errorResponse,
  handleCors,
  getClientInfo,
} from '../_shared/utils.ts';

// ============================================================================
// SIGNER OPEN - Validate recipient token and start signing session
// ============================================================================

interface SignerOpenRequest {
  access_token: string;
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
    const body: SignerOpenRequest = await req.json();
    
    if (!body.access_token) {
      return errorResponse('VALIDATION_ERROR', 'Missing access_token', 400);
    }

    // Look up recipient by access token
    const { data: recipient, error: recipientError } = await supabase
      .from('signature_recipients')
      .select(`
        id,
        envelope_id,
        recipient_name,
        recipient_email,
        status,
        signing_order,
        signed_at
      `)
      .eq('access_token', body.access_token)
      .single();

    if (recipientError || !recipient) {
      console.error('Recipient lookup error:', recipientError);
      return errorResponse('NOT_FOUND', 'Invalid access token', 404);
    }

    // Check if already signed
    if (recipient.status === 'signed') {
      return errorResponse('ALREADY_SIGNED', 'You have already signed this document', 400);
    }

    // Check if declined
    if (recipient.status === 'declined') {
      return errorResponse('DECLINED', 'You have declined to sign this document', 400);
    }

    // Get envelope details
    const { data: envelope, error: envelopeError } = await supabase
      .from('signature_envelopes')
      .select(`
        id,
        tenant_id,
        title,
        status,
        created_by,
        document_url,
        generated_pdf_path,
        expires_at
      `)
      .eq('id', recipient.envelope_id)
      .single();

    if (envelopeError || !envelope) {
      console.error('Envelope lookup error:', envelopeError);
      return errorResponse('NOT_FOUND', 'Envelope not found', 404);
    }

    // Check envelope status
    if (envelope.status === 'completed') {
      return errorResponse('COMPLETED', 'This envelope has already been completed', 400);
    }

    if (envelope.status === 'voided') {
      return errorResponse('VOIDED', 'This envelope has been voided', 400);
    }

    if (envelope.status === 'expired' || (envelope.expires_at && new Date(envelope.expires_at) < new Date())) {
      return errorResponse('EXPIRED', 'This signing request has expired', 410);
    }

    if (envelope.status === 'draft') {
      return errorResponse('NOT_SENT', 'This envelope has not been sent yet', 400);
    }

    // Update recipient status to viewed (if first view)
    const isFirstView = recipient.status !== 'viewed' && recipient.status !== 'signed';
    
    if (isFirstView) {
      await supabase
        .from('signature_recipients')
        .update({
          status: 'viewed',
        })
        .eq('id', recipient.id);

      // Notify sender that recipient opened envelope
      await createNotification(supabase, {
        tenant_id: envelope.tenant_id,
        user_id: envelope.created_by,
        type: 'envelope_viewed',
        title: 'Envelope Opened',
        message: `${recipient.recipient_name} (${recipient.recipient_email}) opened "${envelope.title}"`,
        action_url: `/signature-envelopes/${envelope.id}`,
        metadata: {
          envelope_id: envelope.id,
          recipient_id: recipient.id,
          recipient_name: recipient.recipient_name,
          recipient_email: recipient.recipient_email,
        },
      });
    }

    // Log audit event
    await logAuditEvent(supabase, {
      tenant_id: envelope.tenant_id,
      actor_type: 'external',
      action: isFirstView ? 'envelope.first_viewed' : 'envelope.viewed',
      target_type: 'signature_envelope',
      target_id: envelope.id,
      ip_address: ip,
      user_agent: userAgent,
      metadata: {
        recipient_id: recipient.id,
        recipient_email: recipient.recipient_email,
        is_first_view: isFirstView,
      },
    });

    // Get signature fields for this recipient
    const { data: fields } = await supabase
      .from('signature_fields')
      .select('*')
      .eq('envelope_id', envelope.id)
      .eq('recipient_id', recipient.id)
      .order('page_number', { ascending: true });

    // Generate a fresh signed URL for the PDF document
    let pdfUrl = envelope.document_url;
    
    if (envelope.generated_pdf_path) {
      // Always generate a fresh signed URL from the storage path
      try {
        const { data: signedData, error: signError } = await supabase.storage
          .from('documents')
          .createSignedUrl(envelope.generated_pdf_path, 3600); // 1 hour expiry
        
        if (!signError && signedData?.signedUrl) {
          pdfUrl = signedData.signedUrl;
        } else {
          console.warn('Failed to generate fresh signed URL, falling back to stored URL:', signError);
        }
      } catch (urlError) {
        console.warn('Error generating signed URL:', urlError);
      }
    }

    console.log(`Signer opened envelope: ${envelope.id}, recipient: ${recipient.id}, first view: ${isFirstView}`);

    return successResponse({
      envelope: {
        id: envelope.id,
        title: envelope.title,
        message: null,
        pdf_url: pdfUrl,
        status: envelope.status,
      },
      recipient: {
        id: recipient.id,
        name: recipient.recipient_name,
        email: recipient.recipient_email,
        status: isFirstView ? 'viewed' : recipient.status,
      },
      fields: fields || [],
      is_first_view: isFirstView,
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
});
