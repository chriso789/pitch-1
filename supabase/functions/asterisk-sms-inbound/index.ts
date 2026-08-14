import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import {
  unauthorizedResponse,
  verifySharedSecretOrThrow,
  WebhookVerificationError,
} from "../_shared/webhook-verify.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Fail-closed: only the configured telephony bridge may post inbound SMS.
  try {
    verifySharedSecretOrThrow({
      req,
      secret: Deno.env.get('ASTERISK_WEBHOOK_SECRET') ?? '',
      secretName: 'ASTERISK_WEBHOOK_SECRET',
      headerNames: ['x-webhook-secret', 'x-asterisk-secret'],
    });
  } catch (e) {
    console.warn('[asterisk-sms-inbound] rejected unverified request', {
      reason: e instanceof WebhookVerificationError ? e.message : 'verification_error',
    });
    return unauthorizedResponse(corsHeaders, 'invalid_signature');
  }

  try {
    const { messageId, from, to, body, receivedAt } = await req.json();

    console.log('Inbound SMS webhook received:', { messageId, from, to });

    if (!from || !body) {
      throw new Error('Missing required fields: from, body');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Find contact by phone number
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, tenant_id')
      .or(`phone_number.eq.${from},alt_phone.eq.${from}`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    let contactId = contact?.id;
    let tenantId = contact?.tenant_id;
    let pipelineId = null;

    // Find active pipeline entry if contact exists
    if (contactId) {
      const { data: pipeline } = await supabase
        .from('pipeline_entries')
        .select('id')
        .eq('contact_id', contactId)
        .not('status', 'in', '(closed_won,closed_lost,disqualified)')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      pipelineId = pipeline?.id;
    } else {
      // Create new contact if doesn't exist
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          phone_number: from,
          name: from, // Will be updated when more info is available
          tenant_id: tenantId || null, // Will need to be mapped from "to" number
        })
        .select()
        .single();

      if (!contactError && newContact) {
        contactId = newContact.id;
        tenantId = newContact.tenant_id;
      }
    }

    // Create communication history entry
    const { error: historyError } = await supabase
      .from('communication_history')
      .insert({
        tenant_id: tenantId,
        contact_id: contactId,
        pipeline_entry_id: pipelineId,
        communication_type: 'sms',
        direction: 'inbound',
        content: body,
        metadata: {
          message_id: messageId,
          from_number: from,
          to_number: to,
          received_at: receivedAt || new Date().toISOString(),
        },
      });

    if (historyError) {
      console.error('Error creating communication history:', historyError);
    }

    // Auto-create pipeline entry if message contains keywords
    const keywords = ['estimate', 'quote', 'interested', 'roof', 'repair', 'inspection'];
    const containsKeyword = keywords.some(keyword => body.toLowerCase().includes(keyword));

    if (containsKeyword && contactId && !pipelineId) {
      const { error: pipelineError } = await supabase
        .from('pipeline_entries')
        .insert({
          tenant_id: tenantId,
          contact_id: contactId,
          status: 'new_lead',
          source: 'SMS Inquiry',
          notes: `Auto-created from SMS: "${body.substring(0, 100)}..."`,
        });

      if (pipelineError) {
        console.error('Error creating pipeline entry:', pipelineError);
      }
    }

    return new Response(
      JSON.stringify({ success: true, contactId, pipelineId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Inbound SMS webhook error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
