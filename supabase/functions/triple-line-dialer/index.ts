import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DialerRequest {
  campaign_id: string;
  user_id: string;
  tenant_id: string;
  dial_mode: 'single' | 'power' | 'triple';
  max_lines?: number;
}

interface Lead {
  id: string;
  contact_id: string;
  phone: string;
  priority: number;
  contact_name?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY');
    const telnyxConnectionId = Deno.env.get('TELNYX_CONNECTION_ID');

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { campaign_id, user_id, tenant_id, dial_mode = 'triple', max_lines = 3 } = await req.json() as DialerRequest;

    console.log(`Triple-line dialer initiated for campaign ${campaign_id}, mode: ${dial_mode}`);

    // Get campaign settings
    const { data: campaign, error: campaignError } = await supabase
      .from('dialer_campaigns')
      .select('*, dialer_lists!inner(id, name)')
      .eq('id', campaign_id)
      .single();

    if (campaignError || !campaign) {
      throw new Error(`Campaign not found: ${campaignError?.message}`);
    }

    // Get caller ID for tenant
    const { data: phoneNumber } = await supabase
      .from('telnyx_phone_numbers')
      .select('phone_number')
      .eq('tenant_id', tenant_id)
      .eq('is_primary', true)
      .single();

    const callerId = phoneNumber?.phone_number || campaign.caller_id;

    // Get eligible leads from campaign list
    const { data: leads, error: leadsError } = await supabase
      .from('dialer_leads')
      .select(`
        id,
        contact_id,
        priority,
        contacts!inner(
          id,
          phone,
          first_name,
          last_name
        )
      `)
      .eq('campaign_id', campaign_id)
      .eq('status', 'pending')
      .lt('attempts_count', campaign.max_attempts || 3)
      .order('priority', { ascending: false })
      .limit(dial_mode === 'triple' ? 3 : dial_mode === 'power' ? 2 : 1);

    if (leadsError || !leads || leads.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        message: 'No eligible leads found in campaign',
        leads_remaining: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Found ${leads.length} eligible leads to dial`);

    // Prepare calls
    const callPromises = leads.map(async (lead: any, index: number) => {
      const contact = lead.contacts;
      const phoneNumber = contact.phone?.replace(/\D/g, '');

      if (!phoneNumber || phoneNumber.length < 10) {
        console.log(`Invalid phone number for lead ${lead.id}`);
        return { lead_id: lead.id, status: 'invalid_number', error: 'Invalid phone number' };
      }

      // Create call log entry
      const { data: callLog, error: callLogError } = await supabase
        .from('call_logs')
        .insert({
          tenant_id,
          contact_id: contact.id,
          caller_id: callerId,
          callee_number: phoneNumber,
          direction: 'outbound',
          status: 'initiating',
          created_by: user_id,
          metadata: {
            campaign_id,
            lead_id: lead.id,
            dial_mode,
            line_number: index + 1
          }
        })
        .select()
        .single();

      if (callLogError) {
        console.error('Error creating call log:', callLogError);
        return { lead_id: lead.id, status: 'error', error: 'Failed to create call log' };
      }

      // Initiate call via Telnyx
      if (telnyxApiKey && telnyxConnectionId) {
        try {
          const formattedTo = phoneNumber.startsWith('+') ? phoneNumber : `+1${phoneNumber}`;
          const formattedFrom = callerId.startsWith('+') ? callerId : `+1${callerId}`;

          const telnyxResponse = await fetch('https://api.telnyx.com/v2/calls', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${telnyxApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              connection_id: telnyxConnectionId,
              to: formattedTo,
              from: formattedFrom,
              webhook_url: `${supabaseUrl}/functions/v1/voice-inbound`,
              webhook_url_method: 'POST',
              answering_machine_detection: 'premium',
              answering_machine_detection_config: {
                after_greeting_silence_millis: 800,
                between_words_silence_millis: 50,
                maximum_number_of_words: 5,
                maximum_word_length_millis: 3500,
                silence_threshold_millis: 256,
                total_analysis_time_millis: 5000
              },
              record: 'record-from-answer',
              client_state: btoa(JSON.stringify({
                call_log_id: callLog.id,
                campaign_id,
                lead_id: lead.id,
                tenant_id,
                user_id,
                dial_mode
              }))
            })
          });

          const telnyxResult = await telnyxResponse.json();

          if (telnyxResult.data?.call_control_id) {
            // Update call log with Telnyx ID
            await supabase
              .from('call_logs')
              .update({
                call_sid: telnyxResult.data.call_control_id,
                status: 'ringing'
              })
              .eq('id', callLog.id);

            // Update lead status
            await supabase
              .from('dialer_leads')
              .update({
                status: 'calling',
                last_attempt_at: new Date().toISOString(),
                attempts_count: lead.attempts_count + 1
              })
              .eq('id', lead.id);

            return {
              lead_id: lead.id,
              call_log_id: callLog.id,
              call_control_id: telnyxResult.data.call_control_id,
              status: 'ringing',
              contact_name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
              phone: formattedTo,
              line_number: index + 1
            };
          } else {
            console.error('Telnyx call failed:', telnyxResult);
            await supabase
              .from('call_logs')
              .update({ status: 'failed' })
              .eq('id', callLog.id);

            return { lead_id: lead.id, status: 'failed', error: telnyxResult.errors?.[0]?.detail || 'Telnyx call failed' };
          }
        } catch (telnyxError) {
          console.error('Telnyx API error:', telnyxError);
          return { lead_id: lead.id, status: 'error', error: 'Telnyx API error' };
        }
      } else {
        // Simulate call for testing
        console.log(`[SIMULATED] Calling ${phoneNumber} for lead ${lead.id}`);
        await supabase
          .from('call_logs')
          .update({ status: 'simulated' })
          .eq('id', callLog.id);

        return {
          lead_id: lead.id,
          call_log_id: callLog.id,
          status: 'simulated',
          contact_name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
          phone: phoneNumber,
          line_number: index + 1
        };
      }
    });

    // Execute all calls in parallel
    const callResults = await Promise.all(callPromises);

    // Count remaining leads
    const { count: remainingLeads } = await supabase
      .from('dialer_leads')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaign_id)
      .eq('status', 'pending');

    // Log dialer session
    await supabase
      .from('call_events')
      .insert({
        tenant_id,
        campaign_id,
        event_type: 'triple_line_dial',
        event_data: {
          dial_mode,
          lines_dialed: callResults.length,
          results: callResults,
          user_id
        }
      });

    console.log(`Dialer results:`, callResults);

    return new Response(JSON.stringify({
      success: true,
      dial_mode,
      lines_dialed: callResults.length,
      calls: callResults,
      leads_remaining: remainingLeads || 0,
      campaign_id
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Triple-line dialer error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
