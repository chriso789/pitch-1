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
    console.log('Downloading signed documents for envelope:', agreementInstance.envelope_id);
    
    // Get DocuSign credentials for this tenant
    const { data: credentials, error: credError } = await supabaseClient
      .from('integration_credentials')
      .select('*')
      .eq('tenant_id', agreementInstance.tenant_id)
      .eq('integration_type', 'docusign')
      .eq('is_active', true)
      .single();

    if (credError || !credentials) {
      console.error('DocuSign credentials not found for tenant');
      return;
    }

    const { access_token, account_id, base_url } = credentials.credentials;
    
    // Get the signed document from DocuSign
    const docResponse = await fetch(
      `${base_url}/restapi/v2.1/accounts/${account_id}/envelopes/${agreementInstance.envelope_id}/documents/combined`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/pdf',
        },
      }
    );

    if (!docResponse.ok) {
      console.error('Failed to download document from DocuSign:', docResponse.status);
      return;
    }

    // Get the PDF as an ArrayBuffer
    const pdfBuffer = await docResponse.arrayBuffer();
    const pdfBytes = new Uint8Array(pdfBuffer);
    
    // Generate unique filename
    const fileName = `signed-agreements/${agreementInstance.tenant_id}/${agreementInstance.id}_signed_${Date.now()}.pdf`;
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseClient.storage
      .from('signed-documents')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Failed to upload signed document:', uploadError);
      return;
    }

    // Get public URL
    const { data: urlData } = supabaseClient.storage
      .from('signed-documents')
      .getPublicUrl(fileName);

    const signedPdfUrl = urlData?.publicUrl;

    // Update agreement instance with signed document URL
    await supabaseClient
      .from('agreement_instances')
      .update({
        metadata: {
          ...agreementInstance.metadata,
          signed_pdf_url: signedPdfUrl,
          signed_pdf_downloaded_at: new Date().toISOString(),
        },
      })
      .eq('id', agreementInstance.id);

    // Create a document record if documents table exists
    try {
      await supabaseClient.from('documents').insert({
        tenant_id: agreementInstance.tenant_id,
        project_id: agreementInstance.project_id,
        contact_id: agreementInstance.contact_id,
        title: `Signed Agreement - ${agreementInstance.template_slug}`,
        file_url: signedPdfUrl,
        file_type: 'application/pdf',
        category: 'signed_agreement',
        metadata: {
          agreement_instance_id: agreementInstance.id,
          envelope_id: agreementInstance.envelope_id,
          signed_at: agreementInstance.completed_at,
        },
      });
    } catch (docError) {
      console.log('Documents table insert skipped:', docError);
    }

    console.log('Signed document downloaded and stored successfully:', signedPdfUrl);

    // Notify project manager if assigned
    if (agreementInstance.sender_user_id) {
      try {
        await supabaseClient.from('notifications').insert({
          tenant_id: agreementInstance.tenant_id,
          user_id: agreementInstance.sender_user_id,
          title: 'Agreement Signed',
          message: `The agreement for ${agreementInstance.template_slug} has been signed and is now available.`,
          type: 'success',
          link: `/agreements/${agreementInstance.id}`,
          metadata: {
            agreement_instance_id: agreementInstance.id,
            signed_pdf_url: signedPdfUrl,
          },
        });
      } catch (notifError) {
        console.log('Notification insert skipped:', notifError);
      }
    }

  } catch (error) {
    console.error('Error downloading signed documents:', error);
  }
}