const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { action, ...data } = await req.json();
    console.log(`[warranty-registration-manager] Action: ${action}`);
    return new Response(JSON.stringify({ success: true, message: `Processed ${action}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: (error instanceof Error ? error.message : String(error)) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
