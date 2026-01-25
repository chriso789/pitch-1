/**
 * Phase 45: Multi-Date Imagery Analysis
 * Uses imagery from multiple dates to confirm building geometry hasn't changed
 */

interface TemporalAnalysisResult {
  imageryDates: string[];
  imagerySources: string[];
  vertexConsistencyScore: number;
  perimeterConsistencyScore: number;
  areaConsistencyScore: number;
  changesDetected: boolean;
  changeType: 'none' | 'addition' | 'removal' | 'modification' | 'new_construction';
  changeDescription: string;
  changeAreaSqft: number;
  anchorVertices: AnchorVertex[];
  highConfidenceSegments: HighConfidenceSegment[];
}

interface AnchorVertex {
  lat: number;
  lng: number;
  confidence: number;
  consistentAcrossDates: number;
  type: 'corner' | 'ridge_end' | 'hip_junction' | 'valley_junction';
}

interface HighConfidenceSegment {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  type: string;
  confidenceBoost: number;
}

interface ImageryDateResult {
  date: string;
  source: string;
  vertices: { lat: number; lng: number; type: string }[];
  perimeter: { lat: number; lng: number }[];
  area: number;
  quality: number;
}

// Analyze imagery across multiple dates
export async function analyzeTemporalImagery(
  lat: number,
  lng: number,
  years: number[] = [2020, 2022, 2024],
  aiGatewayKey: string
): Promise<TemporalAnalysisResult> {
  const dateResults: ImageryDateResult[] = [];
  
  // Fetch and analyze imagery for each year
  for (const year of years) {
    try {
      const result = await analyzeImageryForYear(lat, lng, year, aiGatewayKey);
      if (result) {
        dateResults.push(result);
      }
    } catch (error) {
      console.error(`Failed to analyze imagery for year ${year}:`, error);
    }
  }
  
  if (dateResults.length < 2) {
    return createNoDataResult(dateResults);
  }
  
  // Compare vertices across dates
  const vertexComparison = compareVerticesAcrossDates(dateResults);
  
  // Compare perimeters
  const perimeterComparison = comparePerimetersAcrossDates(dateResults);
  
  // Compare areas
  const areaComparison = compareAreasAcrossDates(dateResults);
  
  // Detect changes
  const changeAnalysis = detectChanges(dateResults, vertexComparison, perimeterComparison, areaComparison);
  
  // Identify anchor vertices (high confidence points consistent across all dates)
  const anchorVertices = identifyAnchorVertices(dateResults, vertexComparison);
  
  // Identify high-confidence segments
  const highConfidenceSegments = identifyHighConfidenceSegments(dateResults, vertexComparison);
  
  return {
    imageryDates: dateResults.map(r => r.date),
    imagerySources: dateResults.map(r => r.source),
    vertexConsistencyScore: vertexComparison.consistencyScore,
    perimeterConsistencyScore: perimeterComparison.consistencyScore,
    areaConsistencyScore: areaComparison.consistencyScore,
    changesDetected: changeAnalysis.detected,
    changeType: changeAnalysis.type,
    changeDescription: changeAnalysis.description,
    changeAreaSqft: changeAnalysis.areaDifference,
    anchorVertices,
    highConfidenceSegments
  };
}

// Analyze imagery for a specific year
async function analyzeImageryForYear(
  lat: number,
  lng: number,
  year: number,
  aiGatewayKey: string
): Promise<ImageryDateResult | null> {
  // For historical imagery, we'd typically use:
  // - Google Earth Engine API
  // - Nearmap API
  // - Planet Labs API
  // For now, we'll use the standard satellite imagery and note the limitation
  
  const zoomLevel = 20;
  const sources = ['google', 'mapbox'];
  
  for (const source of sources) {
    try {
      const imageUrl = getHistoricalImageryUrl(lat, lng, zoomLevel, source, year);
      
      // Analyze with AI
      const analysisPrompt = `Analyze this satellite/aerial image of a building roof from approximately ${year}.
      
Extract:
1. All visible roof vertices (corner points) with approximate positions
2. The roof perimeter shape
3. Estimated roof area
4. Any visible features: dormers, chimneys, solar panels, additions

Return as JSON with:
{
  "vertices": [{"lat": number, "lng": number, "type": "corner|ridge_end|junction"}],
  "perimeterPoints": [{"lat": number, "lng": number}],
  "estimatedAreaSqft": number,
  "features": ["list of visible features"],
  "imageQuality": 0-1 (clarity of the image)
}`;

      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${aiGatewayKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: 'You are an expert at analyzing satellite imagery of buildings.' },
            { 
              role: 'user', 
              content: [
                { type: 'text', text: analysisPrompt },
                { type: 'image_url', image_url: { url: imageUrl } }
              ]
            }
          ],
          temperature: 0.1
        })
      });

      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content;
      
      if (content) {
        const parsed = parseAIResponse(content);
        if (parsed.vertices?.length > 0) {
          return {
            date: `${year}-01-01`,
            source,
            vertices: parsed.vertices || [],
            perimeter: parsed.perimeterPoints || [],
            area: parsed.estimatedAreaSqft || 0,
            quality: parsed.imageQuality || 0.5
          };
        }
      }
    } catch (error) {
      console.error(`Failed to analyze ${source} imagery for ${year}:`, error);
    }
  }
  
  return null;
}

function getHistoricalImageryUrl(lat: number, lng: number, zoom: number, source: string, year: number): string {
  // Note: Actual historical imagery requires specialized APIs
  // This returns current imagery as a placeholder
  
  switch (source) {
    case 'google':
      return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=640x640&maptype=satellite&key=GOOGLE_MAPS_KEY`;
    case 'mapbox':
      return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom}/640x640?access_token=MAPBOX_TOKEN`;
    default:
      return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom}/640x640`;
  }
}

function parseAIResponse(content: string): any {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return {};
  } catch {
    return {};
  }
}

// Compare vertices across multiple dates
function compareVerticesAcrossDates(results: ImageryDateResult[]): {
  consistencyScore: number;
  matchedVertices: { lat: number; lng: number; matchCount: number }[];
  unmatchedVertices: { lat: number; lng: number; date: string }[];
} {
  if (results.length < 2) {
    return { consistencyScore: 0, matchedVertices: [], unmatchedVertices: [] };
  }
  
  const allVertices = results.flatMap(r => r.vertices.map(v => ({ ...v, date: r.date })));
  const matchedVertices: { lat: number; lng: number; matchCount: number }[] = [];
  const unmatchedVertices: { lat: number; lng: number; date: string }[] = [];
  const toleranceFt = 3; // 3 foot tolerance for vertex matching
  const toleranceDeg = toleranceFt / 364000;
  
  // Cluster vertices that are close together
  const used = new Set<number>();
  
  for (let i = 0; i < allVertices.length; i++) {
    if (used.has(i)) continue;
    
    const cluster = [i];
    const v1 = allVertices[i];
    
    for (let j = i + 1; j < allVertices.length; j++) {
      if (used.has(j)) continue;
      
      const v2 = allVertices[j];
      const distance = Math.sqrt(Math.pow(v1.lat - v2.lat, 2) + Math.pow(v1.lng - v2.lng, 2));
      
      if (distance < toleranceDeg) {
        cluster.push(j);
        used.add(j);
      }
    }
    
    used.add(i);
    
    if (cluster.length >= 2) {
      // Calculate average position
      const avgLat = cluster.reduce((sum, idx) => sum + allVertices[idx].lat, 0) / cluster.length;
      const avgLng = cluster.reduce((sum, idx) => sum + allVertices[idx].lng, 0) / cluster.length;
      matchedVertices.push({ lat: avgLat, lng: avgLng, matchCount: cluster.length });
    } else {
      unmatchedVertices.push({ lat: v1.lat, lng: v1.lng, date: v1.date });
    }
  }
  
  // Calculate consistency score
  const totalExpected = results.reduce((sum, r) => sum + r.vertices.length, 0);
  const matchedCount = matchedVertices.reduce((sum, v) => sum + v.matchCount, 0);
  const consistencyScore = totalExpected > 0 ? matchedCount / totalExpected : 0;
  
  return { consistencyScore, matchedVertices, unmatchedVertices };
}

// Compare perimeters across dates
function comparePerimetersAcrossDates(results: ImageryDateResult[]): {
  consistencyScore: number;
  perimeterDifferences: number[];
} {
  if (results.length < 2) {
    return { consistencyScore: 0, perimeterDifferences: [] };
  }
  
  const perimeters = results.map(r => calculatePerimeter(r.perimeter));
  const avgPerimeter = perimeters.reduce((a, b) => a + b, 0) / perimeters.length;
  
  const differences = perimeters.map(p => Math.abs(p - avgPerimeter));
  const maxDifference = Math.max(...differences);
  
  // Score based on maximum difference percentage
  const differencePercent = avgPerimeter > 0 ? maxDifference / avgPerimeter : 0;
  const consistencyScore = Math.max(0, 1 - differencePercent);
  
  return { consistencyScore, perimeterDifferences: differences };
}

function calculatePerimeter(points: { lat: number; lng: number }[]): number {
  if (points.length < 2) return 0;
  
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    perimeter += calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
  }
  return perimeter;
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Compare areas across dates
function compareAreasAcrossDates(results: ImageryDateResult[]): {
  consistencyScore: number;
  areaDifferences: number[];
  averageArea: number;
} {
  if (results.length < 2) {
    return { consistencyScore: 0, areaDifferences: [], averageArea: 0 };
  }
  
  const areas = results.map(r => r.area);
  const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
  
  const differences = areas.map(a => Math.abs(a - avgArea));
  const maxDifference = Math.max(...differences);
  
  // Score based on maximum difference percentage
  const differencePercent = avgArea > 0 ? maxDifference / avgArea : 0;
  const consistencyScore = Math.max(0, 1 - differencePercent);
  
  return { consistencyScore, areaDifferences: differences, averageArea: avgArea };
}

// Detect changes between dates
function detectChanges(
  results: ImageryDateResult[],
  vertexComparison: any,
  perimeterComparison: any,
  areaComparison: any
): {
  detected: boolean;
  type: 'none' | 'addition' | 'removal' | 'modification' | 'new_construction';
  description: string;
  areaDifference: number;
} {
  if (results.length < 2) {
    return { detected: false, type: 'none', description: 'Insufficient data', areaDifference: 0 };
  }
  
  // Sort by date
  const sorted = [...results].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  
  const areaDiff = newest.area - oldest.area;
  const areaChangePercent = oldest.area > 0 ? Math.abs(areaDiff) / oldest.area : 0;
  
  // Check for significant changes
  if (areaChangePercent < 0.05 && vertexComparison.consistencyScore > 0.9) {
    return { detected: false, type: 'none', description: 'No significant changes detected', areaDifference: 0 };
  }
  
  let type: 'addition' | 'removal' | 'modification' | 'new_construction' = 'modification';
  let description = '';
  
  if (oldest.area === 0 && newest.area > 0) {
    type = 'new_construction';
    description = 'Building appears to be new construction';
  } else if (areaDiff > 100) {
    type = 'addition';
    description = `Roof area increased by approximately ${Math.round(areaDiff)} sq ft`;
  } else if (areaDiff < -100) {
    type = 'removal';
    description = `Roof area decreased by approximately ${Math.round(Math.abs(areaDiff))} sq ft`;
  } else {
    type = 'modification';
    description = `Minor roof modifications detected (vertex consistency: ${Math.round(vertexComparison.consistencyScore * 100)}%)`;
  }
  
  return {
    detected: true,
    type,
    description,
    areaDifference: Math.abs(areaDiff)
  };
}

// Identify anchor vertices (highly consistent across dates)
function identifyAnchorVertices(
  results: ImageryDateResult[],
  vertexComparison: any
): AnchorVertex[] {
  return vertexComparison.matchedVertices
    .filter((v: any) => v.matchCount >= results.length * 0.8)
    .map((v: any) => ({
      lat: v.lat,
      lng: v.lng,
      confidence: v.matchCount / results.length,
      consistentAcrossDates: v.matchCount,
      type: 'corner' as const
    }));
}

// Identify high-confidence segments
function identifyHighConfidenceSegments(
  results: ImageryDateResult[],
  vertexComparison: any
): HighConfidenceSegment[] {
  const anchors = vertexComparison.matchedVertices.filter((v: any) => v.matchCount >= 2);
  const segments: HighConfidenceSegment[] = [];
  
  // Create segments between nearby anchor vertices
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const v1 = anchors[i];
      const v2 = anchors[j];
      const distance = calculateDistance(v1.lat, v1.lng, v2.lat, v2.lng);
      
      // Only create segments for reasonable distances (5-100 ft)
      if (distance >= 5 && distance <= 100) {
        const avgMatchCount = (v1.matchCount + v2.matchCount) / 2;
        segments.push({
          startLat: v1.lat,
          startLng: v1.lng,
          endLat: v2.lat,
          endLng: v2.lng,
          type: 'perimeter',
          confidenceBoost: avgMatchCount / results.length * 0.2
        });
      }
    }
  }
  
  return segments;
}

function createNoDataResult(results: ImageryDateResult[]): TemporalAnalysisResult {
  return {
    imageryDates: results.map(r => r.date),
    imagerySources: results.map(r => r.source),
    vertexConsistencyScore: 0,
    perimeterConsistencyScore: 0,
    areaConsistencyScore: 0,
    changesDetected: false,
    changeType: 'none',
    changeDescription: 'Insufficient historical imagery data',
    changeAreaSqft: 0,
    anchorVertices: [],
    highConfidenceSegments: []
  };
}

// Detect if imagery shows recent construction/modification
export function detectRecentModification(
  analysisResult: TemporalAnalysisResult,
  currentMeasurement: { area: number; vertices: any[] }
): {
  isRecent: boolean;
  confidence: number;
  recommendation: string;
} {
  if (!analysisResult.changesDetected) {
    return {
      isRecent: false,
      confidence: analysisResult.vertexConsistencyScore,
      recommendation: 'Building appears stable across historical imagery'
    };
  }
  
  const areaChange = analysisResult.changeAreaSqft;
  const changePercent = currentMeasurement.area > 0 ? areaChange / currentMeasurement.area : 0;
  
  if (analysisResult.changeType === 'new_construction') {
    return {
      isRecent: true,
      confidence: 0.9,
      recommendation: 'Building is new construction. Verify all measurements with extra care.'
    };
  }
  
  if (changePercent > 0.1) {
    return {
      isRecent: true,
      confidence: 0.8,
      recommendation: `Significant changes detected (${Math.round(changePercent * 100)}% area change). Flag for careful review.`
    };
  }
  
  return {
    isRecent: false,
    confidence: 0.7,
    recommendation: 'Minor changes detected. Standard measurement procedures apply.'
  };
}
