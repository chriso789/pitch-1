import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VoicemailDropRequest {
  action: 'drop' | 'check_amd' | 'get_status';
  tenant_id: string;
  call_control_id?: string;
  template_id?: string;
  to_number?: string;
  from_number?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: VoicemailDropRequest = await req.json();
    const { action, tenant_id, call_control_id, template_id, to_number, from_number } = body;

    if (!action || !tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action or tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');

    switch (action) {
      case 'drop': {
        if (!call_control_id || !template_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'call_control_id and template_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get voicemail template
        const { data: template, error: templateError } = await supabaseAdmin
          .from('voicemail_templates')
          .select('*')
          .eq('id', template_id)
          .eq('tenant_id', tenant_id)
          .single();

        if (templateError || !template) {
          return new Response(
            JSON.stringify({ success: false, error: 'Template not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!TELNYX_API_KEY) {
          console.error('[voicemail-drop] TELNYX_API_KEY not configured');
          return new Response(
            JSON.stringify({ success: false, error: 'Telnyx not configured' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // If template has audio URL, play it. Otherwise use TTS
        let telnyxAction;
        if (template.audio_url && !template.is_tts) {
          telnyxAction = {
            action: 'playback_start',
            payload: {
              audio_url: template.audio_url,
              overlay: false
            }
          };
        } else {
          telnyxAction = {
            action: 'speak',
            payload: {
              payload: template.script || 'Hello, this is a message for you. Please call us back at your earliest convenience.',
              voice: template.voice || 'nova',
              language: 'en-US'
            }
          };
        }

        // Send command to Telnyx
        const telnyxResponse = await fetch(`https://api.telnyx.com/v2/calls/${call_control_id}/actions/${telnyxAction.action}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(telnyxAction.payload)
        });

        if (!telnyxResponse.ok) {
          const errorText = await telnyxResponse.text();
          console.error('[voicemail-drop] Telnyx error:', errorText);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to drop voicemail' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Update template usage count
        await supabaseAdmin
          .from('voicemail_templates')
          .update({ 
            usage_count: (template.usage_count || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', template_id);

        // Log the voicemail drop
        await supabaseAdmin
          .from('call_logs')
          .update({ 
            disposition: 'voicemail_left',
            metadata: { voicemail_template_id: template_id }
          })
          .eq('call_sid', call_control_id);

        console.log(`[voicemail-drop] Dropped voicemail using template ${template_id} on call ${call_control_id}`);
        return new Response(
          JSON.stringify({ success: true, data: { template_id, call_control_id } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'check_amd': {
        // Check if call hit answering machine (AMD = Answering Machine Detection)
        if (!call_control_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'call_control_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!TELNYX_API_KEY) {
          return new Response(
            JSON.stringify({ success: false, error: 'Telnyx not configured' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get call status from Telnyx
        const telnyxResponse = await fetch(`https://api.telnyx.com/v2/calls/${call_control_id}`, {
          headers: {
            'Authorization': `Bearer ${TELNYX_API_KEY}`
          }
        });

        if (!telnyxResponse.ok) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to check AMD status' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const callData = await telnyxResponse.json();
        const amdResult = callData.data?.answering_machine_detection;

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: { 
              is_machine: amdResult?.result === 'machine',
              amd_result: amdResult?.result,
              confidence: amdResult?.confidence
            } 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_status': {
        // Get voicemail drop statistics
        const { data: templates } = await supabaseAdmin
          .from('voicemail_templates')
          .select('id, name, usage_count, callback_rate')
          .eq('tenant_id', tenant_id)
          .order('usage_count', { ascending: false });

        const totalDrops = templates?.reduce((sum, t) => sum + (t.usage_count || 0), 0) || 0;

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: { 
              total_drops: totalDrops,
              templates: templates || []
            } 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('[voicemail-drop] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
