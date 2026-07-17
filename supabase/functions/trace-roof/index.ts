const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lat, lng, imageUrl, zoom, mapSize } = await req.json();

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

    const requestedMapSize = Number(mapSize) || 640;
    const staticMapSize = Math.max(480, Math.min(640, requestedMapSize));
    const zoomLevel = Math.max(21, Math.min(22, Number(zoom) || 22));
    const imgSize = staticMapSize * 2;

    // Build satellite image URL if not provided
    let satImageUrl = imageUrl;
    const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || Deno.env.get("GOOGLE_SOLAR_API_KEY");
    if (!satImageUrl) {
      satImageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoomLevel}&size=${staticMapSize}x${staticMapSize}&scale=2&maptype=satellite&key=${GOOGLE_MAPS_API_KEY}`;
    }

    console.log("Tracing roof at", lat, lng, "using image:", satImageUrl.substring(0, 80));

    const cx = Math.round(imgSize/2);
    const cy = Math.round(imgSize/2);

    const systemPrompt = `You are a senior roof estimator with 20 years of field experience reading aerial imagery. You will be shown a high-zoom satellite image tightly centered on ONE property. Your job is to produce a COMPLETE and CORRECTLY-CLASSIFIED wireframe of that roof — matching the accuracy of an EagleView/Hover report.

===========================================
STEP 1 — CENTER TARGET ONLY
===========================================
The target roof is the building directly under the center pixel (${cx}, ${cy}) of this ${imgSize}x${imgSize} image.
- Trace ONLY this roof. Ignore every neighbor, shed, garage-detached-from-house, pool cage, tree, driveway.
- INCLUDE every attached section of the target roof: main house, attached garage, front porch, back lanai/patio cover, dormers, bay windows, wings. Attached lower roofs are part of the target — do NOT drop them.

===========================================
STEP 2 — CLASSIFY THE ROOF TYPE FIRST
===========================================
Before drawing lines, identify the overall roof type by looking at the SHADING and RIDGE LAYOUT:
- **Gable**: two sloped planes meeting at one long ridge; triangular gable walls at both ends. Side edges = rakes.
- **Hip**: four sloped planes, ridge shorter than footprint, all sides slope down to eaves. NO gable walls. Corner edges = HIPS.
- **Cross-hip / Cross-gable**: two hip or gable sections meeting at right angles → produces VALLEYS at the inside corners where the two sections join.
- **Dutch hip / Hip-and-gable combo**: hip with a small gable at ridge end.
- **Complex**: multiple wings, dormers, porch add-ons.

State the roof type in the "roofType" field and USE IT to constrain classification below.

===========================================
STEP 3 — LINE CLASSIFICATION (this is where the AI usually fails — read carefully)
===========================================

**RIDGE** — HIGHEST line on the roof. Two planes meet and slope DOWN AWAY from it on both sides. Ridges are typically horizontal in the aerial view (perpendicular to building's long axis is common but not required). A hip roof has ONE short ridge; a gable roof has ONE long ridge; complex roofs have multiple ridges (one per section/wing).

**HIP** — Sloped line running from a RIDGE ENDPOINT down to an OUTSIDE CORNER of the eave (exterior/convex corner of the footprint). Both planes on either side slope DOWNWARD AND AWAY from the hip line. If you see an X pattern on a rectangular hip roof, the four diagonal lines from the central ridge to the four building corners are HIPS, NOT valleys.
   → **Common mistake to AVOID**: On a simple hip roof, do NOT label the four diagonals as "valleys". Those are HIPS. Valleys only appear where two roof SECTIONS meet (L-shape, T-shape, cross-hip, porch attaching to main house).

**VALLEY** — Sloped line at an INTERIOR/CONCAVE corner where two roof sections meet and water would drain into the line. Both planes slope DOWN TOWARD the valley line. Valleys only exist when the footprint has an inside corner (L, T, U, cross shapes) or where a lower attached roof (porch, wing, dormer) meets a higher roof plane.
   → If the footprint is a simple rectangle with no wings/porches, there are ZERO valleys.

**EAVE** — HORIZONTAL bottom edge of a roof plane (the drip line, gutter line). Eaves follow the footprint perimeter on the low side of every sloped plane. On a hip roof, ALL four perimeter edges are eaves. On a gable roof, only the two long sides are eaves.

**RAKE** — SLOPED perimeter edge on a GABLE END (the diagonal edge of the triangular gable wall going from eave corner up to ridge peak). Rakes ONLY exist on gable ends. A pure hip roof has ZERO rakes. If you're labeling a rake, you must also be able to point to the gable wall it belongs to.
   → **Common mistake to AVOID**: Do NOT label hip lines as rakes. Rakes are on the perimeter of a gable end; hips are diagonal interior-of-footprint edges going to outside corners.

**STEP_FLASHING** — Where a sloped roof plane butts into a vertical wall (e.g., where a porch roof meets the two-story house wall).

===========================================
STEP 4 — COMPLETENESS CHECKLIST (do all before returning)
===========================================
1. Trace EVERY visible ridge — main house ridge, garage ridge, porch ridge, dormer ridges, lanai ridge. Missing a ridge = missing hips/valleys.
2. For EVERY ridge endpoint on a hip section: draw a hip line to the nearest outside eave corner.
3. For EVERY inside footprint corner (L/T/cross): draw a valley from that corner up to where the two ridges meet.
4. Every eave corner must be the endpoint of at least one perimeter edge on each adjacent side.
5. Perimeter edges (eaves + rakes) must form a CLOSED polygon matching the footprint.
6. Include lower attached roofs (porch, lanai, garage add-on). Where a lower roof meets a higher wall of the main house, that intersection line is either a step_flashing edge or, if the two roofs share a plane, a valley.
7. Every line endpoint must SHARE coordinates with adjacent line endpoints (snap to shared vertices — tolerance ~5 px).

===========================================
STEP 5 — SELF-CHECK BEFORE RETURNING
===========================================
Run these validations mentally:
- roofType = "hip" or "cross-hip"? → valleys.length should be 0 UNLESS there are wings/porches. hips.length should be >= 4 (one per outside corner).
- roofType = "gable"? → hips.length should be 0. rakes should be present (2 per gable end).
- If you produced 4 "valleys" forming an X on a rectangular building with no wings → RECLASSIFY them as HIPS.
- Every ridge must connect to either two hips (hip end) or two rakes (gable end) at each endpoint.
- Facet count should equal: (# ridges × 2) roughly + porch/wing facets. A simple hip = 4 facets. A T-shape hip = 6-8 facets.

Return JSON with this exact structure:
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
  "facets": [{"id": "F1", "vertices": [[x,y], ...], "estimatedPitch": "6/12", "estimatedAreaSqft": number}],
  "confidence": number,
  "notes": "string describing what you see"
}`;

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
                text: `Analyze this satellite image of a roof at coordinates ${lat}, ${lng}. Trace ONLY the roof of the building at the CENTER of this ${imgSize}x${imgSize} image. Return all component pixel coordinates. Return JSON only.`
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
      imageSize: imgSize,
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
