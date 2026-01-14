/**
 * Interior Roof Line Detector
 * 
 * Uses AI to detect ONLY interior roof lines (ridges, valleys, hips)
 * when the building perimeter is already accurately known from an
 * authoritative source (Solar API, Regrid, Mapbox).
 * 
 * This is more accurate than full AI detection because:
 * 1. Perimeter is known ground truth (not guessed)
 * 2. AI only needs to find interior features
 * 3. Context of known perimeter helps AI understand roof structure
 */

const AI_CALL_TIMEOUT_MS = 30000; // 30 second timeout

export interface InteriorLine {
  type: 'ridge' | 'hip' | 'valley';
  wkt: string;
  length_ft: number;
  confidence: number;
}

export interface InteriorLinesResult {
  ridges: InteriorLine[];
  hips: InteriorLine[];
  valleys: InteriorLine[];
  totalLinesDetected: number;
  detectionConfidence: number;
}

/**
 * Detect interior roof lines using AI Vision
 * Pass known perimeter as context to improve accuracy
 */
export async function detectInteriorRoofLines(
  satelliteImageUrl: string,
  perimeterVertices: Array<{ lat: number; lng: number }>,
  apiKey: string,
  centerLat: number,
  centerLng: number,
  imageSize: number = 640
): Promise<InteriorLinesResult> {
  console.log('🎯 Detecting interior roof lines with known perimeter context...');
  console.log(`📍 Perimeter has ${perimeterVertices.length} vertices`);

  // Format perimeter for context
  const perimeterContext = perimeterVertices.map((v, i) => 
    `Point ${i + 1}: (${v.lat.toFixed(6)}, ${v.lng.toFixed(6)})`
  ).join('\n');

  const prompt = `Analyze this satellite/aerial image of a residential roof.

CRITICAL CONTEXT - BUILDING PERIMETER IS ALREADY KNOWN:
The exact building perimeter has been detected from authoritative sources.
${perimeterContext}

YOUR TASK: Identify ONLY the INTERIOR roof structural lines:

1. RIDGES (highest horizontal lines where roof planes meet at the top)
   - Color: Light green
   - Usually run along the length of the house
   - Typically 1-2 main ridges on residential homes

2. HIPS (diagonal lines from corners going up to meet the ridge)
   - Color: Purple
   - Run at angles from building corners toward the ridge
   - Hip roofs have 4 hips typically

3. VALLEYS (where two roof planes meet going downward)
   - Color: Red
   - Usually where roof sections join (L-shaped houses, dormers)
   - Can be multiple on complex roofs

DO NOT include:
- Eaves (edge along gutters) - these are perimeter
- Rakes (sloped edges at gable ends) - these are perimeter
- Building perimeter - already known

For each interior line, provide pixel coordinates (0-${imageSize} scale):
- start_x, start_y
- end_x, end_y

Return JSON:
{
  "ridges": [{"start_x": N, "start_y": N, "end_x": N, "end_y": N, "confidence": 0-1}],
  "hips": [{"start_x": N, "start_y": N, "end_x": N, "end_y": N, "confidence": 0-1}],
  "valleys": [{"start_x": N, "start_y": N, "end_x": N, "end_y": N, "confidence": 0-1}],
  "roof_type": "hip|gable|complex|flat",
  "overall_confidence": 0-1
}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_CALL_TIMEOUT_MS);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: satelliteImageUrl } }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ AI API error:', response.status, errorText);
      return createEmptyResult();
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('⚠️ No JSON found in AI response');
      return createEmptyResult();
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Convert pixel coordinates to WKT with GPS
    const result: InteriorLinesResult = {
      ridges: convertLinesToWKT(parsed.ridges || [], 'ridge', centerLat, centerLng, imageSize),
      hips: convertLinesToWKT(parsed.hips || [], 'hip', centerLat, centerLng, imageSize),
      valleys: convertLinesToWKT(parsed.valleys || [], 'valley', centerLat, centerLng, imageSize),
      totalLinesDetected: 0,
      detectionConfidence: parsed.overall_confidence || 0.7,
    };

    result.totalLinesDetected = result.ridges.length + result.hips.length + result.valleys.length;

    console.log(`✅ Interior lines detected: ${result.ridges.length} ridges, ${result.hips.length} hips, ${result.valleys.length} valleys`);

    return result;

  } catch (error) {
    console.error('❌ Interior line detection error:', error);
    return createEmptyResult();
  }
}

/**
 * Convert pixel-based lines to WKT format with GPS coordinates
 */
function convertLinesToWKT(
  lines: Array<{ start_x: number; start_y: number; end_x: number; end_y: number; confidence?: number }>,
  type: 'ridge' | 'hip' | 'valley',
  centerLat: number,
  centerLng: number,
  imageSize: number
): InteriorLine[] {
  const result: InteriorLine[] = [];
  
  // Meters per pixel at zoom 20 for this latitude
  const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, 20);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);
  
  for (const line of lines) {
    if (!isValidPixelCoord(line.start_x, imageSize) || 
        !isValidPixelCoord(line.start_y, imageSize) ||
        !isValidPixelCoord(line.end_x, imageSize) ||
        !isValidPixelCoord(line.end_y, imageSize)) {
      continue;
    }

    // Convert pixel to GPS
    const startLat = centerLat + ((imageSize / 2 - line.start_y) * metersPerPixel / metersPerDegLat);
    const startLng = centerLng + ((line.start_x - imageSize / 2) * metersPerPixel / metersPerDegLng);
    const endLat = centerLat + ((imageSize / 2 - line.end_y) * metersPerPixel / metersPerDegLat);
    const endLng = centerLng + ((line.end_x - imageSize / 2) * metersPerPixel / metersPerDegLng);

    // Calculate length in feet
    const dLat = (endLat - startLat) * metersPerDegLat;
    const dLng = (endLng - startLng) * metersPerDegLng;
    const lengthMeters = Math.sqrt(dLat * dLat + dLng * dLng);
    const lengthFt = lengthMeters * 3.28084;

    // Skip very short lines
    if (lengthFt < 3) continue;

    const wkt = `LINESTRING(${startLng.toFixed(7)} ${startLat.toFixed(7)}, ${endLng.toFixed(7)} ${endLat.toFixed(7)})`;

    result.push({
      type,
      wkt,
      length_ft: Math.round(lengthFt * 10) / 10,
      confidence: line.confidence || 0.7,
    });
  }

  return result;
}

function isValidPixelCoord(value: number, max: number): boolean {
  return typeof value === 'number' && isFinite(value) && value >= 0 && value <= max;
}

function createEmptyResult(): InteriorLinesResult {
  return {
    ridges: [],
    hips: [],
    valleys: [],
    totalLinesDetected: 0,
    detectionConfidence: 0,
  };
}

/**
 * Combine authoritative footprint perimeter with AI-detected interior lines
 * Returns complete linear features for saving to database
 */
export function combineFootprintWithInteriorLines(
  perimeterVertices: Array<{ lat: number; lng: number }>,
  interiorLines: InteriorLinesResult,
  perimeterSource: string
): Array<{ type: string; wkt: string; length_ft: number }> {
  const features: Array<{ type: string; wkt: string; length_ft: number }> = [];

  // Add perimeter as eave/rake segments
  // For now, treat entire perimeter as eave (edge detection can refine later)
  if (perimeterVertices.length >= 3) {
    let totalPerimeterFt = 0;
    
    for (let i = 0; i < perimeterVertices.length; i++) {
      const j = (i + 1) % perimeterVertices.length;
      const v1 = perimeterVertices[i];
      const v2 = perimeterVertices[j];
      
      // Calculate segment length
      const metersPerDegLat = 111320;
      const metersPerDegLng = 111320 * Math.cos(v1.lat * Math.PI / 180);
      const dLat = (v2.lat - v1.lat) * metersPerDegLat;
      const dLng = (v2.lng - v1.lng) * metersPerDegLng;
      const lengthFt = Math.sqrt(dLat * dLat + dLng * dLng) * 3.28084;
      
      if (lengthFt >= 3) {
        const wkt = `LINESTRING(${v1.lng.toFixed(7)} ${v1.lat.toFixed(7)}, ${v2.lng.toFixed(7)} ${v2.lat.toFixed(7)})`;
        features.push({ type: 'eave', wkt, length_ft: Math.round(lengthFt * 10) / 10 });
        totalPerimeterFt += lengthFt;
      }
    }
    
    console.log(`📐 Added ${perimeterVertices.length} perimeter segments (${Math.round(totalPerimeterFt)}ft) from ${perimeterSource}`);
  }

  // Add interior lines
  for (const ridge of interiorLines.ridges) {
    features.push({ type: 'ridge', wkt: ridge.wkt, length_ft: ridge.length_ft });
  }
  for (const hip of interiorLines.hips) {
    features.push({ type: 'hip', wkt: hip.wkt, length_ft: hip.length_ft });
  }
  for (const valley of interiorLines.valleys) {
    features.push({ type: 'valley', wkt: valley.wkt, length_ft: valley.length_ft });
  }

  console.log(`✅ Combined features: ${features.length} total (${features.filter(f => f.type === 'ridge').length} ridges, ${features.filter(f => f.type === 'hip').length} hips, ${features.filter(f => f.type === 'valley').length} valleys, ${features.filter(f => f.type === 'eave').length} eaves)`);

  return features;
}
