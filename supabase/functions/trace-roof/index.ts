const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lat, lng, imageUrl, zoom } = await req.json();

    if (!lat || !lng) {
      return new Response(JSON.stringify({ error: "lat and lng are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build satellite image URL if not provided
    let satImageUrl = imageUrl;
    const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || Deno.env.get("GOOGLE_SOLAR_API_KEY");
    if (!satImageUrl) {
      // Zoom 21 + scale=2 gives a tight, high-res crop centered on the property
      const zoomLevel = zoom || 21;
      satImageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoomLevel}&size=640x640&scale=2&maptype=satellite&key=${GOOGLE_MAPS_API_KEY}`;
    }

    console.log("Tracing roof at", lat, lng, "using image:", satImageUrl.substring(0, 80));

    // With scale=2 the actual image is 1280x1280 pixels
    const imgSize = 1280;

    const systemPrompt = `You are an expert roof measurement analyst. You will be shown a satellite/aerial image centered on a single property.

IMPORTANT: Trace ONLY the roof of the building at the CENTER of the image. Ignore all neighboring buildings, driveways, pools, trees, and other structures.

The image is ${imgSize}x${imgSize} pixels. Provide all coordinates as pixel positions where (0,0) is top-left and (${imgSize},${imgSize}) is bottom-right.

For each component, provide the start and end pixel coordinates [x, y].

Identify these component types:
- **ridges**: Horizontal peak lines where two roof planes meet at the top
- **hips**: Sloped lines from ridge ends down to eave corners (exterior corners)
- **valleys**: Lines where two roof planes meet forming an interior angle
- **eaves**: Bottom horizontal edges of the roof
- **rakes**: Sloped gable edges (side edges on gable ends)
- **step_flashing**: Where roof meets a vertical wall

CRITICAL RULES:
1. Trace the ACTUAL roof edges visible in the image, not imagined ones
2. ONLY trace the CENTER building's roof — ignore all other buildings
3. Every line must connect precisely to adjacent lines (vertices must be shared)
4. Ridges run along the top peak. Hips slope downward from ridge endpoints to eave corners.
5. Valleys are interior corners where planes meet going downward.
6. Eaves are the lowest horizontal edges. Rakes are the sloped edges on gable ends.
7. Include ALL visible components of the center roof including dormers and extensions.
8. Coordinates must be pixel positions on the ${imgSize}x${imgSize} image.

Return your response as a JSON object with this exact structure:
{
  "roofType": "hip|gable|cross-hip|complex|dutch-hip|etc",
  "components": {
    "ridges": [{"start": [x1,y1], "end": [x2,y2], "lengthEstimateFt": number}],
    "hips": [{"start": [x1,y1], "end": [x2,y2], "lengthEstimateFt": number}],
    "valleys": [{"start": [x1,y1], "end": [x2,y2], "lengthEstimateFt": number}],
    "eaves": [{"start": [x1,y1], "end": [x2,y2], "lengthEstimateFt": number}],
    "rakes": [{"start": [x1,y1], "end": [x2,y2], "lengthEstimateFt": number}],
    "step_flashing": [{"start": [x1,y1], "end": [x2,y2], "lengthEstimateFt": number}]
  },
  "facets": [
    {
      "id": "F1",
      "vertices": [[x,y], [x,y], ...],
      "estimatedPitch": "6/12",
      "estimatedAreaSqft": number
    }
  ],
  "confidence": number,
  "notes": "string describing what you see"
}

Be precise with coordinates. Every ridge endpoint should connect to a hip or rake. Every hip should connect from a ridge to an eave corner. The geometry must be topologically consistent.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this satellite image of a roof at coordinates ${lat}, ${lng}. Trace all roof components (ridges, hips, valleys, eaves, rakes, step flashing) with precise pixel coordinates on this 640x640 image. Return JSON only.`
              },
              {
                type: "image_url",
                image_url: { url: satImageUrl }
              }
            ]
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "trace_roof_components",
              description: "Return traced roof components with pixel coordinates",
              parameters: {
                type: "object",
                properties: {
                  roofType: { type: "string", description: "Type of roof (hip, gable, cross-hip, complex, etc.)" },
                  components: {
                    type: "object",
                    properties: {
                      ridges: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            start: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            end: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            lengthEstimateFt: { type: "number" }
                          },
                          required: ["start", "end"]
                        }
                      },
                      hips: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            start: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            end: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            lengthEstimateFt: { type: "number" }
                          },
                          required: ["start", "end"]
                        }
                      },
                      valleys: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            start: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            end: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            lengthEstimateFt: { type: "number" }
                          },
                          required: ["start", "end"]
                        }
                      },
                      eaves: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            start: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            end: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            lengthEstimateFt: { type: "number" }
                          },
                          required: ["start", "end"]
                        }
                      },
                      rakes: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            start: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            end: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            lengthEstimateFt: { type: "number" }
                          },
                          required: ["start", "end"]
                        }
                      },
                      step_flashing: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            start: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            end: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            lengthEstimateFt: { type: "number" }
                          },
                          required: ["start", "end"]
                        }
                      }
                    },
                    required: ["ridges", "hips", "valleys", "eaves", "rakes"]
                  },
                  facets: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        vertices: { type: "array", items: { type: "array", items: { type: "number" } } },
                        estimatedPitch: { type: "string" },
                        estimatedAreaSqft: { type: "number" }
                      },
                      required: ["id", "vertices"]
                    }
                  },
                  confidence: { type: "number", description: "0-100 confidence score" },
                  notes: { type: "string" }
                },
                required: ["roofType", "components", "confidence"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "trace_roof_components" } }
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings > Workspace > Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    console.log("AI response received, parsing tool call...");

    // Extract the tool call result
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let traceData;

    if (toolCall?.function?.arguments) {
      traceData = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    } else {
      // Fallback: try parsing from message content
      const content = aiResult.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        traceData = JSON.parse(jsonMatch[0]);
      } else {
        return new Response(JSON.stringify({ error: "Could not parse AI response", raw: content.substring(0, 500) }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    console.log("Trace complete:", traceData.roofType, "confidence:", traceData.confidence);

    return new Response(JSON.stringify({
      success: true,
      data: traceData,
      imageUrl: satImageUrl,
      imageSize: 640,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("trace-roof error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
