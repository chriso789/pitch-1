/**
 * AI Vision Building Footprint Detection
 * 
 * Uses Claude Vision to detect building footprint from satellite imagery
 * when all external footprint APIs fail.
 * 
 * This is the LAST RESORT before solar_bbox_fallback and provides
 * much better accuracy than a simple bounding box.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DetectionRequest {
  imageUrl: string;
  imageBase64?: string;
  coordinates: { lat: number; lng: number };
  imageSize: number;
  zoom: number;
  measurementId?: string;
}

interface DetectedFootprint {
  vertices: Array<{ lat: number; lng: number }>;
  confidence: number;
  buildingType: string;
  estimatedComplexity: string;
  vertexCount: number;
  notes: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { imageUrl, imageBase64, coordinates, imageSize, zoom, measurementId }: DetectionRequest = await req.json()

    if (!coordinates?.lat || !coordinates?.lng) {
      return new Response(JSON.stringify({ error: 'Missing coordinates' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ 
        error: 'ANTHROPIC_API_KEY not configured',
        fallback: 'solar_bbox'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`🤖 AI Vision Footprint Detection for ${coordinates.lat}, ${coordinates.lng}`)

    // Get image data - either from base64 or fetch from URL
    let imageData: string
    let mediaType = 'image/png'

    if (imageBase64) {
      imageData = imageBase64
    } else if (imageUrl) {
      const imageResponse = await fetch(imageUrl)
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status}`)
      }
      const contentType = imageResponse.headers.get('content-type')
      if (contentType?.includes('jpeg')) mediaType = 'image/jpeg'
      const imageBuffer = await imageResponse.arrayBuffer()
      
      // Convert ArrayBuffer to base64 in chunks to avoid stack overflow
      // The spread operator on large Uint8Arrays causes "Maximum call stack size exceeded"
      const uint8Array = new Uint8Array(imageBuffer)
      const CHUNK_SIZE = 8192
      let binary = ''
      for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
        const chunk = uint8Array.slice(i, Math.min(i + CHUNK_SIZE, uint8Array.length))
        binary += String.fromCharCode(...chunk)
      }
      imageData = btoa(binary)
      console.log(`📸 Image fetched and encoded: ${uint8Array.length} bytes`)
    } else {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Call Claude Vision to detect building footprint
    const visionPrompt = `You are analyzing a satellite image of a residential property to detect the building footprint.

TASK: Identify and trace the exact roofline perimeter of the MAIN RESIDENTIAL BUILDING visible in this image.

INSTRUCTIONS:
1. Find the main house structure (largest residential building, typically near center)
2. Trace the OUTER EDGE of the visible roof - this is the building footprint from above
3. Include ALL roof sections that are part of the main structure (attached garages, extensions)
4. Return vertices as PERCENTAGES of image dimensions (0-100 for both x and y)

CRITICAL - EXCLUDE THESE:
- Pool enclosures / screen rooms (often visible as lighter colored rectangles)
- Detached garages or sheds
- Patios, pergolas, covered porches that extend beyond the main roof
- Pools, driveways, landscaping

OUTPUT FORMAT (JSON only, no markdown):
{
  "vertices": [
    {"x": 25.5, "y": 30.2},
    {"x": 75.3, "y": 28.8},
    {"x": 76.1, "y": 65.4},
    {"x": 24.8, "y": 66.1}
  ],
  "confidence": 0.85,
  "building_type": "residential",
  "estimated_complexity": "hip_roof_complex",
  "notes": "L-shaped building with 6 visible roof facets"
}

VERTEX REQUIREMENTS:
- Order vertices CLOCKWISE starting from the top-left corner
- Include enough vertices to accurately represent the building shape (4-12 typically)
- For L-shaped or T-shaped buildings, include the corner vertices that define the shape
- The polygon must be CLOSED (first and last vertices should be near each other)

CONFIDENCE SCORING:
- 0.9+ : Clear building outline, no obstructions
- 0.7-0.9 : Building visible but some edges unclear
- 0.5-0.7 : Partial visibility, some guessing required
- <0.5 : Low confidence, recommend manual verification

Return ONLY valid JSON, no other text.`

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageData,
              },
            },
            {
              type: 'text',
              text: visionPrompt,
            },
          ],
        }],
      }),
    })

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text()
      console.error('Claude API error:', claudeResponse.status, errorText)
      throw new Error(`Claude API error: ${claudeResponse.status}`)
    }

    const claudeData = await claudeResponse.json()
    const responseText = claudeData.content?.[0]?.text || ''
    
    console.log(`📝 Claude response received: ${responseText.substring(0, 200)}...`)

    // Parse JSON response
    let detectionResult: any
    try {
      // Clean up response - remove any markdown code blocks
      let jsonText = responseText.trim()
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json\n?/, '').replace(/\n?```$/, '')
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```\n?/, '').replace(/\n?```$/, '')
      }
      detectionResult = JSON.parse(jsonText)
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError)
      return new Response(JSON.stringify({ 
        error: 'Failed to parse AI response',
        fallback: 'solar_bbox',
        rawResponse: responseText.substring(0, 500)
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate and convert vertices
    if (!detectionResult.vertices || !Array.isArray(detectionResult.vertices) || detectionResult.vertices.length < 3) {
      return new Response(JSON.stringify({ 
        error: 'Invalid vertices from AI detection',
        fallback: 'solar_bbox'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Convert percentage coordinates to lat/lng
    const actualImageSize = imageSize || 640
    const actualZoom = zoom || 20
    
    const geoVertices = detectionResult.vertices.map((v: { x: number; y: number }) => {
      // Convert percentage to pixel coordinates
      const pixelX = (v.x / 100) * actualImageSize
      const pixelY = (v.y / 100) * actualImageSize
      
      // Convert pixel to geo coordinates
      const metersPerPixel = 156543.03392 * Math.cos(coordinates.lat * Math.PI / 180) / Math.pow(2, actualZoom)
      
      // Offset from center
      const centerPixel = actualImageSize / 2
      const deltaX = (pixelX - centerPixel) * metersPerPixel
      const deltaY = (centerPixel - pixelY) * metersPerPixel // Y is inverted
      
      // Apply offset to coordinates
      const lat = coordinates.lat + (deltaY / 111320) // 111320 meters per degree latitude
      const lng = coordinates.lng + (deltaX / (111320 * Math.cos(coordinates.lat * Math.PI / 180)))
      
      return { lat, lng }
    })

    const footprint: DetectedFootprint = {
      vertices: geoVertices,
      confidence: detectionResult.confidence || 0.7,
      buildingType: detectionResult.building_type || 'residential',
      estimatedComplexity: detectionResult.estimated_complexity || 'unknown',
      vertexCount: geoVertices.length,
      notes: detectionResult.notes || ''
    }

    console.log(`✅ AI Vision detected footprint: ${footprint.vertexCount} vertices, ${(footprint.confidence * 100).toFixed(0)}% confidence`)

    // Update measurement record if provided
    if (measurementId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      
      await supabase
        .from('roof_measurements')
        .update({
          ai_vision_footprint_confidence: footprint.confidence,
          ai_vision_detection_attempts: 1, // Will be incremented on retries
          footprint_detection_method: 'ai_vision',
          footprint_source: 'ai_vision_detected',
          updated_at: new Date().toISOString()
        })
        .eq('id', measurementId)
    }

    return new Response(JSON.stringify({
      success: true,
      footprint,
      source: 'ai_vision_detected',
      requiresManualReview: footprint.confidence < 0.8
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('AI Vision Detection error:', error)
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      fallback: 'solar_bbox'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
