import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { generateAIResponse, parseAIJson } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { project_id, contact_id, property_data } = await req.json();

    const propertyContext = property_data
      ? `Address: ${property_data.address || 'unknown'}, Type: ${property_data.propertyType || 'residential'}, Roof Area: ${property_data.roofArea || 'unknown'} sqft, Current Job: ${property_data.jobType || 'roofing'}`
      : 'No specific property data available.';

    const { text } = await generateAIResponse({
      system: `You are a construction sales advisor. Given property data, suggest 2-4 add-on services the homeowner would benefit from. Return JSON array with objects: { "service": string, "reason": string (1 sentence), "estimatedValue": number, "confidence": "high"|"medium"|"low" }. Only suggest realistic, relevant services like gutters, siding, solar panels, windows, insulation, skylights, or exterior painting.`,
      user: `Property info: ${propertyContext}. Suggest relevant upsell/cross-sell services.`,
      temperature: 0.5,
    });

    const recommendations = parseAIJson(text, []);

    return new Response(JSON.stringify({ recommendations }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[upsell-recommendations] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
