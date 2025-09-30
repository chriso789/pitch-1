import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MeasurementRequest {
  pipeline_entry_id: string;
  latitude?: number;
  longitude?: number;
  pitch?: string; // e.g., "8/12"
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pipeline_entry_id, latitude, longitude, pitch }: MeasurementRequest = await req.json();
    
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get pipeline entry
    const { data: pipelineEntry, error: entryError } = await supabase
      .from('pipeline_entries')
      .select('*, verified_address')
      .eq('id', pipeline_entry_id)
      .single();

    if (entryError || !pipelineEntry) {
      throw new Error('Pipeline entry not found');
    }

    // Extract coordinates
    let lat = latitude;
    let lng = longitude;
    
    if (!lat || !lng) {
      const verifiedAddr = pipelineEntry.verified_address;
      if (verifiedAddr?.geometry?.location) {
        lat = verifiedAddr.geometry.location.lat;
        lng = verifiedAddr.geometry.location.lng;
      }
    }

    if (!lat || !lng) {
      throw new Error('No coordinates available');
    }

    console.log(`Fetching measurements for coordinates: ${lat}, ${lng}`);

    // Fetch building data from OpenStreetMap Overpass API
    const osmData = await fetchOSMBuildingData(lat, lng);
    
    // Calculate measurements from building data
    const measurements = calculateRoofMeasurements(osmData, lat, lng, pitch || "8/12");

    // Update pipeline entry with measurements
    const { error: updateError } = await supabase
      .from('pipeline_entries')
      .update({ 
        metadata: {
          ...pipelineEntry.metadata,
          enhanced_measurements: measurements,
          measurements_updated_at: new Date().toISOString()
        }
      })
      .eq('id', pipeline_entry_id);

    if (updateError) {
      throw updateError;
    }

    console.log(`Enhanced measurements updated for pipeline entry ${pipeline_entry_id}`);

    return new Response(JSON.stringify({
      success: true,
      measurements,
      data_source: measurements.dataSource,
      confidence_score: measurements.confidenceScore
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Enhanced measurement error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : String(error) 
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function fetchOSMBuildingData(lat: number, lng: number) {
  // Query OpenStreetMap Overpass API for building data
  const radius = 25; // meters
  const query = `
    [out:json];
    (
      way["building"](around:${radius},${lat},${lng});
      relation["building"](around:${radius},${lat},${lng});
    );
    out geom;
  `;

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: { 'Content-Type': 'text/plain' }
    });

    if (!response.ok) {
      console.log('OSM API failed, using fallback');
      return null;
    }

    const data = await response.json();
    console.log(`OSM returned ${data.elements?.length || 0} elements`);
    return data;
  } catch (error) {
    console.error('OSM fetch error:', error);
    return null;
  }
}

function calculateRoofMeasurements(osmData: any, lat: number, lng: number, pitch: string) {
  const [rise, run] = pitch.split('/').map(Number);
  const pitchMultiplier = Math.sqrt(1 + Math.pow(rise / run, 2));

  let buildingArea = 0;
  let perimeter = 0;
  let dataSource = 'estimated';
  let confidenceScore = 0.65;

  // Try to extract building data from OSM
  if (osmData && osmData.elements && osmData.elements.length > 0) {
    const building = osmData.elements[0];
    
    if (building.geometry) {
      const coords = building.geometry;
      
      // Calculate area using shoelace formula
      buildingArea = calculatePolygonArea(coords);
      
      // Calculate perimeter
      perimeter = calculatePerimeter(coords);
      
      dataSource = 'OpenStreetMap';
      confidenceScore = 0.85;
      
      console.log(`OSM building area: ${buildingArea} sq ft, perimeter: ${perimeter} ft`);
    }
  }

  // Fallback to estimates if no OSM data
  if (buildingArea === 0) {
    buildingArea = estimateBuildingArea(lat, lng);
    perimeter = Math.sqrt(buildingArea) * 4; // Square assumption
    dataSource = 'estimated';
    confidenceScore = 0.60;
  }

  // Calculate roof area with pitch multiplier
  const roofArea = buildingArea * pitchMultiplier;

  // Estimate ridges, hips, and valleys based on roof complexity
  const ridgeLength = Math.sqrt(buildingArea) * 1.2; // Main ridge
  const hipLength = Math.sqrt(buildingArea) * 0.8; // Hip rafters
  const valleyLength = Math.sqrt(buildingArea) * 0.4; // Valleys

  // Calculate eaves and rakes (perimeter components)
  const eavesLength = perimeter * 0.6; // Horizontal edges
  const rakesLength = perimeter * 0.4; // Sloped edges

  return {
    // Perimeter components
    perimeterTotal: perimeter,
    eaves: eavesLength,
    rakes: rakesLength,
    
    // Linear measurements
    ridges: {
      totalLength: ridgeLength,
      count: 1,
      lines: [{ length: ridgeLength, type: 'main_ridge' }]
    },
    hips: {
      totalLength: hipLength,
      count: 2,
      lines: [
        { length: hipLength / 2, type: 'hip_rafter' },
        { length: hipLength / 2, type: 'hip_rafter' }
      ]
    },
    valleys: {
      totalLength: valleyLength,
      count: 1,
      lines: [{ length: valleyLength, type: 'valley' }]
    },
    
    // Area measurements
    buildingFootprint: buildingArea,
    roofArea: roofArea,
    adjustedRoofArea: roofArea * 1.10, // 10% waste factor
    
    // Pitch information
    pitch: pitch,
    pitchMultiplier: pitchMultiplier,
    pitchAngle: Math.atan(rise / run) * (180 / Math.PI),
    
    // Metadata
    dataSource,
    confidenceScore,
    coordinates: { lat, lng },
    measuredAt: new Date().toISOString(),
    
    // Additional details
    wasteFactor: 0.10,
    complexity: 'moderate'
  };
}

function calculatePolygonArea(coords: Array<{ lat: number; lon: number }>): number {
  if (coords.length < 3) return 0;

  // Convert to meters using approximate conversion
  const metersPerDegree = 111320; // at equator
  let area = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    
    const x1 = p1.lon * metersPerDegree;
    const y1 = p1.lat * metersPerDegree;
    const x2 = p2.lon * metersPerDegree;
    const y2 = p2.lat * metersPerDegree;
    
    area += (x1 * y2) - (x2 * y1);
  }
  
  area = Math.abs(area) / 2;
  
  // Convert square meters to square feet
  return area * 10.7639;
}

function calculatePerimeter(coords: Array<{ lat: number; lon: number }>): number {
  if (coords.length < 2) return 0;

  const metersPerDegree = 111320;
  let perimeter = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    
    const dx = (p2.lon - p1.lon) * metersPerDegree;
    const dy = (p2.lat - p1.lat) * metersPerDegree;
    
    const distance = Math.sqrt(dx * dx + dy * dy);
    perimeter += distance;
  }
  
  // Convert meters to feet
  return perimeter * 3.28084;
}

function estimateBuildingArea(lat: number, lng: number): number {
  // Fallback estimation for residential properties
  const baseArea = 1800;
  const coordVariation = Math.abs(Math.sin(lat * lng)) * 800;
  return Math.round((baseArea + coordVariation) / 50) * 50;
}
