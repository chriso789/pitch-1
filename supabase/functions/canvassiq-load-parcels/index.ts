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
  city: string;
  state: string;
  zip: string;
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
    const regridApiKey = Deno.env.get('REGRID_API_KEY');
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

    // Check existing properties - include normalized_address_key for proper deduplication
    const { data: existingProperties, error: existingError } = await supabase
      .from('canvassiq_properties')
      .select('id, lat, lng, normalized_address_key')
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
    // Keep track of existing normalized address keys to avoid duplicates
    const existingAddressKeys = new Set<string>();
    (existingProperties || []).forEach((p: any) => {
      if (p.normalized_address_key) existingAddressKeys.add(p.normalized_address_key);
    });

    // Use Google Geocoding API to get real property addresses
    let properties: any[] = [];
    
    if (googleMapsApiKey) {
      console.log('[canvassiq-load-parcels] Using Google Geocoding API for real addresses');
      properties = await loadRealParcelsFromGeocoding(lat, lng, radius, tenant_id, googleMapsApiKey, existingAddressKeys, regridApiKey);
    } else {
      console.log('[canvassiq-load-parcels] No Google API key, falling back to sample data');
      properties = generateSampleParcels(lat, lng, radius, tenant_id);
    }
    
    console.log(`[canvassiq-load-parcels] Generated ${properties.length} new properties`);

    // Insert properties using UPSERT to handle any remaining duplicates
    if (properties.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from('canvassiq_properties')
        .upsert(properties, { 
          onConflict: 'tenant_id,normalized_address_key',
          ignoreDuplicates: true 
        })
        .select('id, lat, lng, address, disposition');

      if (insertError) {
        console.error('[canvassiq-load-parcels] Insert error:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to insert properties', details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[canvassiq-load-parcels] Upserted ${inserted?.length || 0} properties`);

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
  apiKey: string,
  existingAddressKeys: Set<string> = new Set(),
  regridApiKey?: string
): Promise<any[]> {
  const properties: any[] = [];
  const seenPlaceIds = new Set<string>();
  // Track seen addresses to deduplicate multiple lots with same mailing address
  const seenAddresses = new Map<string, { lat: number; lng: number; distance: number }>();
  
  // Pre-populate with existing addresses from database to avoid re-inserting
  console.log(`[canvassiq-load-parcels] Skipping ${existingAddressKeys.size} addresses already in database`);
  
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
        
        // Skip if this address already exists in the database
        if (existingAddressKeys.has(normalizedAddressKey)) {
          continue;
        }
        
        // Check if we already have this address in this batch
        const existingEntry = seenAddresses.get(normalizedAddressKey);
        
        if (!existingEntry) {
          // First time seeing this address
          seenAddresses.set(normalizedAddressKey, {
            lat: result.lat,
            lng: result.lng,
            distance: distanceFromCenter
          });
          
          // Fetch owner data from Regrid if API key is available
          let ownerData: { owner_name: string | null; mailing_address: string | null } = { owner_name: null, mailing_address: null };
          if (regridApiKey) {
            console.log(`[canvassiq-load-parcels] Fetching Regrid owner for ${result.lat},${result.lng}`);
            try {
              ownerData = await fetchRegridOwner(result.lat, result.lng, regridApiKey);
              console.log(`[canvassiq-load-parcels] Regrid result: ${JSON.stringify(ownerData)}`);
            } catch (e) {
              console.error('[canvassiq-load-parcels] Regrid owner fetch failed:', e);
            }
          }
          
          candidateProperties.push({
            tenant_id: tenantId,
            lat: result.lat,
            lng: result.lng,
            original_lat: result.lat,
            original_lng: result.lng,
            building_snapped: false,
            // Store address as proper JSON object with city/state/zip
            address: {
              street: `${result.street_number} ${result.street_name}`,
              street_number: result.street_number,
              street_name: result.street_name,
              city: result.city,
              state: result.state,
              zip: result.zip,
              formatted: result.formatted_address,
              place_id: result.place_id,
              normalized_key: normalizedAddressKey
            },
            address_hash: result.place_id,
            normalized_address_key: normalizedAddressKey,
            disposition: null,
            owner_name: ownerData.owner_name,
            property_data: {
              source: 'google_geocoding',
              geocoded_at: new Date().toISOString(),
              building_snapped: false,
              deduplicated: false,
              regrid_owner: ownerData.owner_name,
              regrid_mailing: ownerData.mailing_address
            }
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
              // Store address as proper JSON object with city/state/zip
              address: {
                street: `${result.street_number} ${result.street_name}`,
                street_number: result.street_number,
                street_name: result.street_name,
                city: result.city,
                state: result.state,
                zip: result.zip,
                formatted: result.formatted_address,
                place_id: result.place_id,
                normalized_key: normalizedAddressKey
              },
              address_hash: result.place_id,
              property_data: {
                source: 'google_geocoding',
                geocoded_at: new Date().toISOString(),
                building_snapped: false,
                deduplicated: true
              }
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
  
  // KEEP normalized_address_key for the unique index constraint
  // Only remove internal tracking fields
  for (const prop of candidateProperties) {
    properties.push(prop);
  }
  
  const elapsed = Date.now() - startTime;
  const skippedExisting = existingAddressKeys.size;
  console.log(`[canvassiq-load-parcels] Found ${properties.length} new addresses (skipped ${skippedExisting} existing) in ${elapsed}ms`);
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

// Reverse geocode a single point to get the street address with city/state/zip
async function reverseGeocode(lat: number, lng: number, apiKey: string): Promise<GeocodingResult | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=street_address&key=${apiKey}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' || !data.results || data.results.length === 0) {
    return null;
  }
  
  const result = data.results[0];
  const components = result.address_components || [];
  
  // Extract all address components
  let streetNumber = '';
  let streetName = '';
  let city = '';
  let state = '';
  let zip = '';
  
  for (const component of components) {
    if (component.types.includes('street_number')) {
      streetNumber = component.long_name;
    }
    if (component.types.includes('route')) {
      streetName = component.long_name;
    }
    if (component.types.includes('locality')) {
      city = component.long_name;
    }
    if (component.types.includes('administrative_area_level_1')) {
      state = component.short_name;
    }
    if (component.types.includes('postal_code')) {
      zip = component.long_name;
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
    city,
    state,
    zip,
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

// Fetch property owner from Regrid API (v2 endpoint)
async function fetchRegridOwner(lat: number, lng: number, apiKey: string): Promise<{ owner_name: string | null; mailing_address: string | null }> {
  try {
    // Use Regrid v2 API for better response format
    const url = `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lng}&token=${apiKey}&return_geometry=false`;
    
    console.log(`[fetchRegridOwner] Calling Regrid API for ${lat},${lng}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'PitchCRM/1.0'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[fetchRegridOwner] Regrid API error ${response.status}: ${errorText.slice(0, 200)}`);
      return { owner_name: null, mailing_address: null };
    }
    
    const data = await response.json();
    console.log(`[fetchRegridOwner] Response keys: ${Object.keys(data || {}).join(', ')}`);
    
    // v2 returns parcels array with properties.fields
    const parcel = data?.parcels?.[0]?.properties?.fields || 
                   data?.results?.[0]?.properties?.fields || 
                   data?.results?.[0]?.properties || 
                   {};
    
    console.log(`[fetchRegridOwner] Parcel fields: ${Object.keys(parcel).slice(0, 10).join(', ')}`);
    
    // Try different field names Regrid uses for owner
    const ownerName = parcel.owner || parcel.owner_name || parcel.owner1 || 
                      parcel.ownername || parcel.parval_owner || parcel.ownfrst ||
                      (parcel.ownfrst && parcel.ownlast ? `${parcel.ownfrst} ${parcel.ownlast}` : null) ||
                      null;
    
    // Try to get mailing address
    const mailingAddress = parcel.mail_address || parcel.mailadd || parcel.mail || 
                           parcel.situs_full || parcel.address || null;
    
    if (ownerName) {
      console.log(`[fetchRegridOwner] Found owner: "${ownerName}"`);
    } else {
      console.log(`[fetchRegridOwner] No owner found in parcel data`);
    }
    
    return { owner_name: ownerName, mailing_address: mailingAddress };
  } catch (err) {
    console.error('[fetchRegridOwner] Error:', err);
    return { owner_name: null, mailing_address: null };
  }
}
