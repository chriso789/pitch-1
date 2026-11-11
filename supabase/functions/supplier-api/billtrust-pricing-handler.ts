import { corsHeaders } from "../_shared/cors.ts";

// Billtrust has no implemented supplier-price contract. Never write invented costs.
export const handle = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({ success: false, code: 'PRICING_PROVIDER_UNAVAILABLE',
    error: 'Billtrust pricing is not configured. Import a verified supplier price list or use the supplier integration. Existing prices were not changed.' }),
    { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
};
