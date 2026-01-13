// Supabase Edge Function: batch-regenerate-measurements
// Batch regenerate visualizations for measurements with coordinate mismatches

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();
    const { min_distance_meters = 30, max_batch_size = 50, severity_filter = null } = body;

    console.log('Starting batch regeneration:', { min_distance_meters, max_batch_size, severity_filter });

    // Query measurements needing regeneration
    const query = `
      SELECT 
        m.id as measurement_id,
        m.property_id,
        pe.metadata->>'address_street' as address,
        (pe.metadata->'verified_address'->'geometry'->'location'->>'lat')::numeric as verified_lat,
        (pe.metadata->'verified_address'->'geometry'->'location'->>'lng')::numeric as verified_lng,
        (m.visualization_metadata->'center'->>'lat')::numeric as viz_lat,
        (m.visualization_metadata->'center'->>'lng')::numeric as viz_lng,
        SQRT(
          POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lat')::numeric - 
                    (m.visualization_metadata->'center'->>'lat')::numeric), 2) + 
          POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lng')::numeric - 
                    (m.visualization_metadata->'center'->>'lng')::numeric), 2)
        ) * 111000 as distance_meters,
        CASE 
          WHEN SQRT(
            POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lat')::numeric - 
                      (m.visualization_metadata->'center'->>'lat')::numeric), 2) + 
            POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lng')::numeric - 
                      (m.visualization_metadata->'center'->>'lng')::numeric), 2)
          ) * 111000 > 50 THEN 'CRITICAL'
          WHEN SQRT(
            POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lat')::numeric - 
                      (m.visualization_metadata->'center'->>'lat')::numeric), 2) + 
            POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lng')::numeric - 
                      (m.visualization_metadata->'center'->>'lng')::numeric), 2)
          ) * 111000 > 30 THEN 'HIGH'
          ELSE 'MEDIUM'
        END as severity
      FROM measurements m
      JOIN pipeline_entries pe ON pe.id = m.property_id
      WHERE 
        pe.metadata->'verified_address'->'geometry'->'location' IS NOT NULL
        AND m.visualization_metadata->'center' IS NOT NULL
        AND m.mapbox_visualization_url IS NOT NULL
        AND SQRT(
          POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lat')::numeric - 
                    (m.visualization_metadata->'center'->>'lat')::numeric), 2) + 
          POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lng')::numeric - 
                    (m.visualization_metadata->'center'->>'lng')::numeric), 2)
        ) * 111000 >= ${min_distance_meters}
        ${severity_filter ? `AND CASE 
          WHEN SQRT(
            POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lat')::numeric - 
                      (m.visualization_metadata->'center'->>'lat')::numeric), 2) + 
            POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lng')::numeric - 
                      (m.visualization_metadata->'center'->>'lng')::numeric), 2)
          ) * 111000 > 50 THEN 'CRITICAL'
          WHEN SQRT(
            POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lat')::numeric - 
                      (m.visualization_metadata->'center'->>'lat')::numeric), 2) + 
            POWER(ABS((pe.metadata->'verified_address'->'geometry'->'location'->>'lng')::numeric - 
                      (m.visualization_metadata->'center'->>'lng')::numeric), 2)
          ) * 111000 > 30 THEN 'HIGH'
          ELSE 'MEDIUM'
        END = '${severity_filter}'` : ''}
      ORDER BY distance_meters DESC
      LIMIT ${max_batch_size};
    `;

    const { data: measurements, error: queryError } = await supabase.rpc('execute_sql', { query });

    if (queryError) {
      // Fallback: Use client-side query
      const { data: allMeasurements, error } = await supabase
        .from('measurements')
        .select(`
          id,
          property_id,
          visualization_metadata,
          mapbox_visualization_url
        `)
        .not('visualization_metadata', 'is', null)
        .not('mapbox_visualization_url', 'is', null)
        .limit(max_batch_size);

      if (error) throw error;

      console.log(`Found ${allMeasurements?.length || 0} measurements to check`);

      const results = {
        total_checked: allMeasurements?.length || 0,
        regenerated: 0,
        failed: 0,
        skipped: 0,
        details: [] as any[]
      };

      // Process each measurement
      for (const measurement of allMeasurements || []) {
        try {
          // Get pipeline entry for verified address
          const { data: pipelineData } = await supabase
            .from('pipeline_entries')
            .select('metadata')
            .eq('id', measurement.property_id)
            .single();

          if (!pipelineData?.metadata?.verified_address?.geometry?.location) {
            results.skipped++;
            continue;
          }

          const verifiedLat = pipelineData.metadata.verified_address.geometry.location.lat;
          const verifiedLng = pipelineData.metadata.verified_address.geometry.location.lng;
          const vizLat = measurement.visualization_metadata?.center?.lat;
          const vizLng = measurement.visualization_metadata?.center?.lng;

          if (!vizLat || !vizLng) {
            results.skipped++;
            continue;
          }

          // Calculate distance
          const latDiff = Math.abs(verifiedLat - vizLat);
          const lngDiff = Math.abs(verifiedLng - vizLng);
          const distanceMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000;

          if (distanceMeters < min_distance_meters) {
            results.skipped++;
            continue;
          }

          // Regenerate visualization
          console.log(`Regenerating measurement ${measurement.id}: ${Math.round(distanceMeters)}m offset`);

          const { data: regenData, error: regenError } = await supabase.functions.invoke(
            'generate-measurement-visualization',
            {
              body: {
                measurement_id: measurement.id,
                property_id: measurement.property_id,
                verified_address_lat: verifiedLat,
                verified_address_lng: verifiedLng,
                zoom_adjustment: 0,
              }
            }
          );

          if (regenError || !regenData?.ok) {
            results.failed++;
            results.details.push({
              measurement_id: measurement.id,
              status: 'failed',
              error: regenError?.message || regenData?.error,
              distance_meters: Math.round(distanceMeters)
            });
          } else {
            results.regenerated++;
            results.details.push({
              measurement_id: measurement.id,
              status: 'success',
              distance_meters: Math.round(distanceMeters),
              new_url: regenData.data.visualization_url
            });
          }

          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error: any) {
          console.error(`Failed to process measurement ${measurement.id}:`, error);
          results.failed++;
          results.details.push({
            measurement_id: measurement.id,
            status: 'error',
            error: error.message
          });
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          message: `Batch regeneration complete: ${results.regenerated} regenerated, ${results.failed} failed, ${results.skipped} skipped`,
          ...results
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If RPC query worked, process those results
    return new Response(
      JSON.stringify({
        ok: true,
        message: 'RPC query results',
        count: measurements?.length || 0,
        data: measurements
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Batch regeneration error:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: error.message
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
