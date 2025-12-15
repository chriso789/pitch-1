import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// AI VISION PROMPT FOR BUILDING DETECTION
const BUILDING_DETECTION_PROMPT = `
You are a professional roof measurement expert analyzing satellite imagery.

TASK: Identify the building structure and all roof components in this aerial image.

PROVIDE DETAILED JSON OUTPUT WITH:

1. BUILDING FOOTPRINT
   - Identify the main building outline (polygon coordinates in pixels)
   - Separate attached structures (garage, additions, etc.)
   - Note any non-roof structures (pools, sheds, decks)

2. ROOF FACETS (Individual roof planes)
   - Count the number of distinct roof planes/facets
   - Provide polygon coordinates for each facet (in pixels from top-left origin)
   - Estimate the orientation (North, South, East, West, NE, NW, SE, SW)
   
3. ROOF EDGES BY TYPE
   - RIDGE: Top horizontal edge where two roof planes meet at peak
   - HIP: Sloped external corner where two roof planes meet
   - VALLEY: Sloped internal corner where two roof planes meet
   - EAVE: Horizontal bottom edge where water drips off
   - RAKE: Sloped edge on a gable end
   
   For EACH edge, provide:
   - Type (ridge/hip/valley/eave/rake)
   - Start and end coordinates in pixels
   - Estimated length based on visual scale
   
4. PITCH DETECTION
   - Analyze shadows, roof line angles, and context clues
   - Estimate pitch for each facet (1/12, 2/12, ... 12/12)
   - Rate confidence (high/medium/low) for each pitch estimate
   - Note if pitch appears to change within a facet
   
5. ROOF FEATURES
   - Chimneys (location and approximate size)
   - Skylights (location and approximate size)
   - Vents (count and locations)
   - Dormers (outline each dormer separately)
   - Solar panels (if present)

OUTPUT FORMAT (STRICT JSON):
{
  "buildingFootprint": {
    "main": [
      {"x": 100, "y": 200},
      {"x": 500, "y": 200},
      {"x": 500, "y": 600},
      {"x": 100, "y": 600}
    ],
    "attachedStructures": []
  },
  "roofType": "hip",
  "facets": [
    {
      "facetNumber": 1,
      "polygon": [
        {"x": 100, "y": 200},
        {"x": 300, "y": 100},
        {"x": 500, "y": 200}
      ],
      "orientation": "North",
      "estimatedPitch": "6/12",
      "pitchConfidence": "high",
      "areaPixels": 40000,
      "notes": "Main front facet"
    }
  ],
  "edges": {
    "ridges": [
      {
        "start": {"x": 300, "y": 100},
        "end": {"x": 300, "y": 500},
        "lengthPixels": 400,
        "facetsConnected": [1, 2]
      }
    ],
    "hips": [],
    "valleys": [],
    "eaves": [],
    "rakes": []
  },
  "features": {
    "chimneys": [],
    "skylights": [],
    "vents": [],
    "dormers": []
  },
  "pitchAnalysis": {
    "method": "shadow analysis",
    "overallPitchRange": "6/12 to 8/12",
    "confidence": "medium",
    "notes": "Steeper pitch on south side based on shadow length"
  }
}

IMPORTANT MEASUREMENT PRINCIPLES:
- Pixel coordinates use TOP-LEFT as origin (0,0)
- X increases to the RIGHT
- Y increases DOWNWARD
- Polygon points should be in clockwise order
- Close polygons (last point can equal first point or omit)
- Provide pixel measurements (will be converted to feet later)
`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { imageBase64, imageBounds, dimensions } = await req.json()
    
    if (!imageBase64) {
      throw new Error('imageBase64 is required')
    }

    console.log('🏠 Detecting building structure with AI...')

    // Send image to AI Vision API
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: BUILDING_DETECTION_PROMPT },
              { type: 'image_url', image_url: { url: imageBase64 } }
            ]
          }
        ],
        max_completion_tokens: 4000,
        temperature: 0.1
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('AI API error:', response.status, errorText)
      throw new Error(`AI API error: ${response.status}`)
    }

    const aiResponse = await response.json()
    let content = aiResponse.choices?.[0]?.message?.content || ''
    
    // Clean and parse JSON
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    let aiAnalysis
    try {
      aiAnalysis = JSON.parse(content)
    } catch (parseError) {
      console.error('Failed to parse AI response:', content)
      throw new Error('AI returned invalid JSON')
    }

    // Convert pixel coordinates to GPS coordinates
    const gpsAnalysis = imageBounds && dimensions 
      ? convertPixelsToGPS(aiAnalysis, imageBounds, dimensions)
      : null

    console.log(`✅ Detection complete: ${aiAnalysis.roofType} roof with ${aiAnalysis.facets?.length || 0} facets`)

    return new Response(JSON.stringify({
      success: true,
      aiAnalysis,
      gpsAnalysis,
      rawResponse: aiResponse
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error: any) {
    console.error('❌ Building detection error:', error)
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Convert pixel coordinates to GPS
function convertPixelsToGPS(analysis: any, bounds: any, dimensions: any) {
  const { topLeft, bottomRight } = bounds
  const { width, height } = dimensions
  
  const latRange = topLeft.lat - bottomRight.lat
  const lngRange = bottomRight.lng - topLeft.lng
  
  function pixelToGPS(point: {x: number, y: number}) {
    const lat = topLeft.lat - (point.y / height) * latRange
    const lng = topLeft.lng + (point.x / width) * lngRange
    return { lat, lng }
  }
  
  // Convert all polygons
  const converted = {
    ...analysis,
    buildingFootprint: {
      main: analysis.buildingFootprint?.main?.map(pixelToGPS) || [],
      attachedStructures: analysis.buildingFootprint?.attachedStructures?.map((s: any) => ({
        ...s,
        polygon: s.polygon?.map(pixelToGPS) || []
      })) || []
    },
    facets: (analysis.facets || []).map((facet: any) => ({
      ...facet,
      polygon: facet.polygon?.map(pixelToGPS) || []
    })),
    edges: {
      ridges: (analysis.edges?.ridges || []).map((e: any) => ({
        ...e,
        start: pixelToGPS(e.start),
        end: pixelToGPS(e.end)
      })),
      hips: (analysis.edges?.hips || []).map((e: any) => ({
        ...e,
        start: pixelToGPS(e.start),
        end: pixelToGPS(e.end)
      })),
      valleys: (analysis.edges?.valleys || []).map((e: any) => ({
        ...e,
        start: pixelToGPS(e.start),
        end: pixelToGPS(e.end)
      })),
      eaves: (analysis.edges?.eaves || []).map((e: any) => ({
        ...e,
        start: pixelToGPS(e.start),
        end: pixelToGPS(e.end)
      })),
      rakes: (analysis.edges?.rakes || []).map((e: any) => ({
        ...e,
        start: pixelToGPS(e.start),
        end: pixelToGPS(e.end)
      }))
    }
  }
  
  return converted
}
