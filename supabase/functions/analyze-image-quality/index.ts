import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ImageQualityResult {
  shadow_coverage_pct: number
  brightness_score: number
  contrast_score: number
  obstruction_detected: boolean
  obstruction_types: string[]
  overall_quality_score: number
  shadow_risk: 'low' | 'medium' | 'high'
  factors: string[]
  recommendation: 'proceed' | 'flag_for_review' | 'request_new_imagery'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()
  
  try {
    const { imageUrl, address } = await req.json()
    
    if (!imageUrl) {
      throw new Error('imageUrl is required')
    }
    
    console.log('🔍 Analyzing image quality for:', address || 'unknown address')
    
    // Use Lovable AI (Gemini Flash) for vision analysis
    const analysisPrompt = `Analyze this satellite roof image for quality issues that could affect measurement accuracy.

Evaluate these specific factors:

1. SHADOW COVERAGE: Estimate what percentage of the roof area is covered by shadows from:
   - Trees (most common obstruction)
   - Adjacent buildings
   - Self-shadowing from roof features (dormers, chimneys)
   - Time-of-day shadows

2. BRIGHTNESS: Is the image properly exposed?
   - Score 0-100 where 50 is ideal, <30 is too dark, >80 is overexposed
   
3. CONTRAST: Can roof edges be clearly distinguished?
   - Score 0-100 where 100 = crystal clear edges, 50 = acceptable, <30 = difficult to trace
   
4. OBSTRUCTIONS: Are there any of these blocking the roof view?
   - Clouds or haze
   - Tree canopy overhang
   - Image artifacts or stitching errors
   - Glare or reflections

5. OVERALL QUALITY: Score 0-100 for suitability of this image for accurate roof measurement

Respond ONLY with valid JSON in this exact format:
{
  "shadow_coverage_pct": <number 0-100>,
  "brightness_score": <number 0-100>,
  "contrast_score": <number 0-100>,
  "obstruction_detected": <boolean>,
  "obstruction_types": [<string array of detected obstructions>],
  "overall_quality_score": <number 0-100>,
  "shadow_risk": "<low|medium|high>",
  "factors": [<string array of quality factors affecting measurement>],
  "recommendation": "<proceed|flag_for_review|request_new_imagery>"
}`

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: analysisPrompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 1000,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('AI gateway error:', response.status, errorText)
      
      // Return fallback result instead of failing
      const fallbackResult: ImageQualityResult = {
        shadow_coverage_pct: 20,
        brightness_score: 50,
        contrast_score: 70,
        obstruction_detected: false,
        obstruction_types: [],
        overall_quality_score: 75,
        shadow_risk: 'low',
        factors: ['AI analysis unavailable - using defaults'],
        recommendation: 'proceed'
      }
      
      return new Response(JSON.stringify({
        success: true,
        result: fallbackResult,
        fallback: true,
        timing: { totalMs: Date.now() - startTime }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    console.log('🤖 AI response received, parsing...')
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1]
    }
    
    let result: ImageQualityResult
    try {
      result = JSON.parse(jsonStr.trim())
      
      // Validate and normalize
      result.shadow_coverage_pct = Math.max(0, Math.min(100, result.shadow_coverage_pct || 0))
      result.brightness_score = Math.max(0, Math.min(100, result.brightness_score || 50))
      result.contrast_score = Math.max(0, Math.min(100, result.contrast_score || 70))
      result.overall_quality_score = Math.max(0, Math.min(100, result.overall_quality_score || 75))
      result.obstruction_detected = Boolean(result.obstruction_detected)
      result.obstruction_types = Array.isArray(result.obstruction_types) ? result.obstruction_types : []
      result.factors = Array.isArray(result.factors) ? result.factors : []
      
      // Ensure shadow_risk is valid
      if (!['low', 'medium', 'high'].includes(result.shadow_risk)) {
        result.shadow_risk = result.shadow_coverage_pct > 40 ? 'high' : 
                            result.shadow_coverage_pct > 20 ? 'medium' : 'low'
      }
      
      // Ensure recommendation is valid
      if (!['proceed', 'flag_for_review', 'request_new_imagery'].includes(result.recommendation)) {
        result.recommendation = result.overall_quality_score < 50 ? 'flag_for_review' : 'proceed'
      }
      
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError, 'Content:', content)
      
      // Return fallback
      result = {
        shadow_coverage_pct: 25,
        brightness_score: 50,
        contrast_score: 60,
        obstruction_detected: false,
        obstruction_types: [],
        overall_quality_score: 65,
        shadow_risk: 'medium',
        factors: ['AI response parsing failed - using conservative defaults'],
        recommendation: 'flag_for_review'
      }
    }
    
    const totalTime = Date.now() - startTime
    console.log(`✅ Image quality analysis complete in ${totalTime}ms:`, result)

    return new Response(JSON.stringify({
      success: true,
      result,
      timing: { totalMs: totalTime }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('❌ Error analyzing image quality:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      result: {
        shadow_coverage_pct: 20,
        brightness_score: 50,
        contrast_score: 70,
        obstruction_detected: false,
        obstruction_types: [],
        overall_quality_score: 70,
        shadow_risk: 'low',
        factors: ['Analysis error - using defaults'],
        recommendation: 'proceed'
      }
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
