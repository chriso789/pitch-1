import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

interface ObstructionDetectionResult {
  obstructions_detected: boolean;
  obstructions: Array<{
    type: string;
    confidence: number;
    description: string;
    area_sqft_estimated?: number;
    location?: string;
  }>;
  measurement_impacted: boolean;
  recommended_action: string;
  analysis_summary: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_url, lat, lng, measurement_id, pipeline_entry_id } = await req.json();
    
    if (!image_url) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'image_url is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'OpenAI API key not configured' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('🔍 Analyzing satellite image for roof obstructions...');
    console.log('📍 Location:', lat, lng);

    // Call OpenAI Vision API to analyze the satellite image
    const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert roofing inspector AI analyzing aerial satellite images of residential roofs. Your job is to identify any obstructions, damage, or conditions that would impact roof measurement accuracy.

Focus on detecting:
1. Blue tarps (most common after storms) - these appear as bright blue rectangular/irregular shapes
2. Other color tarps (gray, silver, brown)
3. Debris piles on the roof
4. Construction materials or equipment
5. Missing shingles or exposed decking (appears as different color patches)
6. Standing water or discoloration
7. Fallen trees or branches on roof
8. Solar panels (not an obstruction, but note them)
9. Skylights (note for measurement adjustment)
10. Any other obstruction blocking accurate measurement

Be specific about location (e.g., "front left section", "near chimney") and provide confidence percentages.`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this aerial satellite image of a residential roof. Identify any obstructions, tarps, debris, or damage that would affect roof measurement accuracy.

Return your analysis as JSON with this exact structure:
{
  "obstructions_detected": boolean,
  "obstructions": [
    {
      "type": "blue_tarp" | "gray_tarp" | "debris" | "missing_shingles" | "tree_damage" | "construction_materials" | "standing_water" | "solar_panels" | "skylights" | "other",
      "confidence": 0-100,
      "description": "detailed description",
      "area_sqft_estimated": number (if applicable),
      "location": "location on roof"
    }
  ],
  "measurement_impacted": boolean,
  "recommended_action": "proceed" | "manual_verification_required" | "request_current_photos" | "wait_for_repairs",
  "analysis_summary": "brief summary of findings"
}`
              },
              {
                type: 'image_url',
                image_url: {
                  url: image_url,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 1500,
        temperature: 0.1,
      }),
    });

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('OpenAI Vision API error:', errorText);
      throw new Error(`OpenAI API error: ${visionResponse.status}`);
    }

    const visionData = await visionResponse.json();
    const assistantMessage = visionData.choices?.[0]?.message?.content;

    if (!assistantMessage) {
      throw new Error('No response from OpenAI Vision');
    }

    console.log('📝 Raw AI response:', assistantMessage);

    // Parse the JSON response from the AI
    let detectionResult: ObstructionDetectionResult;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = assistantMessage.match(/```json\n?([\s\S]*?)\n?```/) || 
                        assistantMessage.match(/```\n?([\s\S]*?)\n?```/) ||
                        [null, assistantMessage];
      const jsonStr = jsonMatch[1] || assistantMessage;
      detectionResult = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      // Return a default response if parsing fails
      detectionResult = {
        obstructions_detected: false,
        obstructions: [],
        measurement_impacted: false,
        recommended_action: 'proceed',
        analysis_summary: 'Unable to parse AI analysis. Manual inspection recommended.'
      };
    }

    console.log('✅ Detection result:', detectionResult);

    // Save detection result to database if measurement_id is provided
    if (measurement_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error: updateError } = await supabase
        .from('measurements')
        .update({
          obstruction_detected: detectionResult.obstructions_detected,
          obstruction_type: detectionResult.obstructions.length > 0 
            ? detectionResult.obstructions[0].type 
            : null,
          obstruction_confidence: detectionResult.obstructions.length > 0 
            ? detectionResult.obstructions[0].confidence 
            : null,
          obstruction_analysis: detectionResult,
          obstruction_analyzed_at: new Date().toISOString(),
        } as any)
        .eq('id', measurement_id);

      if (updateError) {
        console.error('Failed to save detection result:', updateError);
      } else {
        console.log('💾 Saved detection result to measurement');
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      data: detectionResult,
      analyzed_at: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Obstruction detection error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});