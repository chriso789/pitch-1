/**
 * Link Unmatched to Contact Edge Function
 * Links an unmatched inbound message/call to an existing contact
 * Creates conversation and backfills message/call
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LinkRequest {
  tenant_id: string;
  unmatched_inbound_id: string;
  contact_id: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'POST only' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid JWT' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = (await req.json()) as LinkRequest;
    
    if (!body.tenant_id || !body.unmatched_inbound_id || !body.contact_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: tenant_id, unmatched_inbound_id, contact_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Load unmatched inbound record
    const { data: unmatched, error: unmatchedErr } = await admin
      .from('unmatched_inbound')
      .select('*')
      .eq('id', body.unmatched_inbound_id)
      .eq('tenant_id', body.tenant_id)
      .single();

    if (unmatchedErr || !unmatched) {
      return new Response(
        JSON.stringify({ error: 'Unmatched inbound not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (unmatched.state !== 'open') {
      return new Response(
        JSON.stringify({ error: `Cannot link: state is already '${unmatched.state}'` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Load contact
    const { data: contact, error: contactErr } = await admin
      .from('contacts')
      .select('id, first_name, last_name, phone, tenant_id')
      .eq('id', body.contact_id)
      .eq('tenant_id', body.tenant_id)
      .single();

    if (contactErr || !contact) {
      return new Response(
        JSON.stringify({ error: 'Contact not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get or create conversation
    let conversationId: string | null = null;

    // Try to find existing conversation for this contact
    const { data: existingConvo } = await admin
      .from('conversations')
      .select('id')
      .eq('tenant_id', body.tenant_id)
      .eq('contact_id', body.contact_id)
      .eq('channel', unmatched.channel)
      .maybeSingle();

    if (existingConvo?.id) {
      conversationId = existingConvo.id;
    } else {
      // Create new conversation
      const { data: newConvo, error: convoErr } = await admin
        .from('conversations')
        .insert({
          tenant_id: body.tenant_id,
          contact_id: body.contact_id,
          channel: unmatched.channel,
          location_id: unmatched.location_id,
          last_activity_at: unmatched.received_at,
        })
        .select('id')
        .single();

      if (convoErr) {
        console.error('Failed to create conversation:', convoErr);
        return new Response(
          JSON.stringify({ error: 'Failed to create conversation', details: convoErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      conversationId = newConvo.id;
    }

    // Backfill message or call based on channel
    if (unmatched.channel === 'sms') {
      // Insert into sms_messages (idempotent via telnyx_message_id)
      const { error: msgErr } = await admin
        .from('sms_messages')
        .upsert({
          tenant_id: body.tenant_id,
          contact_id: body.contact_id,
          conversation_id: conversationId,
          location_id: unmatched.location_id,
          direction: 'inbound',
          from_number: unmatched.from_e164,
          to_number: unmatched.to_e164,
          body: unmatched.body,
          media: unmatched.media,
          provider: 'telnyx',
          provider_message_id: unmatched.telnyx_message_id,
          status: 'received',
          sent_at: unmatched.received_at,
        }, {
          onConflict: 'tenant_id,provider_message_id',
          ignoreDuplicates: true,
        });

      if (msgErr) {
        console.error('Failed to backfill SMS:', msgErr);
      }
    } else if (unmatched.channel === 'call') {
      // Update or insert call record
      if (unmatched.telnyx_call_control_id) {
        const { error: callErr } = await admin
          .from('calls')
          .update({
            contact_id: body.contact_id,
            conversation_id: conversationId,
          })
          .eq('telnyx_call_control_id', unmatched.telnyx_call_control_id);

        if (callErr) {
          console.error('Failed to link call:', callErr);
        }
      }
    }

    // Update unmatched_inbound record
    const { error: updateErr } = await admin
      .from('unmatched_inbound')
      .update({
        state: 'linked',
        contact_id: body.contact_id,
        conversation_id: conversationId,
        notes: `Linked by ${userData.user.email} at ${new Date().toISOString()}`,
      })
      .eq('id', body.unmatched_inbound_id);

    if (updateErr) {
      console.error('Failed to update unmatched:', updateErr);
      return new Response(
        JSON.stringify({ error: 'Failed to update unmatched record', details: updateErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update conversation last activity
    await admin
      .from('conversations')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', conversationId);

    console.log(`Linked unmatched ${body.unmatched_inbound_id} to contact ${body.contact_id}, conversation ${conversationId}`);

    return new Response(
      JSON.stringify({
        success: true,
        conversation_id: conversationId,
        contact_id: body.contact_id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('link-unmatched-to-contact error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
