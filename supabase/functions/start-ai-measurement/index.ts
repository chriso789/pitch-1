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
    const { pipelineEntryId, lat, lng, address, pitchOverride, tenantId, userId } = await req.json()

    if (!pipelineEntryId || lat == null || lng == null) {
      return new Response(JSON.stringify({ error: 'pipelineEntryId, lat, lng required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Create job row
    const { data: job, error: insertError } = await supabaseClient
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

    // Fire-and-forget: call analyze-roof-aerial in background
    // We use EdgeRuntime.waitUntil if available, otherwise just fire and don't await
    const processJob = async () => {
      try {
        // Update status to processing
        await supabaseClient
          .from('measurement_jobs')
          .update({ 
            status: 'processing', 
            progress_message: 'Fetching satellite imagery...',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)

        // Call the actual analysis function
        const analyzeResponse = await fetch(
          `${SUPABASE_URL}/functions/v1/analyze-roof-aerial`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              address: address || 'Unknown Address',
              coordinates: { lat, lng },
              customerId: pipelineEntryId,
              userId,
              pitchOverride: pitchOverride || undefined,
              useUnifiedPipeline: true,
            }),
          }
        )

        const result = await analyzeResponse.json()

        if (result.success) {
          await supabaseClient
            .from('measurement_jobs')
            .update({
              status: 'completed',
              progress_message: 'Measurement complete',
              measurement_id: result.measurementId || null,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
        } else {
          await supabaseClient
            .from('measurement_jobs')
            .update({
              status: 'failed',
              progress_message: 'Analysis failed',
              error: result.error || 'Unknown error',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
        }
      } catch (err: any) {
        console.error('Background processing error:', err)
        await supabaseClient
          .from('measurement_jobs')
          .update({
            status: 'failed',
            progress_message: 'Processing error',
            error: err.message || 'Unknown error',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
      }
    }

    // Fire background processing without blocking the response
    // EdgeRuntime.waitUntil keeps the function alive after responding
    if (typeof (globalThis as any).EdgeRuntime?.waitUntil === 'function') {
      (globalThis as any).EdgeRuntime.waitUntil(processJob())
    } else {
      // Fallback: just fire and forget (may get killed after response)
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

  } catch (error: any) {
    console.error('start-ai-measurement error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
