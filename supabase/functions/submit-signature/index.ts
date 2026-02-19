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
  field_values?: Record<string, string>;
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only POST requests allowed', 405);
  }

  try {
    const supabase = createServiceClient();
    const { ip, userAgent } = getClientInfo(req);

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
      .select('id, envelope_id, recipient_name, recipient_email, status, tenant_id')
      .eq('access_token', body.access_token)
      .single();

    if (recipientError || !recipient) {
      console.error('Recipient lookup error:', recipientError);
      return errorResponse('NOT_FOUND', 'Invalid access token', 404);
    }

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

    if (envelope.status !== 'sent') {
      return errorResponse('INVALID_STATUS', `Cannot sign envelope with status: ${envelope.status}`, 400);
    }

    // Generate signature hash for tamper evidence
    const signatureHash = await hashToken(body.signature_data);

    // Upload signature image to storage (if drawn/uploaded)
    let imagePath: string | null = null;

    if (body.signature_type === 'drawn' || body.signature_type === 'uploaded') {
      try {
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
        } else {
          imagePath = fileName;
          console.log(`Signature image uploaded to: ${fileName}`);
        }
      } catch (uploadErr) {
        console.error('Failed to upload signature image:', uploadErr);
      }
    }

    // ---------------------------------------------------------------
    // INSERT using ACTUAL database columns:
    //   tenant_id, envelope_id, recipient_id, signature_data,
    //   signature_hash, signature_metadata, ip_address, is_valid
    // ---------------------------------------------------------------
    const { data: signature, error: signatureError } = await supabase
      .from('digital_signatures')
      .insert({
        tenant_id: envelope.tenant_id,
        envelope_id: envelope.id,
        recipient_id: recipient.id,
        signature_data: body.signature_data,
        signature_hash: signatureHash,
        signature_metadata: {
          signature_type: body.signature_type,
          consent_text: 'I agree to sign this document electronically',
          consent_agreed: body.consent_agreed,
          user_agent: userAgent?.substring(0, 300),
          image_path: imagePath,
          field_values: body.field_values,
        },
        ip_address: ip,
        is_valid: true,
      })
      .select('id, signed_at')
      .single();

    if (signatureError) {
      console.error('Signature insert error:', signatureError);
      return errorResponse('DATABASE_ERROR', 'Failed to save signature', 500);
    }

    console.log(`Signature saved: ${signature.id} for envelope ${envelope.id}`);

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
        : `${recipient.recipient_name} signed "${envelope.title}"`,
      action_url: `/signature-envelopes/${envelope.id}`,
      metadata: {
        envelope_id: envelope.id,
        recipient_id: recipient.id,
        signature_id: signature.id,
        all_signed: allSigned,
      },
    });

    // If all signed, call finalize-envelope via direct fetch with service role key
    if (allSigned) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        console.log(`All recipients signed — calling finalize-envelope for ${envelope.id}`);

        const finalizeResponse = await fetch(
          `${supabaseUrl}/functions/v1/finalize-envelope`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ envelope_id: envelope.id }),
          }
        );

        if (!finalizeResponse.ok) {
          const errText = await finalizeResponse.text();
          console.error('finalize-envelope call failed:', finalizeResponse.status, errText);
        } else {
          const result = await finalizeResponse.json();
          console.log('finalize-envelope succeeded:', JSON.stringify(result));
        }
      } catch (finalizeError) {
        console.error('Error calling finalize-envelope:', finalizeError);
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
