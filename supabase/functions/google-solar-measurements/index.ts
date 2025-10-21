import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SolarAPIResponse {
  name: string;
  center: { latitude: number; longitude: number };
  boundingBox: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  imageryDate: { year: number; month: number; day: number };
  solarPotential: {
    wholeRoofStats: {
      areaMeters2: number;
    };
    roofSegmentStats: Array<{
      pitchDegrees: number;
      azimuthDegrees: number;
      stats: {
        areaMeters2: number;
      };
      center: { latitude: number; longitude: number };
      boundingBox: {
        sw: { latitude: number; longitude: number };
        ne: { latitude: number; longitude: number };
      };
    }>;
  };
}

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Calculate perimeter from bounding box
function calculatePerimeter(box: { sw: { latitude: number; longitude: number }; ne: { latitude: number; longitude: number } }): number {
  const width = calculateDistance(box.sw.latitude, box.sw.longitude, box.sw.latitude, box.ne.longitude);
  const height = calculateDistance(box.sw.latitude, box.sw.longitude, box.ne.latitude, box.sw.longitude);
  return (width + height) * 2 * 3.28084; // Convert meters to feet
}

// Analyze roof segments to calculate linear measurements
function analyzeRoofGeometry(segments: SolarAPIResponse['solarPotential']['roofSegmentStats']) {
  let ridges = 0;
  let hips = 0;
  let valleys = 0;
  let eaves = 0;
  let rakes = 0;

  segments.forEach((segment, index) => {
    const pitch = segment.pitchDegrees;
    const area = segment.stats.areaMeters2 * 10.764; // Convert to sq ft
    const estimatedLength = Math.sqrt(area); // Rough estimate

    // Classify based on pitch and position
    if (pitch < 5) {
      // Flat or low-pitch - likely ridge
      ridges += estimatedLength * 0.5;
    } else if (pitch > 30) {
      // Steep pitch - likely has hips and valleys
      hips += estimatedLength * 0.3;
      valleys += estimatedLength * 0.2;
    } else {
      // Medium pitch
      ridges += estimatedLength * 0.3;
      hips += estimatedLength * 0.2;
    }

    // Eaves and rakes based on perimeter
    const segmentPerimeter = calculatePerimeter(segment.boundingBox);
    eaves += segmentPerimeter * 0.5;
    rakes += segmentPerimeter * 0.3;
  });

  return {
    ridges: { totalLength: Math.round(ridges), segments: [] },
    hips: { totalLength: Math.round(hips), segments: [] },
    valleys: { totalLength: Math.round(valleys), segments: [] },
    eaves: Math.round(eaves),
    rakes: Math.round(rakes)
  };
}

// Convert pitch degrees to traditional roof pitch (e.g., "6/12")
function degreesToRoofPitch(degrees: number): string {
  const rise = Math.tan(degrees * Math.PI / 180) * 12;
  return `${Math.round(rise)}/12`;
}

// Determine roof complexity based on segment count and pitch variation
function determineComplexity(segments: SolarAPIResponse['solarPotential']['roofSegmentStats']): string {
  if (segments.length === 1) return 'simple';
  if (segments.length <= 3) return 'moderate';
  return 'complex';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pipeline_entry_id, latitude, longitude } = await req.json();
    
    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!apiKey) {
      throw new Error('Google Maps API key not configured');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let coords = { latitude, longitude };

    // If coordinates not provided, fetch from pipeline entry
    if (!coords.latitude && pipeline_entry_id) {
      const { data: entry, error: entryError } = await supabase
        .from('pipeline_entries')
        .select('property_address, metadata')
        .eq('id', pipeline_entry_id)
        .single();

      if (entryError) throw entryError;

      // Try to get coordinates from metadata or geocode the address
      if (entry.metadata?.coordinates) {
        coords = entry.metadata.coordinates;
      } else if (entry.property_address) {
        // Geocode the address
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(entry.property_address)}&key=${apiKey}`;
        const geocodeResponse = await fetch(geocodeUrl);
        const geocodeData = await geocodeResponse.json();
        
        if (geocodeData.status === 'OK' && geocodeData.results[0]) {
          coords = {
            latitude: geocodeData.results[0].geometry.location.lat,
            longitude: geocodeData.results[0].geometry.location.lng
          };
        } else {
          throw new Error('Could not geocode address');
        }
      }
    }

    if (!coords.latitude || !coords.longitude) {
      throw new Error('No coordinates available for measurement');
    }

    console.log('Fetching Solar API data for coordinates:', coords);

    // Call Google Solar API
    const solarUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${coords.latitude}&location.longitude=${coords.longitude}&requiredQuality=HIGH&key=${apiKey}`;
    
    const solarResponse = await fetch(solarUrl);
    const solarData: SolarAPIResponse = await solarResponse.json();

    if (!solarResponse.ok) {
      console.error('Solar API error:', solarData);
      throw new Error('Solar API request failed: ' + (solarData as any).error?.message || 'Unknown error');
    }

    if (!solarData.solarPotential?.roofSegmentStats) {
      throw new Error('No roof data available for this location');
    }

    // Process the Solar API response
    const segments = solarData.solarPotential.roofSegmentStats;
    const totalRoofArea = segments.reduce((sum, seg) => sum + (seg.stats.areaMeters2 * 10.764), 0);
    const perimeter = calculatePerimeter(solarData.boundingBox);
    const geometry = analyzeRoofGeometry(segments);
    const averagePitch = segments.reduce((sum, seg) => sum + seg.pitchDegrees, 0) / segments.length;
    const complexity = determineComplexity(segments);

    const measurements = {
      roofArea: Math.round(totalRoofArea),
      perimeter: Math.round(perimeter),
      ...geometry,
      averagePitch: degreesToRoofPitch(averagePitch),
      averagePitchDegrees: Math.round(averagePitch * 10) / 10,
      complexity,
      roofSegments: segments.map((seg, idx) => ({
        segmentIndex: idx + 1,
        pitchDegrees: Math.round(seg.pitchDegrees * 10) / 10,
        azimuthDegrees: Math.round(seg.azimuthDegrees),
        areaMeters2: Math.round(seg.stats.areaMeters2 * 10) / 10,
        areaSqFt: Math.round(seg.stats.areaMeters2 * 10.764)
      })),
      dataSource: 'Google Solar API',
      confidenceScore: 0.95,
      imageryDate: `${solarData.imageryDate.year}-${String(solarData.imageryDate.month).padStart(2, '0')}`,
      measuredAt: new Date().toISOString(),
      center: coords
    };

    // Update pipeline entry with measurements
    if (pipeline_entry_id) {
      const { error: updateError } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            solar_measurements: measurements
          }
        })
        .eq('id', pipeline_entry_id);

      if (updateError) {
        console.error('Failed to update pipeline entry:', updateError);
      }
    }

    console.log('Solar measurements calculated:', measurements);

    return new Response(JSON.stringify({
      success: true,
      measurements
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in google-solar-measurements:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
