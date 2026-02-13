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
    const radiusInDegrees = radius / 69;
    const minLat = lat - radiusInDegrees;
    const maxLat = lat + radiusInDegrees;
    const minLng = lng - radiusInDegrees;
    const maxLng = lng + radiusInDegrees;

    // Check existing properties
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

    const expectedDensity = 50;
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
    const existingAddressKeys = new Set<string>();
    (existingProperties || []).forEach((p: any) => {
      if (p.normalized_address_key) existingAddressKeys.add(p.normalized_address_key);
    });

    // Use Google Geocoding API to get real property addresses
    let properties: any[] = [];
    
    if (googleMapsApiKey) {
      console.log('[canvassiq-load-parcels] Using Google Geocoding API for real addresses');
      properties = await loadRealParcelsFromGeocoding(lat, lng, radius, tenant_id, googleMapsApiKey, existingAddressKeys);
    } else {
      console.log('[canvassiq-load-parcels] No Google API key, falling back to sample data');
      properties = generateSampleParcels(lat, lng, radius, tenant_id);
    }
    
    console.log(`[canvassiq-load-parcels] Generated ${properties.length} new properties`);

    // Insert properties using UPSERT
    if (properties.length > 0) {
      // Insert in small batches, skipping duplicates individually
      let allInserted: any[] = [];
      const insertBatchSize = 20;
      
      for (let i = 0; i < properties.length; i += insertBatchSize) {
        const batch = properties.slice(i, i + insertBatchSize);
        const { data: inserted, error: insertError } = await supabase
          .from('canvassiq_properties')
          .upsert(batch, { 
            onConflict: 'tenant_id,normalized_address_key',
            ignoreDuplicates: true 
          })
          .select('id, lat, lng, address, disposition');

        if (insertError) {
          // If upsert fails (constraint mismatch), fall back to individual inserts
          console.warn('[canvassiq-load-parcels] Batch upsert failed, inserting individually:', insertError.message);
          for (const prop of batch) {
            const { data: single, error: singleErr } = await supabase
              .from('canvassiq_properties')
              .insert(prop)
              .select('id, lat, lng, address, disposition')
              .maybeSingle();
            if (single) allInserted.push(single);
            else if (singleErr && !singleErr.message.includes('duplicate key')) {
              console.error('[canvassiq-load-parcels] Non-duplicate insert error:', singleErr.message);
            }
          }
        } else if (inserted) {
          allInserted = allInserted.concat(inserted);
        }
      }

      console.log(`[canvassiq-load-parcels] Upserted ${allInserted.length} properties`);

      // Fire storm-public-lookup for owner enrichment in background batches
      if (allInserted.length > 0) {
        enrichPropertiesInBackground(supabaseUrl, supabaseKey, allInserted, tenant_id);
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          properties: allInserted,
          message: 'Properties loaded and enrichment started',
          count: allInserted.length
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

/**
 * Fire storm-public-lookup for each property in background (non-blocking)
 * Processes in batches of 5 concurrent requests
 */
async function enrichPropertiesInBackground(
  supabaseUrl: string,
  supabaseKey: string,
  properties: any[],
  tenantId: string
) {
  const batchSize = 5;
  
  for (let i = 0; i < properties.length; i += batchSize) {
    const batch = properties.slice(i, i + batchSize);
    
    try {
      await Promise.allSettled(
        batch.map(async (prop: any) => {
          try {
            const address = typeof prop.address === 'string' ? JSON.parse(prop.address) : prop.address;
            const formattedAddress = address?.formatted || address?.street || '';
            
            const response = await fetch(`${supabaseUrl}/functions/v1/storm-public-lookup`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                lat: prop.lat,
                lng: prop.lng,
                address: formattedAddress,
                tenant_id: tenantId,
                property_id: prop.id,
              }),
            });

            if (response.ok) {
              const data = await response.json();
              console.log(`[enrichBackground] Property ${prop.id}: owner="${data?.result?.owner_name}", confidence=${data?.result?.confidence_score}`);
            } else {
              console.error(`[enrichBackground] Property ${prop.id} failed: ${response.status}`);
            }
          } catch (err) {
            console.error(`[enrichBackground] Property ${prop.id} error:`, err);
          }
        })
      );
    } catch (err) {
      console.error('[enrichBackground] Batch error:', err);
    }
    
    // Small delay between batches
    if (i + batchSize < properties.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}

// Load real property data using Google Geocoding API
// NO REGRID - owner data comes from storm-public-lookup
async function loadRealParcelsFromGeocoding(
  centerLat: number, 
  centerLng: number, 
  radius: number, 
  tenantId: string,
  apiKey: string,
  existingAddressKeys: Set<string> = new Set()
): Promise<any[]> {
  const properties: any[] = [];
  const seenPlaceIds = new Set<string>();
  const seenAddresses = new Map<string, { lat: number; lng: number; distance: number }>();
  
  console.log(`[canvassiq-load-parcels] Skipping ${existingAddressKeys.size} addresses already in database`);
  
  const gridSpacing = 0.0002;
  const gridSize = Math.max(12, Math.min(20, Math.ceil(radius * 50)));
  
  console.log(`[canvassiq-load-parcels] Creating ${gridSize}x${gridSize} grid for parallel geocoding`);
  
  const gridPoints: { lat: number; lng: number }[] = [];
  for (let i = -Math.floor(gridSize / 2); i <= Math.floor(gridSize / 2); i++) {
    for (let j = -Math.floor(gridSize / 2); j <= Math.floor(gridSize / 2); j++) {
      gridPoints.push({
        lat: centerLat + (i * gridSpacing),
        lng: centerLng + (j * gridSpacing)
      });
    }
  }
  
  const batchSize = 15;
  const startTime = Date.now();
  const candidateProperties: any[] = [];
  
  for (let i = 0; i < gridPoints.length; i += batchSize) {
    const batch = gridPoints.slice(i, i + batchSize);
    
    const results = await Promise.all(
      batch.map(point => reverseGeocode(point.lat, point.lng, apiKey).catch(() => null))
    );
    
    for (const result of results) {
      if (result && result.place_id && !seenPlaceIds.has(result.place_id)) {
        seenPlaceIds.add(result.place_id);
        
        const normalizedAddressKey = normalizeAddressKey(result.street_number, result.street_name);
        
        const distanceFromCenter = Math.sqrt(
          Math.pow(result.lat - centerLat, 2) + 
          Math.pow(result.lng - centerLng, 2)
        );
        
        if (existingAddressKeys.has(normalizedAddressKey)) continue;
        
        const existingEntry = seenAddresses.get(normalizedAddressKey);
        
        if (!existingEntry) {
          seenAddresses.set(normalizedAddressKey, { lat: result.lat, lng: result.lng, distance: distanceFromCenter });
          
          candidateProperties.push({
            tenant_id: tenantId,
            lat: result.lat,
            lng: result.lng,
            original_lat: result.lat,
            original_lng: result.lng,
            building_snapped: false,
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
            owner_name: null, // Will be populated by storm-public-lookup
            property_data: {
              source: 'google_geocoding',
              geocoded_at: new Date().toISOString(),
              building_snapped: false,
              deduplicated: false,
            }
          });
        } else if (distanceFromCenter < existingEntry.distance) {
          seenAddresses.set(normalizedAddressKey, { lat: result.lat, lng: result.lng, distance: distanceFromCenter });
          
          const existingIdx = candidateProperties.findIndex(p => p.normalized_address_key === normalizedAddressKey);
          if (existingIdx !== -1) {
            candidateProperties[existingIdx] = {
              ...candidateProperties[existingIdx],
              lat: result.lat,
              lng: result.lng,
              original_lat: result.lat,
              original_lng: result.lng,
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
      }
    }
    
    if (i + batchSize < gridPoints.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  for (const prop of candidateProperties) {
    properties.push(prop);
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`[canvassiq-load-parcels] Found ${properties.length} new addresses (skipped ${existingAddressKeys.size} existing) in ${elapsed}ms`);
  return properties;
}

function normalizeAddressKey(streetNumber: string, streetName: string): string {
  let normalized = `${streetNumber}_${streetName}`.toLowerCase();
  
  const suffixMap: Record<string, string> = {
    'street': 'st', 'avenue': 'ave', 'boulevard': 'blvd', 'drive': 'dr',
    'road': 'rd', 'lane': 'ln', 'court': 'ct', 'place': 'pl',
    'circle': 'cir', 'way': 'way', 'terrace': 'ter', 'highway': 'hwy', 'parkway': 'pkwy',
  };
  
  for (const [full, short] of Object.entries(suffixMap)) {
    normalized = normalized.replace(new RegExp(`\\b${full}\\b`, 'g'), short);
  }
  
  normalized = normalized.replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_');
  return normalized;
}

async function reverseGeocode(lat: number, lng: number, apiKey: string): Promise<GeocodingResult | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=street_address&key=${apiKey}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' || !data.results?.length) return null;
  
  const result = data.results[0];
  const components = result.address_components || [];
  
  let streetNumber = '', streetName = '', city = '', state = '', zip = '';
  
  for (const component of components) {
    if (component.types.includes('street_number')) streetNumber = component.long_name;
    if (component.types.includes('route')) streetName = component.long_name;
    if (component.types.includes('locality')) city = component.long_name;
    if (component.types.includes('administrative_area_level_1')) state = component.short_name;
    if (component.types.includes('postal_code')) zip = component.long_name;
  }
  
  if (!streetNumber) return null;
  
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    street_number: streetNumber,
    street_name: streetName,
    city, state, zip,
    formatted_address: result.formatted_address,
    place_id: result.place_id
  };
}

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
          city, state, zip,
          formatted: `${streetNumber} ${streetName}, ${city}, ${state} ${zip}`
        }),
        address_hash: `${propLat.toFixed(6)}_${propLng.toFixed(6)}`,
        disposition: null,
        owner_name: null, // No fake names - will be enriched by public lookup
        property_data: JSON.stringify({
          property_type: 'single_family',
          source: 'sample_data',
        })
      });
      
      streetNumber += Math.floor(Math.random() * 10) + 2;
    }
  }
  
  return properties;
}
