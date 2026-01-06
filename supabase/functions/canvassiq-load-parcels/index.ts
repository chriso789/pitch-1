import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  lat: number;
  lng: number;
  radius?: number; // in miles
  tenant_id: string;
}

interface GeocodingResult {
  lat: number;
  lng: number;
  street_number: string;
  street_name: string;
  formatted_address: string;
  place_id: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const googleMapsApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: RequestBody = await req.json();
    const { lat, lng, radius = 0.25, tenant_id } = body;

    console.log(`[canvassiq-load-parcels] Loading parcels for tenant ${tenant_id} at ${lat},${lng} radius ${radius}mi`);

    if (!lat || !lng || !tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: lat, lng, tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate bounding box
    const radiusInDegrees = radius / 69; // ~1 degree = 69 miles
    const minLat = lat - radiusInDegrees;
    const maxLat = lat + radiusInDegrees;
    const minLng = lng - radiusInDegrees;
    const maxLng = lng + radiusInDegrees;

    // Check existing properties
    const { data: existingProperties, error: existingError } = await supabase
      .from('canvassiq_properties')
      .select('id, lat, lng')
      .eq('tenant_id', tenant_id)
      .gte('lat', minLat)
      .lte('lat', maxLat)
      .gte('lng', minLng)
      .lte('lng', maxLng);

    if (existingError) {
      console.error('[canvassiq-load-parcels] Error checking existing:', existingError);
    }

    // If properties already exist, return them
    if (existingProperties && existingProperties.length > 0) {
      console.log(`[canvassiq-load-parcels] Found ${existingProperties.length} existing properties`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          properties: existingProperties,
          message: 'Existing properties returned',
          count: existingProperties.length
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use Google Geocoding API to get real property addresses
    let properties: any[] = [];
    
    if (googleMapsApiKey) {
      console.log('[canvassiq-load-parcels] Using Google Geocoding API for real addresses');
      properties = await loadRealParcelsFromGeocoding(lat, lng, radius, tenant_id, googleMapsApiKey);
    } else {
      console.log('[canvassiq-load-parcels] No Google API key, falling back to sample data');
      properties = generateSampleParcels(lat, lng, radius, tenant_id);
    }
    
    console.log(`[canvassiq-load-parcels] Generated ${properties.length} properties`);

    // Insert properties
    if (properties.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from('canvassiq_properties')
        .insert(properties)
        .select('id, lat, lng, address, disposition');

      if (insertError) {
        console.error('[canvassiq-load-parcels] Insert error:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to insert properties', details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[canvassiq-load-parcels] Inserted ${inserted?.length || 0} properties`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          properties: inserted,
          message: 'Properties loaded from Google Geocoding',
          count: inserted?.length || 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, properties: [], count: 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[canvassiq-load-parcels] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Load real property data using Google Geocoding API reverse geocoding
async function loadRealParcelsFromGeocoding(
  centerLat: number, 
  centerLng: number, 
  radius: number, 
  tenantId: string,
  apiKey: string
): Promise<any[]> {
  const properties: any[] = [];
  const seenPlaceIds = new Set<string>();
  
  // Create a grid of points to reverse geocode - spacing ~30m apart for residential areas
  const gridSpacing = 0.0003; // ~30 meters in degrees
  const gridSize = Math.min(5, Math.ceil(radius * 10)); // Limit grid size based on radius
  
  console.log(`[canvassiq-load-parcels] Creating ${gridSize}x${gridSize} grid for reverse geocoding`);
  
  for (let i = -Math.floor(gridSize / 2); i <= Math.floor(gridSize / 2); i++) {
    for (let j = -Math.floor(gridSize / 2); j <= Math.floor(gridSize / 2); j++) {
      const pointLat = centerLat + (i * gridSpacing);
      const pointLng = centerLng + (j * gridSpacing);
      
      try {
        const result = await reverseGeocode(pointLat, pointLng, apiKey);
        
        if (result && result.place_id && !seenPlaceIds.has(result.place_id)) {
          seenPlaceIds.add(result.place_id);
          
          properties.push({
            tenant_id: tenantId,
            lat: result.lat,
            lng: result.lng,
            address: JSON.stringify({
              street: `${result.street_number} ${result.street_name}`,
              street_number: result.street_number,
              street_name: result.street_name,
              formatted: result.formatted_address,
              place_id: result.place_id
            }),
            address_hash: result.place_id,
            disposition: null,
            owner_name: null,
            property_data: JSON.stringify({
              source: 'google_geocoding',
              geocoded_at: new Date().toISOString()
            })
          });
        }
      } catch (err) {
        console.error(`[canvassiq-load-parcels] Geocoding error at ${pointLat},${pointLng}:`, err);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  console.log(`[canvassiq-load-parcels] Found ${properties.length} unique addresses`);
  return properties;
}

// Reverse geocode a single point to get the street address
async function reverseGeocode(lat: number, lng: number, apiKey: string): Promise<GeocodingResult | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=street_address&key=${apiKey}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' || !data.results || data.results.length === 0) {
    return null;
  }
  
  const result = data.results[0];
  const components = result.address_components || [];
  
  // Extract street number and street name from address components
  let streetNumber = '';
  let streetName = '';
  
  for (const component of components) {
    if (component.types.includes('street_number')) {
      streetNumber = component.long_name;
    }
    if (component.types.includes('route')) {
      streetName = component.long_name;
    }
  }
  
  // Only return if we have a valid street number (indicating a specific property)
  if (!streetNumber) {
    return null;
  }
  
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    street_number: streetNumber,
    street_name: streetName,
    formatted_address: result.formatted_address,
    place_id: result.place_id
  };
}

// Fallback: Generate sample parcels when no API key available
function generateSampleParcels(centerLat: number, centerLng: number, radius: number, tenantId: string) {
  const properties: any[] = [];
  const gridSize = 5;
  const stepDegrees = (radius / 69) / gridSize;
  
  let streetNumber = 100 + Math.floor(Math.random() * 900);
  const streetNames = ['Oak St', 'Main St', 'Maple Ave', 'Cedar Ln', 'Pine Dr', 'Elm St', 'Birch Way', 'Walnut Blvd'];
  const cities = ['Springfield', 'Riverside', 'Oakville', 'Greenfield'];
  const states = ['TX', 'FL', 'CA', 'AZ'];
  
  for (let i = -Math.floor(gridSize / 2); i <= Math.floor(gridSize / 2); i++) {
    for (let j = -Math.floor(gridSize / 2); j <= Math.floor(gridSize / 2); j++) {
      const jitterLat = (Math.random() - 0.5) * stepDegrees * 0.5;
      const jitterLng = (Math.random() - 0.5) * stepDegrees * 0.5;
      
      const propLat = centerLat + (i * stepDegrees) + jitterLat;
      const propLng = centerLng + (j * stepDegrees) + jitterLng;
      
      const streetName = streetNames[Math.floor(Math.random() * streetNames.length)];
      const city = cities[Math.floor(Math.random() * cities.length)];
      const state = states[Math.floor(Math.random() * states.length)];
      const zip = String(10000 + Math.floor(Math.random() * 89999));
      
      properties.push({
        tenant_id: tenantId,
        lat: propLat,
        lng: propLng,
        address: JSON.stringify({
          street: `${streetNumber} ${streetName}`,
          street_number: String(streetNumber),
          city,
          state,
          zip,
          formatted: `${streetNumber} ${streetName}, ${city}, ${state} ${zip}`
        }),
        address_hash: `${propLat.toFixed(6)}_${propLng.toFixed(6)}`,
        disposition: null,
        owner_name: generateRandomName(),
        property_data: JSON.stringify({
          property_type: 'single_family',
          year_built: 1980 + Math.floor(Math.random() * 40),
          sqft: 1200 + Math.floor(Math.random() * 2000),
          lot_size: 0.1 + Math.random() * 0.5,
        })
      });
      
      streetNumber += Math.floor(Math.random() * 10) + 2;
    }
  }
  
  return properties;
}

function generateRandomName(): string {
  const firstNames = ['John', 'Mary', 'Robert', 'Patricia', 'Michael', 'Jennifer', 'William', 'Linda', 'David', 'Elizabeth'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
  
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  
  return `${firstName} ${lastName}`;
}
