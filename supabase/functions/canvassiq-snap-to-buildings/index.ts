import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  tenant_id: string;
  batch_size?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const mapboxToken = Deno.env.get('MAPBOX_ACCESS_TOKEN');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!mapboxToken) {
      return new Response(
        JSON.stringify({ error: 'MAPBOX_ACCESS_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RequestBody = await req.json();
    const { tenant_id, batch_size = 50 } = body;

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[canvassiq-snap-to-buildings] Processing ${batch_size} properties for tenant ${tenant_id}`);

    // Fetch properties that haven't been snapped yet
    const { data: properties, error: fetchError } = await supabase
      .from('canvassiq_properties')
      .select('id, lat, lng')
      .eq('tenant_id', tenant_id)
      .or('building_snapped.is.null,building_snapped.eq.false')
      .limit(batch_size);

    if (fetchError) {
      console.error('[canvassiq-snap-to-buildings] Fetch error:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch properties', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!properties || properties.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No properties to process',
          processed: 0,
          snapped: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[canvassiq-snap-to-buildings] Found ${properties.length} properties to process`);

    let snappedCount = 0;
    let processedCount = 0;

    for (const property of properties) {
      try {
        const buildingCenter = await getBuildingCentroid(property.lat, property.lng, mapboxToken);
        
        if (buildingCenter) {
          const { error: updateError } = await supabase
            .from('canvassiq_properties')
            .update({
              lat: buildingCenter.lat,
              lng: buildingCenter.lng,
              original_lat: property.lat,
              original_lng: property.lng,
              building_snapped: true
            })
            .eq('id', property.id);

          if (!updateError) {
            snappedCount++;
            console.log(`[canvassiq-snap-to-buildings] Snapped property ${property.id}`);
          }
        } else {
          // Mark as processed even if no building found
          await supabase
            .from('canvassiq_properties')
            .update({
              building_snapped: true,
              original_lat: property.lat,
              original_lng: property.lng
            })
            .eq('id', property.id);
        }
        
        processedCount++;
        
        // Rate limit: 50ms between requests
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        console.error(`[canvassiq-snap-to-buildings] Error processing ${property.id}:`, err);
      }
    }

    console.log(`[canvassiq-snap-to-buildings] Processed ${processedCount}, snapped ${snappedCount}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: processedCount,
        snapped: snappedCount,
        remaining: properties.length === batch_size
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[canvassiq-snap-to-buildings] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function getBuildingCentroid(
  lat: number, 
  lng: number, 
  mapboxToken: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json?radius=30&layers=building&limit=5&access_token=${mapboxToken}`;
    
    const response = await fetch(url);
    if (!response.ok) {
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
    
    // Calculate centroid
    let sumLng = 0, sumLat = 0;
    const n = ring.length - 1;
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
