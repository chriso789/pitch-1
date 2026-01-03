import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DamageType {
  type: string;
  confidence: number;
  severity: 'minor' | 'moderate' | 'severe';
  location?: { x: number; y: number; width: number; height: number };
  description: string;
  estimatedCost: { min: number; max: number };
}

interface DamageAnalysisResult {
  damageDetected: boolean;
  damageTypes: DamageType[];
  overallSeverity: 'minor' | 'moderate' | 'severe' | 'none';
  estimatedCostMin: number;
  estimatedCostMax: number;
  confidence: number;
  recommendations: string[];
  analysisNotes: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, imageUrl } = await req.json();

    if (!imageBase64 && !imageUrl) {
      return new Response(
        JSON.stringify({ error: "Either imageBase64 or imageUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build the content array for the API call
    const content: any[] = [
      {
        type: "text",
        text: `You are an expert construction damage assessor analyzing property photos for roofing, siding, and exterior damage.

ANALYZE THE IMAGE FOR ALL VISIBLE DAMAGE:

1. ROOF DAMAGE:
   - Hail damage (dimples, dents, bruising on shingles)
   - Wind damage (lifted, curled, or missing shingles)
   - Missing/broken shingles
   - Ridge cap damage
   - Flashing damage
   - Granule loss
   - Soft spots or sagging

2. SIDING DAMAGE:
   - Cracks, holes, or punctures
   - Warping or buckling
   - Fading or discoloration
   - Moisture damage or rot
   - Impact damage

3. GUTTER DAMAGE:
   - Dents or deformation
   - Separation from fascia
   - Clogs or overflow signs
   - Missing sections

4. GENERAL EXTERIOR:
   - Water staining
   - Moss or algae growth
   - Structural concerns
   - Age-related wear

FOR EACH DAMAGE FOUND, ASSESS:
- Damage type and location
- Severity (minor: cosmetic, moderate: functional concern, severe: immediate repair needed)
- Affected area estimate
- Repair cost estimate based on:
  * Shingle repair: $150-300 per area
  * Shingle replacement: $5-8 per sqft
  * Full roof replacement: $8,000-15,000 (average home)
  * Siding repair: $200-500 per area
  * Siding replacement: $7-12 per sqft
  * Gutter repair: $100-300 per section
  * Gutter replacement: $8-15 per linear ft

Provide your analysis using the analyze_damage function.`,
      },
    ];

    // Add the image
    if (imageBase64) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${imageBase64}`,
        },
      });
    } else if (imageUrl) {
      content.push({
        type: "image_url",
        image_url: {
          url: imageUrl,
        },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "analyze_damage",
              description: "Return the damage analysis results for the property photo",
              parameters: {
                type: "object",
                properties: {
                  damageDetected: {
                    type: "boolean",
                    description: "Whether any damage was detected in the image",
                  },
                  damageTypes: {
                    type: "array",
                    description: "List of all damage types found",
                    items: {
                      type: "object",
                      properties: {
                        type: {
                          type: "string",
                          enum: [
                            "hail_damage",
                            "wind_damage",
                            "missing_shingles",
                            "granule_loss",
                            "ridge_damage",
                            "flashing_damage",
                            "siding_crack",
                            "siding_hole",
                            "siding_warp",
                            "gutter_dent",
                            "gutter_separation",
                            "water_damage",
                            "moss_algae",
                            "wear_aging",
                            "impact_damage",
                            "other",
                          ],
                        },
                        confidence: {
                          type: "number",
                          minimum: 0,
                          maximum: 100,
                          description: "Confidence level 0-100",
                        },
                        severity: {
                          type: "string",
                          enum: ["minor", "moderate", "severe"],
                        },
                        location: {
                          type: "object",
                          properties: {
                            x: { type: "number", description: "X position 0-100 percentage" },
                            y: { type: "number", description: "Y position 0-100 percentage" },
                            width: { type: "number", description: "Width 0-100 percentage" },
                            height: { type: "number", description: "Height 0-100 percentage" },
                          },
                        },
                        description: {
                          type: "string",
                          description: "Detailed description of the damage",
                        },
                        estimatedCost: {
                          type: "object",
                          properties: {
                            min: { type: "number" },
                            max: { type: "number" },
                          },
                          required: ["min", "max"],
                        },
                      },
                      required: ["type", "confidence", "severity", "description", "estimatedCost"],
                    },
                  },
                  overallSeverity: {
                    type: "string",
                    enum: ["none", "minor", "moderate", "severe"],
                    description: "Overall severity assessment",
                  },
                  estimatedCostMin: {
                    type: "number",
                    description: "Minimum total estimated repair cost",
                  },
                  estimatedCostMax: {
                    type: "number",
                    description: "Maximum total estimated repair cost",
                  },
                  confidence: {
                    type: "number",
                    minimum: 0,
                    maximum: 100,
                    description: "Overall analysis confidence 0-100",
                  },
                  recommendations: {
                    type: "array",
                    items: { type: "string" },
                    description: "List of recommended actions",
                  },
                  analysisNotes: {
                    type: "string",
                    description: "Additional notes about the analysis",
                  },
                },
                required: [
                  "damageDetected",
                  "damageTypes",
                  "overallSeverity",
                  "estimatedCostMin",
                  "estimatedCostMax",
                  "confidence",
                  "recommendations",
                  "analysisNotes",
                ],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "analyze_damage" } },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract the function call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "analyze_damage") {
      throw new Error("Unexpected response format from AI");
    }

    const analysisResult: DamageAnalysisResult = JSON.parse(toolCall.function.arguments);

    console.log("Damage analysis complete:", {
      damageDetected: analysisResult.damageDetected,
      damageCount: analysisResult.damageTypes.length,
      severity: analysisResult.overallSeverity,
      costRange: `$${analysisResult.estimatedCostMin}-$${analysisResult.estimatedCostMax}`,
    });

    return new Response(
      JSON.stringify(analysisResult),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("analyze-damage error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
