import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DISPOSITION_TO_STATUS_MAP: Record<string, string> = {
  'answered': 'in_progress',
  'no_answer': 'attempted_contact',
  'left_voicemail': 'attempted_contact',
  'callback_requested': 'follow_up',
  'estimate_discussed': 'estimate_sent',
  'not_interested': 'disqualified',
  'appointment_set': 'inspection_scheduled',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { eventType, callId, channelId, duration, recordingUrl, hangupCause, answeredAt, endedAt, agentChannelId } = await req.json();

    console.log('Call event webhook received:', { eventType, callId, channelId });

    if (!eventType || !channelId) {
      throw new Error('Missing required fields: eventType, channelId');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Find call log by channel ID or call ID
    let { data: callLog } = await supabase
      .from('call_logs')
      .select('id, tenant_id, contact_id, pipeline_entry_id')
      .eq(callId ? 'id' : 'asterisk_channel_id', callId || channelId)
      .single();

    if (!callLog && !callId) {
      console.warn('Call log not found for channel:', channelId);
      return new Response(
        JSON.stringify({ success: true, warning: 'Call log not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const callLogId = callLog?.id || callId;

    switch (eventType) {
      case 'call.answered':
        await supabase
          .from('call_logs')
          .update({
            status: 'active',
            answered_at: answeredAt || new Date().toISOString(),
          })
          .eq('id', callLogId);

        await supabase
          .from('asterisk_channels')
          .update({
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('channel_id', channelId);
        break;

      case 'call.bridged':
        await supabase
          .from('call_logs')
          .update({
            status: 'active',
            answered_at: answeredAt || new Date().toISOString(),
          })
          .eq('id', callLogId);

        await supabase
          .from('asterisk_channels')
          .update({
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('channel_id', channelId);
        break;

      case 'call.hangup':
        const durationSeconds = duration || 0;
        let autoDisposition = null;

        // Auto-disposition logic
        if (durationSeconds < 15) {
          autoDisposition = 'no_answer';
        } else if (hangupCause?.includes('voicemail')) {
          autoDisposition = 'left_voicemail';
        }

        await supabase
          .from('call_logs')
          .update({
            status: 'completed',
            ended_at: endedAt || new Date().toISOString(),
            duration_seconds: durationSeconds,
            bridge_duration_seconds: durationSeconds,
            recording_url: recordingUrl || null,
            disposition: autoDisposition,
          })
          .eq('id', callLogId);

        await supabase
          .from('asterisk_channels')
          .update({
            status: 'ended',
            updated_at: new Date().toISOString(),
          })
          .eq('channel_id', channelId);

        // Update pipeline status if auto-disposition
        if (autoDisposition && callLog?.pipeline_entry_id) {
          const newStatus = DISPOSITION_TO_STATUS_MAP[autoDisposition];
          if (newStatus) {
            await supabase
              .from('pipeline_entries')
              .update({
                status: newStatus,
                status_entered_at: new Date().toISOString(),
              })
              .eq('id', callLog.pipeline_entry_id);
          }
        }

        // Create communication history entry
        if (callLog?.contact_id) {
          await supabase
            .from('communication_history')
            .insert({
              tenant_id: callLog.tenant_id,
              contact_id: callLog.contact_id,
              pipeline_entry_id: callLog.pipeline_entry_id,
              communication_type: 'call',
              direction: 'inbound',
              content: `Call duration: ${durationSeconds}s${autoDisposition ? ` - ${autoDisposition}` : ''}`,
              metadata: {
                call_id: callLogId,
                recording_url: recordingUrl,
                disposition: autoDisposition,
              },
            });
        }

        // Create follow-up task for voicemail
        if (autoDisposition === 'left_voicemail' && callLog?.contact_id) {
          await supabase
            .from('tasks')
            .insert({
              tenant_id: callLog.tenant_id,
              assigned_to: callLog.pipeline_entry_id ? (await supabase.from('pipeline_entries').select('assigned_to').eq('id', callLog.pipeline_entry_id).single()).data?.assigned_to : null,
              title: 'Return voicemail',
              description: `Customer left voicemail. Call back: ${(await supabase.from('contacts').select('phone_number').eq('id', callLog.contact_id).single()).data?.phone_number}`,
              due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
              related_contact_id: callLog.contact_id,
            });
        }
        break;

      case 'recording.saved':
        await supabase
          .from('call_logs')
          .update({
            recording_url: recordingUrl,
            asterisk_recording_id: recordingUrl?.split('/').pop(),
          })
          .eq('id', callLogId);
        break;
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Call event webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
