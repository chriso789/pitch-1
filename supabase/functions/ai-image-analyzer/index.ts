import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ImageAnalysisRequest {
  image_data: string; // base64 encoded image
  analysis_type: 'overview' | 'damage' | 'components' | 'interior';
  step_id: string;
  step_title: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { 
      image_data, 
      analysis_type, 
      step_id, 
      step_title 
    }: ImageAnalysisRequest = await req.json();
    
    if (!image_data) {
      throw new Error('Image data is required');
    }

    console.log('Analyzing image for step:', step_title, 'type:', analysis_type);

    // Create analysis prompt based on type
    let analysisPrompt = '';
    
    switch (analysis_type) {
      case 'overview':
        analysisPrompt = `Analyze this roofing photo for a professional roof inspection. This is a ${step_title} photo.

        Please identify and describe:
        1. ROOF TYPE: What type of roofing material? (asphalt shingles, metal, tile, slate, etc.)
        2. ROOF CONDITION: Overall condition rating (excellent, good, fair, poor)
        3. VISIBLE COMPONENTS: What roof components are visible? (gutters, vents, flashing, etc.)
        4. STRUCTURAL ELEMENTS: Note any structural features (dormers, valleys, ridges, etc.)
        5. MEASUREMENTS: Estimate roof pitch/slope if visible
        6. AGE INDICATORS: Signs that indicate roof age or wear

        Focus on professional roofing assessment details that would be useful for creating an accurate estimate.`;
        break;

      case 'damage':
        analysisPrompt = `Analyze this photo for roofing damage and issues. This is a ${step_title} photo.

        Please identify and categorize any:
        1. DAMAGE TYPES: Missing/damaged shingles, exposed decking, nail pops, etc.
        2. SEVERITY: Rate each issue (minor, moderate, severe, critical)
        3. WATER DAMAGE: Signs of leaks, water stains, or moisture issues
        4. WEAR PATTERNS: Normal aging vs. premature wear
        5. SAFETY HAZARDS: Any immediate concerns requiring urgent attention
        6. REPAIR SCOPE: Estimate if repairs are patch work or require larger sections

        Be specific about locations and extent of damage for accurate repair estimates.`;
        break;

      case 'components':
        analysisPrompt = `Analyze this roofing component photo. This is a ${step_title} photo.

        Please examine and describe:
        1. COMPONENT TYPE: Identify the specific component (gutters, vents, flashing, etc.)
        2. MATERIAL: What material is used? (aluminum, steel, copper, plastic, etc.)
        3. CONDITION: Current condition and any wear or damage
        4. INSTALLATION: Assess installation quality and proper integration
        5. FUNCTIONALITY: Whether component appears to be functioning properly
        6. MAINTENANCE NEEDS: Any maintenance or replacement recommendations

        Focus on details that affect roof performance and longevity.`;
        break;

      case 'interior':
        analysisPrompt = `Analyze this interior photo for signs of roof-related issues. This is a ${step_title} photo.

        Please look for and describe:
        1. WATER DAMAGE: Stains, discoloration, or active leaks
        2. STRUCTURAL ISSUES: Sagging, warping, or other structural concerns
        3. INSULATION: Visible insulation condition and adequacy
        4. VENTILATION: Evidence of proper or inadequate ventilation
        5. MOLD/MOISTURE: Signs of moisture problems or mold growth
        6. RECENT REPAIRS: Evidence of previous repair attempts

        Assess how interior conditions relate to roof performance and needed repairs.`;
        break;
    }

    // Call OpenAI Vision API
    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${analysisPrompt}

                Return your analysis in this JSON format:
                {
                  "roof_type": "specific roof material type",
                  "condition_rating": "excellent|good|fair|poor",
                  "insights": [
                    {
                      "type": "component|damage|observation",
                      "description": "detailed description",
                      "severity": "minor|moderate|severe|critical",
                      "location": "where on roof/component",
                      "recommendation": "specific action needed"
                    }
                  ],
                  "measurements": {
                    "estimated_pitch": "degrees or ratio if determinable",
                    "visible_area": "rough size estimate if applicable"
                  },
                  "summary": "overall assessment summary",
                  "priority_actions": ["list of high priority items"],
                  "estimated_costs": {
                    "repair_range": "low-high estimate if damage present",
                    "replacement_indicators": "factors suggesting replacement vs repair"
                  }
                }`
              },
              {
                type: 'image_url',
                image_url: {
                  url: image_data
                }
              }
            ]
          }
        ],
        max_tokens: 1500,
        temperature: 0.3
      }),
    });

    if (!openAIResponse.ok) {
      const errorText = await openAIResponse.text();
      console.error('OpenAI API error:', errorText);
      throw new Error('Failed to analyze image');
    }

    const aiResult = await openAIResponse.json();
    const analysisText = aiResult.choices[0].message.content;

    console.log('AI Analysis completed for', step_title);

    // Parse the JSON response
    let analysis;
    try {
      // Extract JSON from the response (in case there's additional text)
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Fallback response
      analysis = {
        roof_type: "Unable to determine",
        condition_rating: "unknown",
        insights: [{
          type: "observation",
          description: analysisText.substring(0, 200),
          severity: "unknown",
          location: "general",
          recommendation: "Manual review recommended"
        }],
        summary: "AI analysis completed but requires manual review",
        priority_actions: [],
        estimated_costs: {}
      };
    }

    // Add metadata
    analysis.analysis_metadata = {
      step_id,
      step_title,
      analysis_type,
      analyzed_at: new Date().toISOString(),
      model_used: 'gpt-4o-mini'
    };

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ai-image-analyzer:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : String(error),
        fallback_analysis: {
          roof_type: "Requires manual inspection",
          condition_rating: "unknown",
          insights: [],
          summary: "Image analysis failed - manual review needed",
          priority_actions: ["Schedule manual inspection"],
          estimated_costs: {}
        }
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});