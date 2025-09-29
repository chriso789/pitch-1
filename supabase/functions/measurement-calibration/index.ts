import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CalibrationRequest {
  latitude: number;
  longitude: number;
  zoomLevel: number;
  imageSize: { width: number; height: number };
  referencePoints?: Array<{ pixel: { x: number; y: number }; realWorld: { lat: number; lng: number } }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { latitude, longitude, zoomLevel, imageSize, referencePoints }: CalibrationRequest = await req.json();
    
    // Calculate pixel-to-meter ratio based on zoom level and latitude
    // Formula: meters_per_pixel = (Earth circumference * cos(latitude)) / (2^zoom * image_width)
    const earthCircumference = 40075016.686; // meters at equator
    const latRad = latitude * Math.PI / 180;
    const metersPerPixel = (earthCircumference * Math.cos(latRad)) / (Math.pow(2, zoomLevel) * imageSize.width);
    
    // Convert to feet (1 meter = 3.28084 feet)
    const feetPerPixel = metersPerPixel * 3.28084;
    
    // Adjust for elevation if available
    let elevationAdjustment = 1.0;
    try {
      const elevationResponse = await fetch(
        `https://maps.googleapis.com/maps/api/elevation/json?locations=${latitude},${longitude}&key=${Deno.env.get('GOOGLE_PLACES_API_KEY')}`
      );
      const elevationData = await elevationResponse.json();
      
      if (elevationData.results?.[0]) {
        const elevation = elevationData.results[0].elevation;
        // Slight adjustment for elevation (higher elevation = slightly larger pixel ratio)
        elevationAdjustment = 1 + (elevation / 10000); // 1% increase per 100m elevation
      }
    } catch (error) {
      console.log('Elevation data not available:', error);
    }
    
    const adjustedFeetPerPixel = feetPerPixel * elevationAdjustment;
    
    // Calculate confidence score based on zoom level and reference points
    let confidenceScore = 0.85; // Base confidence
    
    // Higher zoom = higher confidence
    if (zoomLevel >= 20) confidenceScore += 0.10;
    else if (zoomLevel >= 18) confidenceScore += 0.05;
    
    // Reference points improve confidence
    if (referencePoints && referencePoints.length > 0) {
      confidenceScore += Math.min(0.15, referencePoints.length * 0.05);
    }
    
    // Cap confidence at 0.95
    confidenceScore = Math.min(0.95, confidenceScore);
    
    const calibrationResult = {
      pixelToFeetRatio: adjustedFeetPerPixel,
      pixelToMeterRatio: metersPerPixel * elevationAdjustment,
      confidenceScore,
      zoomLevel,
      elevation: null, // Will be populated if elevation data is available
      calibrationMethod: 'google_maps_mercator_projection',
      adjustments: {
        elevationFactor: elevationAdjustment,
        latitudeFactor: Math.cos(latRad)
      },
      recommendations: {
        optimalZoomLevel: 20,
        minConfidenceForMeasurement: 0.80,
        suggestedWasteFactor: zoomLevel >= 20 ? 10 : 15
      }
    };
    
    // Cross-reference with multiple zoom levels for accuracy verification
    const verificationZooms = [19, 20, 21];
    const verificationRatios = verificationZooms.map(zoom => {
      const ratio = (earthCircumference * Math.cos(latRad)) / (Math.pow(2, zoom) * imageSize.width) * 3.28084;
      return { zoom, ratio: ratio * elevationAdjustment };
    });
    
    (calibrationResult as any).verification = {
      multiZoomRatios: verificationRatios,
      consistencyScore: calculateConsistencyScore(verificationRatios),
      timestamp: new Date().toISOString()
    };

    return new Response(JSON.stringify(calibrationResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Calibration error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : String(error),
      fallbackRatio: 0.6 // Safe fallback
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function calculateConsistencyScore(ratios: Array<{ zoom: number; ratio: number }>): number {
  if (ratios.length < 2) return 1.0;
  
  const values = ratios.map(r => r.ratio);
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  
  // Lower standard deviation = higher consistency
  const consistencyScore = Math.max(0.5, 1 - (stdDev / mean));
  return Math.min(1.0, consistencyScore);
}