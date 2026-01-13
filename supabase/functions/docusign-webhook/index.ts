import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = supabaseService();

    // Get raw body for HMAC verification
    const rawBody = await req.arrayBuffer();
    const bodyText = new TextDecoder().decode(rawBody);
    
    // Verify HMAC signature
    const hmacSignature = req.headers.get('X-DocuSign-Signature-1');
    if (!hmacSignature) {
      console.log('Missing HMAC signature');
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    // Parse webhook payload
    const payload = JSON.parse(bodyText);
    console.log('DocuSign webhook received:', {
      event: payload.event,
      envelopeId: payload.data?.envelopeId,
    });

    if (!payload.event || !payload.data) {
      return new Response('Invalid payload', { status: 400, headers: corsHeaders });
    }

    const { event, data } = payload;
    const envelopeId = data.envelopeId;

    // Find agreement instance by envelope ID
    const { data: agreementInstance, error: instanceError } = await supabaseClient
      .from('agreement_instances')
      .select('*')
      .eq('envelope_id', envelopeId)
      .single();

    if (instanceError) {
      console.log('Agreement instance not found for envelope:', envelopeId);
      // Still acknowledge the webhook to avoid retries
      return new Response('OK', { status: 200, headers: corsHeaders });
    }

    // Log the event
    await supabaseClient
      .from('docusign_events')
      .insert({
        tenant_id: agreementInstance.tenant_id,
        agreement_instance_id: agreementInstance.id,
        envelope_id: envelopeId,
        event_type: event,
        payload_json: payload,
      });

    // Update agreement instance and recipients based on event type
    await handleDocuSignEvent(supabaseClient, event, data, agreementInstance);

    return new Response('OK', { status: 200, headers: corsHeaders });

  } catch (error) {
    console.error('DocuSign webhook error:', error);
    return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
  }
});

async function handleDocuSignEvent(supabaseClient: any, event: string, data: any, agreementInstance: any) {
  try {
    switch (event) {
      case 'envelope-sent':
        await supabaseClient
          .from('agreement_instances')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
          })
          .eq('id', agreementInstance.id);
        
        await supabaseClient
          .from('recipients')
          .update({ status: 'sent' })
          .eq('agreement_instance_id', agreementInstance.id);
        break;

      case 'envelope-delivered':
        await supabaseClient
          .from('agreement_instances')
          .update({ status: 'delivered' })
          .eq('id', agreementInstance.id);
        break;

      case 'envelope-completed':
        await supabaseClient
          .from('agreement_instances')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', agreementInstance.id);
        
        // Download and store signed documents
        await downloadSignedDocuments(supabaseClient, agreementInstance);
        break;

      case 'envelope-declined':
        await supabaseClient
          .from('agreement_instances')
          .update({ status: 'declined' })
          .eq('id', agreementInstance.id);
        break;

      case 'envelope-voided':
        await supabaseClient
          .from('agreement_instances')
          .update({ status: 'voided' })
          .eq('id', agreementInstance.id);
        break;

      case 'recipient-completed':
        if (data.recipientId) {
          await supabaseClient
            .from('recipients')
            .update({
              status: 'completed',
              signed_at: new Date().toISOString(),
            })
            .eq('agreement_instance_id', agreementInstance.id)
            .eq('recipient_id', data.recipientId);
        }
        break;

      case 'recipient-delivered':
        if (data.recipientId) {
          await supabaseClient
            .from('recipients')
            .update({ status: 'delivered' })
            .eq('agreement_instance_id', agreementInstance.id)
            .eq('recipient_id', data.recipientId);
        }
        break;

      case 'recipient-declined':
        if (data.recipientId) {
          await supabaseClient
            .from('recipients')
            .update({ status: 'declined' })
            .eq('agreement_instance_id', agreementInstance.id)
            .eq('recipient_id', data.recipientId);
        }
        break;

      default:
        console.log('Unhandled DocuSign event:', event);
    }
  } catch (error) {
    console.error('Error handling DocuSign event:', error);
  }
}

async function downloadSignedDocuments(supabaseClient: any, agreementInstance: any) {
  try {
    // This would typically download the signed PDF from DocuSign
    // and store it in Supabase Storage or another file storage service
    console.log('TODO: Download signed documents for envelope:', agreementInstance.envelope_id);
    
    // Placeholder for document download logic
    // In a real implementation, you would:
    // 1. Get access token
    // 2. Call DocuSign API to get documents
    // 3. Store documents in Supabase Storage
    // 4. Update documents table with signed PDF info
    
  } catch (error) {
    console.error('Error downloading signed documents:', error);
  }
}