import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VoicemailManagerRequest {
  action: 'create' | 'update' | 'delete' | 'list' | 'generate_tts' | 'get_analytics';
  tenant_id: string;
  template_id?: string;
  data?: {
    name?: string;
    script?: string;
    audio_url?: string;
    is_tts?: boolean;
    voice?: string;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: VoicemailManagerRequest = await req.json();
    const { action, tenant_id, template_id, data } = body;

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

    // Get user from auth header
    const authHeader = req.headers.get('authorization');
    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id ?? null;
    }

    switch (action) {
      case 'create': {
        if (!data?.name) {
          return new Response(
            JSON.stringify({ success: false, error: 'Template name required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!data.audio_url && !data.script) {
          return new Response(
            JSON.stringify({ success: false, error: 'Either audio_url or script required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: template, error } = await supabaseAdmin
          .from('voicemail_templates')
          .insert({
            tenant_id,
            name: data.name,
            script: data.script,
            audio_url: data.audio_url,
            is_tts: data.is_tts ?? !data.audio_url,
            voice: data.voice || 'nova',
            created_by: userId
          })
          .select()
          .single();

        if (error) {
          console.error('[voicemail-manager] Create error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to create template' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[voicemail-manager] Created template: ${template.id}`);
        return new Response(
          JSON.stringify({ success: true, data: template }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        if (!template_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'template_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (data?.name) updateData.name = data.name;
        if (data?.script !== undefined) updateData.script = data.script;
        if (data?.audio_url !== undefined) updateData.audio_url = data.audio_url;
        if (data?.is_tts !== undefined) updateData.is_tts = data.is_tts;
        if (data?.voice) updateData.voice = data.voice;

        const { data: template, error } = await supabaseAdmin
          .from('voicemail_templates')
          .update(updateData)
          .eq('id', template_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (error) {
          console.error('[voicemail-manager] Update error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to update template' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[voicemail-manager] Updated template: ${template_id}`);
        return new Response(
          JSON.stringify({ success: true, data: template }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        if (!template_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'template_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabaseAdmin
          .from('voicemail_templates')
          .delete()
          .eq('id', template_id)
          .eq('tenant_id', tenant_id);

        if (error) {
          console.error('[voicemail-manager] Delete error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to delete template' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[voicemail-manager] Deleted template: ${template_id}`);
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list': {
        const { data: templates, error } = await supabaseAdmin
          .from('voicemail_templates')
          .select('*')
          .eq('tenant_id', tenant_id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[voicemail-manager] List error:', error);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to list templates' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: templates }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'generate_tts': {
        if (!data?.script) {
          return new Response(
            JSON.stringify({ success: false, error: 'Script required for TTS' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Use OpenAI TTS or similar service
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
        
        // For now, return success with TTS flag
        // In production, you'd call an actual TTS service
        return new Response(
          JSON.stringify({ 
            success: true, 
            data: { 
              is_tts: true,
              script: data.script,
              voice: data.voice || 'nova',
              message: 'TTS will be generated when voicemail is dropped'
            } 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_analytics': {
        const { data: templates } = await supabaseAdmin
          .from('voicemail_templates')
          .select('id, name, usage_count, callback_rate')
          .eq('tenant_id', tenant_id)
          .order('usage_count', { ascending: false });

        const totalUsage = templates?.reduce((sum, t) => sum + (t.usage_count || 0), 0) || 0;
        const avgCallbackRate = templates?.length 
          ? templates.reduce((sum, t) => sum + (t.callback_rate || 0), 0) / templates.length 
          : 0;

        return new Response(
          JSON.stringify({ 
            success: true, 
            data: {
              total_usage: totalUsage,
              avg_callback_rate: avgCallbackRate,
              templates: templates || [],
              top_performer: templates?.[0] || null
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
    console.error('[voicemail-manager] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
