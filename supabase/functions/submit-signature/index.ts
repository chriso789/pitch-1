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
// SUBMIT SIGNATURE - Process and store signature, update recipient status
// ============================================================================

interface SubmitSignatureRequest {
  access_token: string;
  signature_data: string; // Base64 encoded image or typed name
  signature_type: 'drawn' | 'typed' | 'uploaded';
  consent_agreed: boolean;
  field_values?: Record<string, string>; // Optional form field values
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
    const body: SubmitSignatureRequest = await req.json();
    
    if (!body.access_token) {
      return errorResponse('VALIDATION_ERROR', 'Missing access_token', 400);
    }

    if (!body.signature_data) {
      return errorResponse('VALIDATION_ERROR', 'Missing signature_data', 400);
    }

    if (!body.consent_agreed) {
      return errorResponse('CONSENT_REQUIRED', 'You must agree to the e-signature consent', 400);
    }

    const validSignatureTypes = ['drawn', 'typed', 'uploaded'];
    if (!validSignatureTypes.includes(body.signature_type)) {
      return errorResponse('VALIDATION_ERROR', `Invalid signature_type. Must be one of: ${validSignatureTypes.join(', ')}`, 400);
    }

    // Look up recipient by access token
    const { data: recipient, error: recipientError } = await supabase
      .from('signature_recipients')
      .select('id, envelope_id, name, email, status')
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

    // Get envelope
    const { data: envelope, error: envelopeError } = await supabase
      .from('signature_envelopes')
      .select('id, tenant_id, title, status, created_by')
      .eq('id', recipient.envelope_id)
      .single();

    if (envelopeError || !envelope) {
      console.error('Envelope lookup error:', envelopeError);
      return errorResponse('NOT_FOUND', 'Envelope not found', 404);
    }

    // Validate envelope status
    if (envelope.status !== 'sent') {
      return errorResponse('INVALID_STATUS', `Cannot sign envelope with status: ${envelope.status}`, 400);
    }

    // Generate signature hash for tamper evidence
    const signatureHash = await hashToken(body.signature_data);

    // Store signature image in Supabase Storage (if drawn/uploaded)
    let imageUrl: string | null = null;
    
    if (body.signature_type === 'drawn' || body.signature_type === 'uploaded') {
      // Decode base64 and upload
      const base64Data = body.signature_data.replace(/^data:image\/\w+;base64,/, '');
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      
      const fileName = `${envelope.tenant_id}/${envelope.id}/${recipient.id}_signature.png`;
      
      const { error: uploadError } = await supabase.storage
        .from('signatures')
        .upload(fileName, binaryData, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadError) {
        console.error('Signature upload error:', uploadError);
        // Continue without storage - use inline data
      } else {
        const { data: urlData } = supabase.storage
          .from('signatures')
          .getPublicUrl(fileName);
        imageUrl = urlData.publicUrl;
      }
    }

    // Create signature record
    const { data: signature, error: signatureError } = await supabase
      .from('digital_signatures')
      .insert({
        envelope_id: envelope.id,
        recipient_id: recipient.id,
        signature_type: body.signature_type,
        signature_data: body.signature_type === 'typed' ? body.signature_data : null,
        image_url: imageUrl,
        signature_hash: signatureHash,
        ip_address: ip,
        user_agent: userAgent,
        consent_text: 'I agree to sign this document electronically',
        metadata: {
          field_values: body.field_values,
        },
      })
      .select('id, signed_at')
      .single();

    if (signatureError) {
      console.error('Signature insert error:', signatureError);
      return errorResponse('DATABASE_ERROR', 'Failed to save signature', 500);
    }

    // Update recipient status to signed
    await supabase
      .from('signature_recipients')
      .update({
        status: 'signed',
        signed_at: new Date().toISOString(),
      })
      .eq('id', recipient.id);

    // Check if all recipients have signed
    const { data: allRecipients } = await supabase
      .from('signature_recipients')
      .select('id, status')
      .eq('envelope_id', envelope.id);

    const allSigned = allRecipients?.every(r => r.status === 'signed') || false;

    // Notify sender
    await createNotification(supabase, {
      tenant_id: envelope.tenant_id,
      user_id: envelope.created_by,
      type: 'signature_received',
      title: allSigned ? 'Envelope Completed' : 'Signature Received',
      message: allSigned 
        ? `All recipients have signed "${envelope.title}"`
        : `${recipient.name} signed "${envelope.title}"`,
      action_url: `/signature-envelopes/${envelope.id}`,
      metadata: {
        envelope_id: envelope.id,
        recipient_id: recipient.id,
        signature_id: signature.id,
        all_signed: allSigned,
      },
    });

    // If all signed, trigger finalization
    if (allSigned) {
      // Call finalize-envelope function
      try {
        const response = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/finalize-envelope`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ envelope_id: envelope.id }),
          }
        );
        
        if (!response.ok) {
          console.error('Failed to trigger finalization:', await response.text());
        }
      } catch (error) {
        console.error('Error triggering finalization:', error);
      }
    }

    // Log audit event
    await logAuditEvent(supabase, {
      tenant_id: envelope.tenant_id,
      actor_type: 'external',
      action: 'signature.submitted',
      target_type: 'signature_envelope',
      target_id: envelope.id,
      ip_address: ip,
      user_agent: userAgent,
      metadata: {
        recipient_id: recipient.id,
        signature_id: signature.id,
        signature_type: body.signature_type,
        signature_hash: signatureHash,
        all_signed: allSigned,
      },
    });

    console.log(`Signature submitted: ${signature.id} for envelope ${envelope.id}, all signed: ${allSigned}`);

    return successResponse({
      signature: {
        id: signature.id,
        signed_at: signature.signed_at,
      },
      envelope_status: allSigned ? 'completed' : 'in_progress',
      all_recipients_signed: allSigned,
    }, 201);

  } catch (error) {
    console.error('Unexpected error:', error);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
});
