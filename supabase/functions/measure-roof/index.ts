import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PYTHON_INFERENCE_URL = Deno.env.get('PYTHON_INFERENCE_URL')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { lead_id, address, lat, lng, user_id, tenant_id, pitch_override } = body

    if (lat == null || lng == null) {
      return new Response(JSON.stringify({ error: 'Missing coordinates (lat, lng required)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // ── STEP 1: Call Python inference service ──
    if (!PYTHON_INFERENCE_URL) {
      // Fallback: return structured stub when no inference server is configured
      // This lets the pipeline work end-to-end while the model is being trained
      console.warn('PYTHON_INFERENCE_URL not set – returning stub measurement')

      const stubResult = buildStubResult(lat, lng, address)
      const saved = await saveMeasurement(supabase, {
        lead_id,
        user_id,
        tenant_id,
        address,
        lat,
        lng,
        result: stubResult,
        isStub: true,
      })

      return new Response(JSON.stringify({
        success: true,
        measurement_id: saved.id,
        stub: true,
        data: stubResult,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Call live inference
    const inferenceRes = await fetch(PYTHON_INFERENCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat,
        lng,
        address: address || 'Unknown Address',
        pitch_override: pitch_override || null,
      }),
    })

    if (!inferenceRes.ok) {
      const errText = await inferenceRes.text()
      console.error('Inference service error:', errText)
      return new Response(JSON.stringify({
        success: false,
        error: `Inference service returned ${inferenceRes.status}: ${errText}`,
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await inferenceRes.json()

    // ── STEP 2: Validate response schema ──
    if (!result || typeof result !== 'object') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Inference returned invalid response',
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── STEP 3: Save to Supabase ──
    const saved = await saveMeasurement(supabase, {
      lead_id,
      user_id,
      tenant_id,
      address,
      lat,
      lng,
      result,
      isStub: false,
    })

    return new Response(JSON.stringify({
      success: true,
      measurement_id: saved.id,
      data: result,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('measure-roof error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: (error instanceof Error ? error.message : String(error)) || 'Internal error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ── Helpers ──

interface SaveParams {
  lead_id?: string
  user_id?: string
  tenant_id?: string
  address?: string
  lat: number
  lng: number
  result: any
  isStub: boolean
}

async function saveMeasurement(supabase: any, params: SaveParams) {
  const { lead_id, user_id, tenant_id, address, lat, lng, result, isStub } = params

  const measurements = result.measurements || {}
  const lengths = measurements.lengths_ft || {}
  const roof = result.roof || {}
  const debug = result.debug || {}

  const row = {
    customer_id: lead_id || null,
    measured_by: user_id || null,
    tenant_id: tenant_id || null,
    property_address: address || 'Unknown',
    gps_coordinates: { lat, lng },
    target_lat: lat,
    target_lng: lng,

    // Structured columns
    roof_type: roof.type || result.roof_type || null,
    total_area_flat_sqft: measurements.area_sqft || result.area_sqft || null,
    predominant_pitch: measurements.predominant_pitch?.toString() || result.pitch?.toString() || null,
    pitch_degrees: measurements.predominant_pitch || result.pitch || null,
    measurement_confidence: roof.confidence || result.confidence || null,

    // Linear measurements
    total_ridge_length: lengths.ridge || result.totals?.ridge || null,
    total_hip_length: lengths.hip || result.totals?.hip || null,
    total_valley_length: lengths.valley || result.totals?.valley || null,
    total_eave_length: lengths.eave || result.totals?.eave || null,
    total_rake_length: lengths.rake || result.totals?.rake || null,

    // Full structured data
    ai_detection_data: result,
    metadata: {
      version: result.meta?.version || 'v1',
      source: isStub ? 'pitch-ai-stub' : 'pitch-ai',
      generated_at: new Date().toISOString(),
      debug: debug,
    },

    // Geometry
    footprint_vertices_geo: result.geometry?.footprint_polygon || null,
    edge_segments: result.geometry?.features || null,
    meters_per_pixel: debug.meters_per_pixel || null,

    // Status
    measurement_method: isStub ? 'ai-stub' : 'ai-inference',
    detection_method: isStub ? 'stub' : 'roofnet-v1',
    verification_status: isStub ? 'pending' : 'auto-verified',
  }

  const { data, error } = await supabase
    .from('roof_measurements')
    .insert(row)
    .select('id')
    .single()

  if (error) {
    console.error('DB insert error:', error)
    throw new Error(`Failed to save measurement: ${(error instanceof Error ? error.message : String(error))}`)
  }

  return data
}

function buildStubResult(lat: number, lng: number, address?: string) {
  return {
    meta: {
      version: 'v1',
      source: 'pitch-ai-stub',
      generated_at: new Date().toISOString(),
      note: 'Stub result — inference server not configured. Deploy inference_server.py and set PYTHON_INFERENCE_URL.',
    },
    location: {
      address: address || 'Unknown',
      lat,
      lng,
    },
    roof: {
      type: 'unknown',
      confidence: 0,
    },
    measurements: {
      area_sqft: 0,
      predominant_pitch: 0,
      lengths_ft: {
        ridge: 0,
        hip: 0,
        valley: 0,
        eave: 0,
        rake: 0,
      },
    },
    geometry: {
      footprint_polygon: [],
      features: [],
    },
    debug: {
      meters_per_pixel: 0,
      alignment_score: 0,
      solar_pitch_used: false,
      stub: true,
    },
  }
}
