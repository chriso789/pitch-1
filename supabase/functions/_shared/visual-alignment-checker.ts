// Visual Alignment Checker - QA pass for roof overlay verification
// Uses AI vision to verify overlay lines match satellite imagery

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!

interface RoofLine {
  start: [number, number];
  end: [number, number];
  confidence: number;
  requiresReview: boolean;
  source?: string;
}

interface AlignmentResult {
  lineIndex: number;
  lineType: 'ridge' | 'hip' | 'valley';
  originalConfidence: number;
  alignmentScore: number;
  offsetEstimateFt: number;
  aligned: boolean;
  adjustedStart?: [number, number];
  adjustedEnd?: [number, number];
  notes?: string;
}

interface VerificationResult {
  overallScore: number;
  requiresManualReview: boolean;
  alignmentResults: AlignmentResult[];
  ridges: RoofLine[];
  hips: RoofLine[];
  valleys: RoofLine[];
}

/**
 * Verify visual alignment of roof overlay lines against satellite imagery
 * Uses AI vision to check if lines match visible features and suggests adjustments
 */
export async function verifyOverlayAlignment(
  imageUrl: string,
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] },
  coordinates: { lat: number; lng: number }
): Promise<VerificationResult> {
  
  const allLines = [
    ...features.ridges.map((r, i) => ({ ...r, type: 'ridge' as const, index: i })),
    ...features.hips.map((h, i) => ({ ...h, type: 'hip' as const, index: i })),
    ...features.valleys.map((v, i) => ({ ...v, type: 'valley' as const, index: i }))
  ]

  if (allLines.length === 0) {
    return {
      overallScore: 50,
      requiresManualReview: true,
      alignmentResults: [],
      ridges: features.ridges,
      hips: features.hips,
      valleys: features.valleys
    }
  }

  // Build verification prompt
  const lineDescriptions = allLines.map((line, idx) => {
    const startPct = geoToPixelPct(line.start, coordinates)
    const endPct = geoToPixelPct(line.end, coordinates)
    return `Line ${idx} (${line.type}): from (${startPct.x.toFixed(1)}%, ${startPct.y.toFixed(1)}%) to (${endPct.x.toFixed(1)}%, ${endPct.y.toFixed(1)}%)`
  }).join('\n')

  const prompt = `You are a roof measurement QA specialist verifying overlay accuracy.

I have drawn these lines on a satellite roof image:
${lineDescriptions}

For EACH line, evaluate:
1. Does it align with the actual visible roof feature? 
2. How many feet is it offset from the correct position?
3. What adjustment would improve it?

ALIGNMENT CRITERIA:
- Ridge: Should follow the bright peak line at the roof's highest point
- Hip: Should trace the diagonal shadow line from ridge end to corner
- Valley: Should follow the dark trough where two roof planes meet

Return JSON array with one entry per line:
[
  {
    "lineIndex": 0,
    "lineType": "ridge",
    "alignmentScore": 95,
    "offsetEstimateFt": 0.5,
    "aligned": true,
    "adjustmentNeeded": "none",
    "notes": "Ridge accurately placed on visible peak"
  },
  {
    "lineIndex": 1,
    "lineType": "hip",
    "alignmentScore": 72,
    "offsetEstimateFt": 3.5,
    "aligned": false,
    "adjustmentNeeded": "shift endpoint 3ft toward corner",
    "notes": "Hip line misses corner by noticeable margin"
  }
]

Be strict - only mark as aligned if the line truly follows the visible feature.`

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
            content: 'You are a roof measurement QA expert. Verify overlay accuracy strictly. Return only valid JSON array.' 
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 2000
      })
    })

    if (!response.ok) {
      console.warn('Visual alignment check failed:', response.status)
      return createFallbackResult(features)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.warn('No JSON array found in alignment response')
      return createFallbackResult(features)
    }

    const verifications = JSON.parse(jsonMatch[0])
    
    // Process verification results
    const alignmentResults: AlignmentResult[] = verifications.map((v: any) => ({
      lineIndex: v.lineIndex,
      lineType: v.lineType,
      originalConfidence: allLines[v.lineIndex]?.confidence || 0,
      alignmentScore: v.alignmentScore || 50,
      offsetEstimateFt: v.offsetEstimateFt || 0,
      aligned: v.aligned || false,
      notes: v.notes || v.adjustmentNeeded
    }))

    // Apply verification scores to lines
    const updateLines = (lines: RoofLine[], type: 'ridge' | 'hip' | 'valley'): RoofLine[] => {
      return lines.map((line, idx) => {
        const verification = alignmentResults.find(
          ar => ar.lineType === type && ar.lineIndex === idx
        )
        if (verification) {
          return {
            ...line,
            confidence: verification.alignmentScore,
            requiresReview: !verification.aligned || verification.alignmentScore < 75
          }
        }
        return line
      })
    }

    const verifiedRidges = updateLines(features.ridges, 'ridge')
    const verifiedHips = updateLines(features.hips, 'hip')
    const verifiedValleys = updateLines(features.valleys, 'valley')

    // Calculate overall score
    const scores = alignmentResults.map(ar => ar.alignmentScore)
    const overallScore = scores.length > 0 
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 50

    const misalignedCount = alignmentResults.filter(ar => !ar.aligned).length

    return {
      overallScore,
      requiresManualReview: misalignedCount > 0 || overallScore < 75,
      alignmentResults,
      ridges: verifiedRidges,
      hips: verifiedHips,
      valleys: verifiedValleys
    }

  } catch (error) {
    console.error('Visual alignment verification error:', error)
    return createFallbackResult(features)
  }
}

// Convert geo coordinates to pixel percentage for image
function geoToPixelPct(
  coord: [number, number],
  center: { lat: number; lng: number },
  imageSize: number = 640,
  zoom: number = 20
): { x: number; y: number } {
  const [lng, lat] = coord
  
  const metersPerPixel = (156543.03392 * Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180)
  
  const metersX = (lng - center.lng) * metersPerDegLng
  const metersY = (lat - center.lat) * metersPerDegLat
  
  const pxOffsetX = metersX / metersPerPixel
  const pxOffsetY = -metersY / metersPerPixel
  
  return {
    x: ((pxOffsetX / imageSize) + 0.5) * 100,
    y: ((pxOffsetY / imageSize) + 0.5) * 100
  }
}

// Create fallback result when verification fails
function createFallbackResult(
  features: { ridges: RoofLine[]; hips: RoofLine[]; valleys: RoofLine[] }
): VerificationResult {
  return {
    overallScore: 70,
    requiresManualReview: true,
    alignmentResults: [],
    ridges: features.ridges.map(r => ({ ...r, requiresReview: true })),
    hips: features.hips.map(h => ({ ...h, requiresReview: true })),
    valleys: features.valleys.map(v => ({ ...v, requiresReview: true }))
  }
}

/**
 * Suggest corrections for misaligned lines
 * Returns adjusted coordinates that better match visible features
 */
export async function suggestLineCorrections(
  imageUrl: string,
  misalignedLines: Array<{ line: RoofLine; type: string; alignmentResult: AlignmentResult }>,
  coordinates: { lat: number; lng: number }
): Promise<Map<number, { start: [number, number]; end: [number, number] }>> {
  
  const corrections = new Map<number, { start: [number, number]; end: [number, number] }>()
  
  if (misalignedLines.length === 0) return corrections

  const prompt = `For these misaligned roof lines, provide corrected coordinates (as image percentages 0-100):

${misalignedLines.map((ml, i) => {
  const startPct = geoToPixelPct(ml.line.start, coordinates)
  const endPct = geoToPixelPct(ml.line.end, coordinates)
  return `Line ${i} (${ml.type}): Current (${startPct.x.toFixed(1)}%, ${startPct.y.toFixed(1)}%) to (${endPct.x.toFixed(1)}%, ${endPct.y.toFixed(1)}%) - ${ml.alignmentResult.notes}`
}).join('\n')}

Look at the actual roof features in the image and provide CORRECTED positions.

Return JSON:
[
  {"lineIndex": 0, "startX": 25.5, "startY": 44.2, "endX": 74.8, "endY": 44.2}
]`

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'system', content: 'You are a roof measurement correction specialist. Return only valid JSON array.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 1500
      })
    })

    if (!response.ok) return corrections

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return corrections

    const correctionData = JSON.parse(jsonMatch[0])
    
    for (const c of correctionData) {
      if (c.lineIndex >= 0 && c.lineIndex < misalignedLines.length) {
        corrections.set(c.lineIndex, {
          start: pixelPctToGeo(c.startX, c.startY, coordinates),
          end: pixelPctToGeo(c.endX, c.endY, coordinates)
        })
      }
    }

  } catch (error) {
    console.error('Correction suggestion error:', error)
  }

  return corrections
}

// Convert pixel percentage to geo coordinates
function pixelPctToGeo(
  xPct: number,
  yPct: number,
  center: { lat: number; lng: number },
  imageSize: number = 640,
  zoom: number = 20
): [number, number] {
  const metersPerPixel = (156543.03392 * Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom)
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180)
  
  const pxOffsetX = ((xPct / 100) - 0.5) * imageSize
  const pxOffsetY = ((yPct / 100) - 0.5) * imageSize
  
  const metersX = pxOffsetX * metersPerPixel
  const metersY = -pxOffsetY * metersPerPixel
  
  return [
    center.lng + metersX / metersPerDegLng,
    center.lat + metersY / metersPerDegLat
  ]
}
