import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SupplementRequest {
  action: 'generate' | 'get_xactimate_codes' | 'analyze_photos' | 'submit';
  tenant_id: string;
  claim_id?: string;
  project_id?: string;
  photos?: string[];
  damage_description?: string;
  original_estimate?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SupplementRequest = await req.json();
    const { action, tenant_id, claim_id, project_id, photos, damage_description, original_estimate } = body;

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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    switch (action) {
      case 'generate': {
        if (!claim_id && !project_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'claim_id or project_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get project/claim details
        let projectData;
        if (project_id) {
          const { data } = await supabaseAdmin
            .from('projects')
            .select('*, estimates(*)')
            .eq('id', project_id)
            .single();
          projectData = data;
        }

        // Get photos for the project
        const { data: projectPhotos } = await supabaseAdmin
          .from('project_photos')
          .select('file_url, category, annotations')
          .eq('project_id', project_id || claim_id)
          .in('category', ['damage', 'before']);

        if (!LOVABLE_API_KEY) {
          // Return template supplement without AI
          const supplement = {
            claim_id,
            project_id,
            status: 'draft',
            generated_at: new Date().toISOString(),
            items: [
              {
                xactimate_code: 'RFG250',
                description: 'Additional roofing materials required',
                quantity: 0,
                unit: 'SQ',
                justification: 'Damage not visible in original inspection'
              }
            ],
            total_supplement: 0,
            notes: 'Please review and add specific items based on damage assessment'
          };

          return new Response(
            JSON.stringify({ success: true, data: supplement }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Use AI to generate supplement
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `You are an insurance supplement specialist for roofing claims.
Generate a detailed supplement request based on the damage assessment.
Include Xactimate codes where applicable (e.g., RFG250 for roofing, SDL300 for siding).
Provide clear justifications for each line item.
Output JSON format with: items (array of {xactimate_code, description, quantity, unit, unit_price, justification}), total_supplement, summary.`
              },
              {
                role: 'user',
                content: `Generate a supplement for this insurance claim:
Damage Description: ${damage_description || 'Roof damage requiring additional work'}
Original Estimate: ${JSON.stringify(original_estimate || {})}
Number of damage photos: ${projectPhotos?.length || 0}`
              }
            ],
            response_format: { type: 'json_object' }
          })
        });

        if (!aiResponse.ok) {
          console.error('[supplement-generator] AI error');
          return new Response(
            JSON.stringify({ success: false, error: 'AI generation failed' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const aiData = await aiResponse.json();
        const supplement = JSON.parse(aiData.choices[0].message.content);

        // Save supplement draft
        const { data: savedSupplement, error } = await supabaseAdmin
          .from('insurance_supplements')
          .insert({
            tenant_id,
            claim_id,
            project_id,
            status: 'draft',
            items: supplement.items,
            total_amount: supplement.total_supplement,
            summary: supplement.summary,
            generated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) {
          console.error('[supplement-generator] Save error:', error);
        }

        console.log(`[supplement-generator] Generated supplement for claim ${claim_id || project_id}`);
        return new Response(
          JSON.stringify({ success: true, data: savedSupplement || supplement }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_xactimate_codes': {
        // Common Xactimate codes for roofing
        const codes = [
          { code: 'RFG100', category: 'Roofing', description: 'Remove roofing - Composition shingle', unit: 'SQ' },
          { code: 'RFG250', category: 'Roofing', description: 'Roofing - Composition shingle - 25 year', unit: 'SQ' },
          { code: 'RFG251', category: 'Roofing', description: 'Roofing - Composition shingle - 30 year', unit: 'SQ' },
          { code: 'RFG260', category: 'Roofing', description: 'Roofing - Comp shingle - Architectural', unit: 'SQ' },
          { code: 'RFG350', category: 'Roofing', description: 'Felt paper - 15#', unit: 'SQ' },
          { code: 'RFG400', category: 'Roofing', description: 'Ice & water shield', unit: 'SQ' },
          { code: 'RFG500', category: 'Roofing', description: 'Ridge cap - Composition', unit: 'LF' },
          { code: 'RFG600', category: 'Roofing', description: 'Drip edge - Aluminum', unit: 'LF' },
          { code: 'GTR100', category: 'Gutters', description: 'Remove gutter', unit: 'LF' },
          { code: 'GTR200', category: 'Gutters', description: 'Gutter - Aluminum - 5"', unit: 'LF' },
          { code: 'SDL100', category: 'Siding', description: 'Remove siding - Vinyl', unit: 'SF' },
          { code: 'SDL300', category: 'Siding', description: 'Siding - Vinyl', unit: 'SF' },
          { code: 'WDW100', category: 'Windows', description: 'Remove window', unit: 'EA' },
          { code: 'FLH100', category: 'Flashing', description: 'Step flashing', unit: 'LF' }
        ];

        return new Response(
          JSON.stringify({ success: true, data: codes }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'analyze_photos': {
        if (!photos?.length) {
          return new Response(
            JSON.stringify({ success: false, error: 'photos required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!LOVABLE_API_KEY) {
          return new Response(
            JSON.stringify({ 
              success: true, 
              data: { 
                damage_types: ['unknown'],
                confidence: 0.5,
                recommendations: ['Manual review required']
              }
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Analyze first photo (limit API calls)
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: 'Analyze this construction/roofing damage photo. Identify damage types, severity, and recommend Xactimate line items. Respond with JSON: {damage_types: [], severity: "minor|moderate|severe", xactimate_recommendations: [{code, description, justification}], confidence: 0-1}'
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Analyze this damage photo for insurance supplement:' },
                  { type: 'image_url', image_url: { url: photos[0] } }
                ]
              }
            ],
            response_format: { type: 'json_object' }
          })
        });

        if (!aiResponse.ok) {
          return new Response(
            JSON.stringify({ success: true, data: { damage_types: ['analysis_failed'], confidence: 0 } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const aiData = await aiResponse.json();
        const analysis = JSON.parse(aiData.choices[0].message.content);

        return new Response(
          JSON.stringify({ success: true, data: analysis }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'submit': {
        if (!claim_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'claim_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Update supplement status
        const { data, error } = await supabaseAdmin
          .from('insurance_supplements')
          .update({
            status: 'submitted',
            submitted_at: new Date().toISOString()
          })
          .eq('claim_id', claim_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to submit supplement' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[supplement-generator] Submitted supplement for claim ${claim_id}`);
        return new Response(
          JSON.stringify({ success: true, data }),
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
    console.error('[supplement-generator] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
