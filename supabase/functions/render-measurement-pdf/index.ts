// ===================================================================
// render-measurement-pdf
//
// Builds the customer-ready PDF for an AI Measurement job by assembling
// the SVG diagram pages already stored in `ai_measurement_diagrams`.
//
// HARD RULES:
//   - Server-side QC gate: refuses to produce a PDF when geometry is
//     placeholder, solar_bbox, missing facets, or below the overlay
//     alignment threshold (0.75).
//   - Does NOT screen-print the React UI.
//   - Does NOT invent geometry. Only assembles what start-ai-measurement
//     has already validated and persisted.
//
// Input:  { ai_measurement_job_id?, lead_id?, project_id?, measurement_id? }
// Output: { pdf_url, page_count, ai_measurement_job_id }
//         or 422 { error: 'manual_measurement_required', message: ... }
// ===================================================================

import { createClient } from 'npm:@supabase/supabase-js@2.49.1'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BUCKET = 'measurement-reports'
const OVERLAY_THRESHOLD = 0.75

// US Letter @ 96 dpi
const PAGE_W = 816
const PAGE_H = 1056
const MARGIN = 32
const RESVG_WASM_URL = 'https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm'
let resvgReady: Promise<void> | null = null

interface Body {
  ai_measurement_job_id?: string
  lead_id?: string
  project_id?: string
  measurement_id?: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function resolveJobId(supa: any, body: Body): Promise<string | null> {
  if (body.ai_measurement_job_id) return body.ai_measurement_job_id

  if (body.measurement_id) {
    const { data } = await supa
      .from('roof_measurements')
      .select('ai_measurement_job_id')
      .eq('id', body.measurement_id)
      .maybeSingle()
    if (data?.ai_measurement_job_id) return data.ai_measurement_job_id as string
  }

  let q = supa
    .from('ai_measurement_jobs')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
  if (body.lead_id) q = q.eq('lead_id', body.lead_id)
  if (body.project_id) q = q.eq('project_id', body.project_id)
  const { data } = await q.maybeSingle()
  return data?.id || null
}

interface QcOutcome {
  ok: boolean
  reason?: string
  warnings?: string[]
  measurement?: any
}

async function qcGate(supa: any, jobId: string): Promise<QcOutcome> {
  const { data: m } = await supa
    .from('roof_measurements')
    .select(
      'id, validation_status, requires_manual_review, facet_count, geometry_report_json, ai_measurement_job_id, report_pdf_url, report_pdf_path, updated_at',
    )
    .eq('ai_measurement_job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!m) return { ok: false, reason: 'No published roof_measurements row for this job.' }

  if (
    m.validation_status === 'needs_internal_review' ||
    m.validation_status === 'needs_manual_measurement' // legacy
  ) {
    return { ok: false, reason: 'Job is flagged needs_internal_review.', measurement: m }
  }
  if (!m.facet_count || m.facet_count <= 0) {
    return { ok: false, reason: 'No roof facets recorded.', measurement: m }
  }
  const grj = m.geometry_report_json
  if (!grj) {
    return { ok: false, reason: 'geometry_report_json missing.', measurement: m }
  }
  if (grj.is_placeholder === true) {
    return { ok: false, reason: 'Geometry is placeholder.', measurement: m }
  }
  if (grj.geometry_source === 'google_solar_bbox') {
    return {
      ok: false,
      reason: 'Geometry source is google_solar_bbox (axis-aligned rectangles).',
      measurement: m,
    }
  }
  const warnings: string[] = []
  // Audit fix: hard-block customer PDF when geometry could not be verified.
  // Preview/inspection in the UI is unaffected — it does not pass through
  // this function.
  if (grj.single_plane_fallback === true) {
    return {
      ok: false,
      reason: 'single_plane_fallback: roof slopes could not be segmented. Preview allowed; PDF blocked until manual verification.',
      measurement: m,
    }
  }
  if (typeof grj.overlay_alignment_score === 'number' && grj.overlay_alignment_score < OVERLAY_THRESHOLD) {
    return {
      ok: false,
      reason: `overlay_alignment_score ${grj.overlay_alignment_score.toFixed(2)} is below the ${OVERLAY_THRESHOLD} review threshold.`,
      measurement: m,
    }
  }

  return { ok: true, warnings, measurement: m }
}

async function ensureResvgReady() {
  if (!resvgReady) resvgReady = initWasm(fetch(RESVG_WASM_URL))
  await resvgReady
}

async function rasterizeSvg(svg: string, targetWidth: number): Promise<Uint8Array> {
  await ensureResvgReady()
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round(targetWidth) },
    background: 'white',
  })
  return resvg.render().asPng()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  try {
    const jobId = await resolveJobId(supa, body)
    if (!jobId) return jsonResponse({ error: 'job_not_found' }, 404)

    const gate = await qcGate(supa, jobId)
    if (!gate.ok) {
      return jsonResponse(
        {
          error: 'internal_review_required',
          message: 'Automated roof geometry could not be verified.',
          reason: gate.reason,
          ai_measurement_job_id: jobId,
        },
        422,
      )
    }
    const reportWarnings = gate.warnings || []

    const { data: diagrams, error: dErr } = await supa
      .from('ai_measurement_diagrams')
      .select('id, diagram_type, title, page_number, svg_markup, tenant_id')
      .eq('ai_measurement_job_id', jobId)
      .order('page_number', { ascending: true })

    if (dErr) return jsonResponse({ error: 'load_diagrams_failed', detail: dErr.message }, 500)
    if (!diagrams || diagrams.length === 0) {
      return jsonResponse({ error: 'no_diagrams', message: 'No diagrams were generated.' }, 422)
    }

    const tenantId = (diagrams[0] as any).tenant_id || 'unknown'

    // Build PDF
    const pdf = await PDFDocument.create()
    pdf.setTitle('Roof Measurement Report')
    pdf.setProducer('PITCH CRM')

    for (const d of diagrams) {
      const page = pdf.addPage([PAGE_W, PAGE_H])
      const renderWidth = PAGE_W - MARGIN * 2
      const png = await rasterizeSvg(String(d.svg_markup || ''), renderWidth * 2) // 2x for crispness
      const img = await pdf.embedPng(png)
      const scale = renderWidth / img.width
      const drawW = img.width * scale
      const drawH = img.height * scale
      const x = (PAGE_W - drawW) / 2
      const y = PAGE_H - MARGIN - drawH
      page.drawImage(img, { x, y, width: drawW, height: drawH })
      if (reportWarnings.length > 0) {
        page.drawText('FOOTPRINT ESTIMATE — VERIFY BEFORE CUSTOMER USE', {
          x: MARGIN,
          y: 18,
          size: 10,
        })
      }
    }

    const pdfBytes = await pdf.save()

    // Ensure bucket exists (no-op if already there)
    try {
      await supa.storage.createBucket(BUCKET, { public: true })
    } catch (_e) { /* exists */ }

    const path = `reports/${tenantId}/${jobId}.pdf`
    const { error: upErr } = await supa.storage
      .from(BUCKET)
      .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true })
    if (upErr) return jsonResponse({ error: 'upload_failed', detail: upErr.message }, 500)

    const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(path)
    const pdfUrl = pub?.publicUrl || null

    // Persist URL on both rows (best-effort; columns may not exist yet on all environments)
    try {
      await supa
        .from('roof_measurements')
        .update({ report_pdf_url: pdfUrl })
        .eq('ai_measurement_job_id', jobId)
    } catch (_e) { /* column may be missing — non-fatal */ }
    try {
      await supa.from('ai_measurement_jobs').update({ report_pdf_url: pdfUrl }).eq('id', jobId)
    } catch (_e) { /* column may be missing — non-fatal */ }

    return jsonResponse({
      pdf_url: pdfUrl,
      page_count: diagrams.length,
      ai_measurement_job_id: jobId,
      warnings: reportWarnings,
    })
  } catch (err) {
    console.error('[render-measurement-pdf] error', err)
    return jsonResponse({ error: 'internal_error', detail: String((err as Error).message || err) }, 500)
  }
})
