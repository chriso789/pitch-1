import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const { action, ...data } = await req.json();
    console.log(`[communication-inbox-manager] Action: ${action}`);

    switch (action) {
      case 'get_threads': {
        const { tenant_id, status = 'open' } = data;
        const { data: threads } = await supabase.from('sms_conversations').select('*').eq('tenant_id', tenant_id).order('updated_at', { ascending: false }).limit(50);
        return new Response(JSON.stringify({ success: true, threads }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      case 'mark_read': {
        const { thread_id } = data;
        await supabase.from('sms_conversations').update({ is_read: true }).eq('id', thread_id);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[communication-inbox-manager] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
