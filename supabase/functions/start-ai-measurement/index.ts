import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('authorization') || '';
    const { pipelineEntryId, lat, lng, address, pitchOverride, tenantId, userId } = await req.json()

    if (!pipelineEntryId || lat == null || lng == null) {
      return new Response(JSON.stringify({ error: 'pipelineEntryId, lat, lng required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Create job row
    const { data: job, error: insertError } = await supabaseAdmin
      .from('measurement_jobs')
      .insert({
        tenant_id: tenantId || 'unknown',
        pipeline_entry_id: pipelineEntryId,
        user_id: userId || null,
        status: 'queued',
        progress_message: 'Queued for processing',
        lat,
        lng,
        address: address || null,
        pitch_override: pitchOverride || null,
      })
      .select('id')
      .single()

    if (insertError) throw insertError

    // Fire-and-forget background processing
    const processJob = async () => {
      try {
        // Update status to processing
        await supabaseAdmin
          .from('measurement_jobs')
          .update({ 
            status: 'processing', 
            progress_message: 'Running AI measurement analysis...',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)

        // Call the canonical measure function with action=pull
        const measureResponse = await fetch(
          `${SUPABASE_URL}/functions/v1/measure`,
          {
            method: 'POST',
            headers: {
              'Authorization': authHeader || `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'pull',
              propertyId: pipelineEntryId,
              lat: Number(lat),
              lng: Number(lng),
              address: address || 'Unknown Address',
              engine: 'skeleton',
              pitchOverride: pitchOverride || undefined,
            }),
          }
        )

        const measureResult = await measureResponse.json()
        console.log('[start-ai-measurement] Measure result:', JSON.stringify(measureResult).substring(0, 500))

        if (!measureResult?.ok || !measureResult?.data?.measurement) {
          throw new Error(measureResult?.error || 'Measure function returned no data')
        }

        const measurement = measureResult.data.measurement
        const tags = measureResult.data.tags || {}
        const engineUsed = measureResult.data.engine_used || 'skeleton'
        const requiresManualReview = Boolean(
          measureResult.data.manualReviewRecommended ??
          measureResult.data.manual_review_recommended ??
          measurement.manual_review_recommended ??
          measurement.requires_manual_review ??
          tags['meta.manual_review_recommended'] ??
          false
        )
        const validationStatus = requiresManualReview ? 'flagged' : 'validated'

        // === BRIDGE STEP: Publish to roof_measurements ===
        // This is the table the lead page UI actually reads
        const summary = measurement.summary || {}
        const roofMeasurementId = crypto.randomUUID()

        const { error: roofInsertError } = await supabaseAdmin
          .from('roof_measurements')
          .insert({
            id: roofMeasurementId,
            customer_id: pipelineEntryId,
            measured_by: userId || null,
            property_address: address || 'Unknown Address',
            gps_coordinates: { lat: Number(lat), lng: Number(lng) },
            ai_detection_data: {
              source: measurement.source || engineUsed,
              faces: measurement.faces || [],
              linear_features: measurement.linear_features || [],
              summary,
              engine_used: engineUsed,
              canonical_measurement_id: measurement.id,
            },
            ai_model_version: engineUsed,
            detection_timestamp: new Date().toISOString(),
            detection_confidence: 0.85,
            // Area totals
            total_area_flat_sqft: summary.total_area_sqft || 0,
            total_area_adjusted_sqft: summary.total_area_sqft || 0,
            total_squares: summary.total_squares || 0,
            waste_factor_percent: summary.waste_pct || 10,
            total_squares_with_waste: (summary.total_squares || 0) * (1 + (summary.waste_pct || 10) / 100),
            // Pitch
            predominant_pitch: summary.pitch || tags['roof.predominant_pitch'] || '6/12',
            pitch_multiplier: 1.0,
            // Linear totals
            total_ridge_length: summary.ridge_ft || 0,
            total_hip_length: summary.hip_ft || 0,
            total_valley_length: summary.valley_ft || 0,
            total_eave_length: summary.eave_ft || 0,
            total_rake_length: summary.rake_ft || 0,
            // Facets
            facet_count: (measurement.faces || []).length || 2,
            // Geometry
            footprint_source: (() => {
              const allowed = ['mapbox_vector','regrid_parcel','osm_overpass','microsoft_buildings','solar_api_footprint','solar_bbox_fallback','manual_trace','manual_entry','imported','user_drawn','ai_detection','esri_buildings','google_solar_api','osm','google_maps','satellite','unknown'];
              const src = measurement.source || 'google_solar_api';
              return allowed.includes(src) ? src : 'google_solar_api';
            })(),
            detection_method: engineUsed,
            target_lat: Number(lat),
            target_lng: Number(lng),
            perimeter_wkt: measurement.geom_wkt || null,
            // Imagery
            google_maps_image_url: measurement.google_maps_image_url || null,
            mapbox_image_url: measurement.mapbox_image_url || null,
            satellite_overlay_url: measurement.satellite_overlay_url || null,
            solar_building_footprint_sqft: summary.total_area_sqft || null,
            // Overlay schema for diagram
            overlay_schema: measurement.overlay_schema || null,
            // Confidence
            measurement_confidence: 0.85,
            requires_manual_review: requiresManualReview,
            validation_status: validationStatus,
            // Organization
            tenant_id: tenantId || null,
          })

        if (roofInsertError) {
          console.error('[start-ai-measurement] roof_measurements insert error:', roofInsertError)
          throw new Error(`Failed to publish to roof_measurements: ${roofInsertError.message}`)
        }

        console.log('[start-ai-measurement] ✅ Published to roof_measurements:', roofMeasurementId)

        // === AUTO-SAVE: Create measurement_approvals row ===
        // So the "Saved Measurements" panel shows the result immediately
        const eaveLength = summary.eave_ft || 0
        const rakeLength = summary.rake_ft || 0

        const savedTags = {
          'roof.plan_area': summary.total_area_sqft || 0,
          'roof.total_sqft': summary.total_area_sqft || 0,
          'roof.squares': summary.total_squares || 0,
          'roof.predominant_pitch': summary.pitch || tags['roof.predominant_pitch'] || '6/12',
          'roof.faces_count': (measurement.faces || []).length || 2,
          'lf.ridge': summary.ridge_ft || 0,
          'lf.hip': summary.hip_ft || 0,
          'lf.valley': summary.valley_ft || 0,
          'lf.eave': eaveLength,
          'lf.rake': rakeLength,
          'lf.perimeter': eaveLength + rakeLength,
          'source': `ai_pulled_${engineUsed}`,
          'measurement_id': roofMeasurementId,
          'canonical_measurement_id': measurement.id,
          'imported_at': new Date().toISOString(),
        }

        const { error: approvalError } = await supabaseAdmin
          .from('measurement_approvals')
          .insert({
            tenant_id: tenantId || null,
            pipeline_entry_id: pipelineEntryId,
            approved_at: new Date().toISOString(),
            saved_tags: savedTags,
            approval_notes: `AI measurement (${engineUsed}) - ${Math.round(summary.total_area_sqft || 0).toLocaleString()} sqft`,
          })

        if (approvalError) {
          console.warn('[start-ai-measurement] measurement_approvals insert warning:', approvalError)
          // Non-fatal: roof_measurements already written
        } else {
          console.log('[start-ai-measurement] ✅ Auto-saved to measurement_approvals')
        }

        // Mark job completed with the roof_measurements ID
        await supabaseAdmin
          .from('measurement_jobs')
          .update({
            status: 'completed',
            progress_message: 'Measurement complete and published',
            measurement_id: roofMeasurementId,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)

        console.log('[start-ai-measurement] ✅ Job completed:', job.id)

      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        console.error('[start-ai-measurement] Background processing error:', errorMessage)
        await supabaseAdmin
          .from('measurement_jobs')
          .update({
            status: 'failed',
            progress_message: 'Processing error',
            error: errorMessage,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
      }
    }

    // Fire background processing without blocking the response
    if (typeof (globalThis as any).EdgeRuntime?.waitUntil === 'function') {
      (globalThis as any).EdgeRuntime.waitUntil(processJob())
    } else {
      processJob().catch(console.error)
    }

    // Return immediately with job ID
    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      status: 'queued',
      message: 'Measurement job started',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('start-ai-measurement error:', errorMessage)
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
