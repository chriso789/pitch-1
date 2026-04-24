import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { action, ...data } = await req.json();
    console.log(`[quality-inspection-manager] Action: ${action}`);
    
    if (action === 'create') {
      const { tenant_id, job_id, inspection_type } = data;
      return new Response(JSON.stringify({ success: true, inspection: { id: crypto.randomUUID(), tenant_id, job_id, inspection_type, status: 'pending' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: (error instanceof Error ? error.message : String(error)) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
