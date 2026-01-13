import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

interface RemeasureResult {
  pipeline_entry_id: string;
  status: 'success' | 'failed' | 'skipped';
  original_imagery_date?: string;
  new_imagery_date?: string;
  original_area?: number;
  new_area?: number;
  variance_pct?: number;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      max_imagery_age_years = 5,
      max_batch_size = 25,
      tenant_id,
      triggered_by
    } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`🔄 Starting batch re-measurement for imagery older than ${max_imagery_age_years} years`);
    console.log(`📦 Batch size: ${max_batch_size}`);

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - max_imagery_age_years);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    console.log(`📅 Cutoff date: ${cutoffDateStr}`);

    // Query measurements with old imagery
    let query = supabase
      .from('measurements')
      .select(`
        id,
        property_id,
        imagery_date,
        summary,
        pipeline_entries!inner(
          id,
          tenant_id,
          contacts!inner(latitude, longitude, verified_address)
        )
      `)
      .eq('is_active', true)
      .lt('imagery_date', cutoffDateStr)
      .order('imagery_date', { ascending: true })
      .limit(max_batch_size);

    if (tenant_id) {
      query = query.eq('pipeline_entries.tenant_id', tenant_id);
    }

    const { data: oldMeasurements, error: queryError } = await query as any;

    if (queryError) {
      throw new Error(`Query error: ${queryError.message}`);
    }

    if (!oldMeasurements || oldMeasurements.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        message: 'No measurements found with imagery older than cutoff date',
        processed: 0,
        results: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`📊 Found ${oldMeasurements.length} measurements to re-pull`);

    const results: RemeasureResult[] = [];
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // Process each measurement
    for (const measurement of oldMeasurements) {
      const pipelineEntry = measurement.pipeline_entries;
      const contact = pipelineEntry?.contacts;
      
      // Get coordinates
      let lat: number | undefined;
      let lng: number | undefined;

      if (contact?.verified_address?.lat && contact?.verified_address?.lng) {
        lat = contact.verified_address.lat;
        lng = contact.verified_address.lng;
      } else if (contact?.latitude && contact?.longitude) {
        lat = contact.latitude;
        lng = contact.longitude;
      }

      if (!lat || !lng) {
        results.push({
          pipeline_entry_id: pipelineEntry.id,
          status: 'skipped',
          error: 'No coordinates available'
        });
        skippedCount++;
        continue;
      }

      try {
        console.log(`🔄 Re-measuring: ${pipelineEntry.id} (imagery from ${measurement.imagery_date})`);

        // Call the measure function to re-pull measurements
        const { data: measureResult, error: measureError } = await supabase.functions.invoke('measure', {
          body: {
            action: 'pull',
            propertyId: pipelineEntry.id,
            lat,
            lng
          }
        });

        if (measureError || !measureResult?.ok) {
          throw new Error(measureError?.message || measureResult?.error || 'Measurement failed');
        }

        const newMeasurement = measureResult.data?.measurement;
        const originalArea = measurement.summary?.total_area_sqft || 0;
        const newArea = newMeasurement?.summary?.total_area_sqft || 0;
        const variancePct = originalArea > 0 
          ? Math.abs((newArea - originalArea) / originalArea) * 100 
          : 0;

        // Log the remeasurement
        await supabase.from('measurement_remeasure_log').insert({
          pipeline_entry_id: pipelineEntry.id,
          original_imagery_date: measurement.imagery_date,
          new_imagery_date: newMeasurement?.imagery_date || new Date().toISOString().split('T')[0],
          original_values: measurement.summary,
          new_values: newMeasurement?.summary,
          variance_pct: variancePct,
          status: 'success',
          triggered_by
        } as any);

        results.push({
          pipeline_entry_id: pipelineEntry.id,
          status: 'success',
          original_imagery_date: measurement.imagery_date,
          new_imagery_date: newMeasurement?.imagery_date,
          original_area: originalArea,
          new_area: newArea,
          variance_pct: variancePct
        });
        successCount++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`❌ Failed to remeasure ${pipelineEntry.id}:`, error);
        
        // Log the failure
        await supabase.from('measurement_remeasure_log').insert({
          pipeline_entry_id: pipelineEntry.id,
          original_imagery_date: measurement.imagery_date,
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          triggered_by
        } as any);

        results.push({
          pipeline_entry_id: pipelineEntry.id,
          status: 'failed',
          original_imagery_date: measurement.imagery_date,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        failedCount++;
      }
    }

    console.log(`✅ Batch re-measurement complete: ${successCount} success, ${failedCount} failed, ${skippedCount} skipped`);

    return new Response(JSON.stringify({
      ok: true,
      processed: oldMeasurements.length,
      success: successCount,
      failed: failedCount,
      skipped: skippedCount,
      cutoff_date: cutoffDateStr,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Batch re-measurement error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});