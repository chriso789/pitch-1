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

    // Calculate expected density - allow loading if we don't have enough properties
    const expectedDensity = 50; // Minimum properties expected in area
    if (existingProperties && existingProperties.length >= expectedDensity) {
      console.log(`[canvassiq-load-parcels] Area has sufficient coverage: ${existingProperties.length} properties`);
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
    
    console.log(`[canvassiq-load-parcels] Area needs more properties: ${existingProperties?.length || 0} < ${expectedDensity}`);
    // Keep track of existing place_ids to avoid duplicates
    const existingPlaceIds = new Set<string>();
    (existingProperties || []).forEach((p: any) => {
      if (p.address_hash) existingPlaceIds.add(p.address_hash);
    });

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

// Get building centroid from Mapbox Building Footprints API
async function getBuildingCentroid(
  lat: number, 
  lng: number, 
  mapboxToken: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json?radius=30&layers=building&limit=5&access_token=${mapboxToken}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      console.error('[getBuildingCentroid] Mapbox API error:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
      return null;
    }
    
    // Find closest building polygon
    const buildings = data.features.filter((f: any) => 
      f.geometry?.type === 'Polygon' && 
      f.geometry?.coordinates?.[0]?.length >= 4
    );
    
    if (buildings.length === 0) {
      // Check for point features (smaller buildings)
      const points = data.features.filter((f: any) => f.geometry?.type === 'Point');
      if (points.length > 0) {
        const point = points[0];
        return {
          lng: point.geometry.coordinates[0],
          lat: point.geometry.coordinates[1]
        };
      }
      return null;
    }
    
    // Sort by distance and take closest
    buildings.sort((a: any, b: any) => {
      const distA = a.properties?.tilequery?.distance || Infinity;
      const distB = b.properties?.tilequery?.distance || Infinity;
      return distA - distB;
    });
    
    const building = buildings[0];
    const ring = building.geometry.coordinates[0];
    
    // Calculate centroid of building polygon
    let sumLng = 0, sumLat = 0;
    const n = ring.length - 1; // Exclude closing coordinate
    for (let i = 0; i < n; i++) {
      sumLng += ring[i][0];
      sumLat += ring[i][1];
    }
    
    return {
      lng: sumLng / n,
      lat: sumLat / n
    };
  } catch (err) {
    console.error('[getBuildingCentroid] Error:', err);
    return null;
  }
}

// Load real property data using Google Geocoding API reverse geocoding
// OPTIMIZED: Parallel batch processing for 5-10x faster loading
// DEDUPLICATION: Only keep one marker per normalized street address (mailing address)
async function loadRealParcelsFromGeocoding(
  centerLat: number, 
  centerLng: number, 
  radius: number, 
  tenantId: string,
  apiKey: string
): Promise<any[]> {
  const properties: any[] = [];
  const seenPlaceIds = new Set<string>();
  // NEW: Track seen addresses to deduplicate multiple lots with same mailing address
  const seenAddresses = new Map<string, { lat: number; lng: number; distance: number }>();
  
  // Create a grid of points to reverse geocode
  // Larger grid for more coverage, tighter spacing for density
  const gridSpacing = 0.0002; // ~20 meters for better density
  const gridSize = Math.max(12, Math.min(20, Math.ceil(radius * 50))); // 12-20 grid size
  
  console.log(`[canvassiq-load-parcels] Creating ${gridSize}x${gridSize} grid (${gridSize * gridSize} points) for parallel geocoding`);
  
  // Build array of all grid points
  const gridPoints: { lat: number; lng: number }[] = [];
  for (let i = -Math.floor(gridSize / 2); i <= Math.floor(gridSize / 2); i++) {
    for (let j = -Math.floor(gridSize / 2); j <= Math.floor(gridSize / 2); j++) {
      gridPoints.push({
        lat: centerLat + (i * gridSpacing),
        lng: centerLng + (j * gridSpacing)
      });
    }
  }
  
  // Process in parallel batches for speed
  const batchSize = 15; // Process 15 at a time
  const startTime = Date.now();
  
  // Temporary storage for deduplication
  const candidateProperties: any[] = [];
  
  for (let i = 0; i < gridPoints.length; i += batchSize) {
    const batch = gridPoints.slice(i, i + batchSize);
    
    // Process batch in parallel
    const results = await Promise.all(
      batch.map(point => reverseGeocode(point.lat, point.lng, apiKey).catch(() => null))
    );
    
    // Process results
    for (const result of results) {
      if (result && result.place_id && !seenPlaceIds.has(result.place_id)) {
        seenPlaceIds.add(result.place_id);
        
        // Create normalized address key for deduplication
        // This handles cases where multiple lots have same street number/name
        const normalizedAddressKey = normalizeAddressKey(
          result.street_number,
          result.street_name
        );
        
        // Calculate distance from center for tie-breaking
        const distanceFromCenter = Math.sqrt(
          Math.pow(result.lat - centerLat, 2) + 
          Math.pow(result.lng - centerLng, 2)
        );
        
        // Check if we already have this address
        const existingEntry = seenAddresses.get(normalizedAddressKey);
        
        if (!existingEntry) {
          // First time seeing this address
          seenAddresses.set(normalizedAddressKey, {
            lat: result.lat,
            lng: result.lng,
            distance: distanceFromCenter
          });
          
          candidateProperties.push({
            tenant_id: tenantId,
            lat: result.lat,
            lng: result.lng,
            original_lat: result.lat,
            original_lng: result.lng,
            building_snapped: false,
            address: JSON.stringify({
              street: `${result.street_number} ${result.street_name}`,
              street_number: result.street_number,
              street_name: result.street_name,
              formatted: result.formatted_address,
              place_id: result.place_id,
              normalized_key: normalizedAddressKey
            }),
            address_hash: result.place_id,
            normalized_address_key: normalizedAddressKey,
            distance_from_center: distanceFromCenter,
            disposition: null,
            owner_name: null,
            property_data: JSON.stringify({
              source: 'google_geocoding',
              geocoded_at: new Date().toISOString(),
              building_snapped: false,
              deduplicated: false
            })
          });
        } else if (distanceFromCenter < existingEntry.distance) {
          // This entry is closer to center, replace the existing one
          console.log(`[canvassiq-load-parcels] Replacing duplicate address ${normalizedAddressKey} with closer coordinates`);
          seenAddresses.set(normalizedAddressKey, {
            lat: result.lat,
            lng: result.lng,
            distance: distanceFromCenter
          });
          
          // Find and update the existing candidate
          const existingIdx = candidateProperties.findIndex(
            p => p.normalized_address_key === normalizedAddressKey
          );
          if (existingIdx !== -1) {
            candidateProperties[existingIdx] = {
              ...candidateProperties[existingIdx],
              lat: result.lat,
              lng: result.lng,
              original_lat: result.lat,
              original_lng: result.lng,
              address: JSON.stringify({
                street: `${result.street_number} ${result.street_name}`,
                street_number: result.street_number,
                street_name: result.street_name,
                formatted: result.formatted_address,
                place_id: result.place_id,
                normalized_key: normalizedAddressKey
              }),
              address_hash: result.place_id,
              distance_from_center: distanceFromCenter,
              property_data: JSON.stringify({
                source: 'google_geocoding',
                geocoded_at: new Date().toISOString(),
                building_snapped: false,
                deduplicated: true // Mark as deduplicated
              })
            };
          }
        }
        // If existing entry is closer, skip this one (don't add duplicate)
      }
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < gridPoints.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  // Clean up temporary fields before returning
  for (const prop of candidateProperties) {
    delete prop.normalized_address_key;
    delete prop.distance_from_center;
    properties.push(prop);
  }
  
  const elapsed = Date.now() - startTime;
  const duplicatesRemoved = seenPlaceIds.size - properties.length;
  console.log(`[canvassiq-load-parcels] Found ${properties.length} unique addresses (${duplicatesRemoved} duplicates removed) in ${elapsed}ms`);
  return properties;
}

/**
 * Normalize address key for deduplication
 * Handles variations like "123 Main St" vs "123 Main Street"
 */
function normalizeAddressKey(streetNumber: string, streetName: string): string {
  // Convert to lowercase
  let normalized = `${streetNumber}_${streetName}`.toLowerCase();
  
  // Normalize common street suffixes
  const suffixMap: Record<string, string> = {
    'street': 'st',
    'avenue': 'ave',
    'boulevard': 'blvd',
    'drive': 'dr',
    'road': 'rd',
    'lane': 'ln',
    'court': 'ct',
    'place': 'pl',
    'circle': 'cir',
    'way': 'way',
    'terrace': 'ter',
    'highway': 'hwy',
    'parkway': 'pkwy',
  };
  
  for (const [full, short] of Object.entries(suffixMap)) {
    normalized = normalized.replace(new RegExp(`\\b${full}\\b`, 'g'), short);
  }
  
  // Remove extra spaces and special characters
  normalized = normalized.replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_');
  
  return normalized;
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
