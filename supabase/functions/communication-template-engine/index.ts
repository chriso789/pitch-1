import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { action, template, variables } = await req.json();
    console.log(`[communication-template-engine] Action: ${action}`);
    
    if (action === 'render') {
      let rendered = template;
      for (const [key, value] of Object.entries(variables || {})) {
        rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
      }
      return new Response(JSON.stringify({ success: true, rendered }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
