// ===================================================================
// render-measurement-pdf
//
// Builds a customer-ready PDF for an AI Measurement job from the
// validated geometry already persisted by start-ai-measurement.
//
// This renderer intentionally avoids SVG rasterization/WASM because the
// previous Resvg path exceeded Edge Function CPU limits on real reports.
// It draws the report directly with pdf-lib using the saved planes, edges,
// totals, and aerial raster URL.
// ===================================================================

import { createClient } from 'npm:@supabase/supabase-js@2.49.1'
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BUCKET = 'measurement-reports'
const OVERLAY_THRESHOLD = 0.75

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 36

type PointTuple = [number, number]
type Box = { x: number; y: number; w: number; h: number }

interface Body {
  ai_measurement_job_id?: string
  lead_id?: string
  project_id?: string
  measurement_id?: string
}

interface QcOutcome {
  ok: boolean
  reason?: string
  warnings?: string[]
  measurement?: any
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function signatureSlug(input: string | null | undefined) {
  const text = input || new Date().toISOString()
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
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

async function qcGate(supa: any, jobId: string): Promise<QcOutcome> {
  const { data: m } = await supa
    .from('roof_measurements')
    .select('id, tenant_id, property_address, validation_status, validation_notes, requires_manual_review, facet_count, geometry_report_json, ai_measurement_job_id, report_pdf_url, report_pdf_path, updated_at, total_area_flat_sqft, total_area_adjusted_sqft, total_squares, predominant_pitch, total_ridge_length, total_hip_length, total_valley_length, total_eave_length, total_rake_length, mapbox_image_url, google_maps_image_url, satellite_overlay_url, analysis_image_size, target_lat, target_lng')
    .eq('ai_measurement_job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!m) return { ok: false, reason: 'No published roof_measurements row for this job.' }

  if (m.validation_status === 'needs_internal_review' || m.validation_status === 'needs_manual_measurement') {
    return { ok: false, reason: 'Job is flagged needs_internal_review.', measurement: m }
  }
  if (!m.facet_count || m.facet_count <= 0) return { ok: false, reason: 'No roof facets recorded.', measurement: m }

  const grj = m.geometry_report_json
  if (!grj) return { ok: false, reason: 'geometry_report_json missing.', measurement: m }
  if (grj.is_placeholder === true) return { ok: false, reason: 'Geometry is placeholder.', measurement: m }
  if (grj.status === 'needs_internal_review' || String(grj.reason || grj.block_customer_report_reason || '').includes('ridge_edges_not_aligned_to_roof_structure')) {
    return { ok: false, reason: 'ridge_edges_not_aligned_to_roof_structure', measurement: m }
  }
  if (grj.block_customer_report_reason) return { ok: false, reason: String(grj.block_customer_report_reason), measurement: m }

  const structuralEdges = Array.isArray(grj.edges)
    ? grj.edges.filter((e: any) => ['ridge', 'hip', 'valley'].includes(String(e?.edge_type || e?.type)))
    : []
  const hasFuzzyStructuralEdge = structuralEdges.some((e: any) => String(e?.source || '').toLowerCase().includes('fuzzy'))
  if (hasFuzzyStructuralEdge) return { ok: false, reason: 'fuzzy_structural_edges_not_publishable', measurement: m }
  if (grj.geometry_source === 'google_solar_bbox') return { ok: false, reason: 'Geometry source is google_solar_bbox (axis-aligned rectangles).', measurement: m }

  const warnings: string[] = []
  if (grj.single_plane_fallback === true) return { ok: false, reason: 'single_plane_fallback: roof slopes could not be segmented. Preview allowed; PDF blocked until manual verification.', measurement: m }
  if (typeof grj.overlay_alignment_score === 'number' && grj.overlay_alignment_score < OVERLAY_THRESHOLD) {
    return { ok: false, reason: `overlay_alignment_score ${grj.overlay_alignment_score.toFixed(2)} is below the ${OVERLAY_THRESHOLD} review threshold.`, measurement: m }
  }

  const cal = grj.overlay_calibration
  if (cal?.calibrated !== true) return { ok: false, reason: 'overlay_alignment_failed', measurement: m }
  if (cal?.calibrated === true) {
    if (Number(cal.coverage_ratio_width) < 0.65 || Number(cal.coverage_ratio_height) < 0.65) return { ok: false, reason: 'overlay_alignment_failed', measurement: m }
    if (Number(cal.center_error_px) > 80) return { ok: false, reason: 'overlay_alignment_failed', measurement: m }
  }

  return { ok: true, warnings, measurement: m }
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

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  try {
    const jobId = await resolveJobId(supa, body)
    if (!jobId) return jsonResponse({ error: 'job_not_found' }, 404)

    const gate = await qcGate(supa, jobId)
    if (!gate.ok) {
      return jsonResponse({
        error: 'internal_review_required',
        message: 'Automated roof geometry could not be verified.',
        reason: gate.reason,
        ai_measurement_job_id: jobId,
      }, 422)
    }

    const measurement = gate.measurement
    const grj = measurement?.geometry_report_json || {}
    const incomingSig: string | null = grj.pdf_source_signature || null
    const lastRenderedSig: string | null = grj.last_rendered_pdf_signature || null
    const signatureChanged = !!incomingSig && incomingSig !== lastRenderedSig
    const cachedPdfUrl: string | null = measurement?.report_pdf_url || null

    if (cachedPdfUrl && !signatureChanged) {
      return jsonResponse({
        pdf_url: cachedPdfUrl,
        page_count: 6,
        ai_measurement_job_id: jobId,
        warnings: gate.warnings || [],
        cached: true,
      })
    }

    const pdfBytes = await buildMeasurementPdf(measurement, gate.warnings || [])

    try {
      await supa.storage.createBucket(BUCKET, { public: true })
    } catch (_e) {
      // Bucket already exists.
    }

    const sigSlug = await signatureSlug(incomingSig || `${jobId}:${measurement?.id || ''}:${Date.now()}`)
    const tenantId = measurement?.tenant_id || 'unknown'
    const path = `reports/${tenantId}/${jobId}/${sigSlug}.pdf`
    const { error: upErr } = await supa.storage
      .from(BUCKET)
      .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true })
    if (upErr) return jsonResponse({ error: 'upload_failed', detail: upErr.message }, 500)

    const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(path)
    const pdfUrl = pub?.publicUrl || null
    const updatedGrj = { ...(grj || {}), last_rendered_pdf_signature: incomingSig }

    await supa
      .from('roof_measurements')
      .update({ report_pdf_url: pdfUrl, report_pdf_path: path, report_generated_at: new Date().toISOString(), geometry_report_json: updatedGrj })
      .eq('ai_measurement_job_id', jobId)
    await supa
      .from('ai_measurement_jobs')
      .update({ report_pdf_url: pdfUrl, report_pdf_path: path })
      .eq('id', jobId)

    return jsonResponse({
      pdf_url: pdfUrl,
      page_count: 6,
      ai_measurement_job_id: jobId,
      warnings: gate.warnings || [],
    })
  } catch (err) {
    console.error('[render-measurement-pdf] error', err)
    return jsonResponse({ error: 'internal_error', detail: String((err as Error).message || err) }, 500)
  }
})

async function buildMeasurementPdf(measurement: any, warnings: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle('Roof Measurement Report')
  pdf.setProducer('PITCH CRM')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const grj = measurement.geometry_report_json || {}
  const totals = grj.totals || {}
  const planes = normalizePlanes(grj)
  const edges = normalizeEdges(grj)
  const rasterSize = grj.raster_size || grj.overlay_debug?.raster_size || measurement.analysis_image_size || { width: 1280, height: 1280 }
  const imageUrl = grj.raster_image_url || grj.overlay_debug?.raster_url || measurement.satellite_overlay_url || measurement.google_maps_image_url || measurement.mapbox_image_url || null
  const embeddedImage = imageUrl ? await fetchPdfImage(pdf, imageUrl) : null

  const ctx = { pdf, font, bold, measurement, grj, totals, planes, edges, rasterSize, embeddedImage, warnings }
  drawCoverPage(ctx)
  drawOverlayPage(ctx)
  drawLengthPage(ctx)
  drawPitchPage(ctx)
  drawAreaPage(ctx)
  drawNotesPage(ctx)

  return await pdf.save()
}

function normalizePlanes(grj: any): Array<{ polygon: PointTuple[]; pitch?: any; area?: any; source?: string }> {
  if (Array.isArray(grj.planes_px) && grj.planes_px.length) {
    return grj.planes_px.map((p: any, idx: number) => ({
      polygon: asTuplePoints(p.polygon),
      pitch: grj.planes?.[idx]?.pitch ?? grj.planes?.[idx]?.pitch_degrees ?? null,
      area: grj.planes?.[idx]?.area_pitch_adjusted_sqft ?? grj.planes?.[idx]?.area_2d_sqft ?? null,
      source: p.source,
    })).filter((p: any) => p.polygon.length >= 3)
  }
  if (Array.isArray(grj.planes)) {
    return grj.planes.map((p: any) => ({
      polygon: asPointObjects(p.polygon_px || p.polygon).map((pt) => [pt.x, pt.y] as PointTuple),
      pitch: p.pitch ?? p.pitch_degrees ?? null,
      area: p.area_pitch_adjusted_sqft ?? p.area_2d_sqft ?? null,
      source: p.source,
    })).filter((p: any) => p.polygon.length >= 3)
  }
  return []
}

function normalizeEdges(grj: any): Array<{ type: string; p1: PointTuple; p2: PointTuple; length?: any; source?: string }> {
  if (Array.isArray(grj.edges_px) && grj.edges_px.length) {
    return grj.edges_px.map((e: any, idx: number) => ({
      type: String(e.type || e.edge_type || 'unknown'),
      p1: e.p1,
      p2: e.p2,
      length: grj.edges?.[idx]?.length_ft ?? e.length_ft ?? null,
      source: e.source,
    })).filter((e: any) => validTuple(e.p1) && validTuple(e.p2))
  }
  if (Array.isArray(grj.edges)) {
    return grj.edges.map((e: any) => {
      const pts = asPointObjects(e.line_px || e.line || [])
      return { type: String(e.edge_type || e.type || 'unknown'), p1: [pts[0]?.x, pts[0]?.y], p2: [pts[1]?.x, pts[1]?.y], length: e.length_ft, source: e.source }
    }).filter((e: any) => validTuple(e.p1) && validTuple(e.p2))
  }
  return []
}

async function fetchPdfImage(pdf: PDFDocument, url: string): Promise<any | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    try {
      return await pdf.embedPng(bytes)
    } catch {
      try { return await pdf.embedJpg(bytes) } catch { return null }
    }
  } catch (_e) {
    return null
  }
}

function drawCoverPage(ctx: any) {
  const page = newPage(ctx, 'Roof Measurement Report')
  drawText(page, ctx.bold, 'PITCH AI Measurement Report', MARGIN, 716, 22)
  drawWrappedText(page, ctx.font, safe(ctx.measurement.property_address || 'Unknown property'), MARGIN, 688, 11, 540)

  const imageBox = { x: 56, y: 270, w: 500, h: 360 }
  drawImageContain(page, ctx.embeddedImage, imageBox)

  const stats = [
    ['Total Area', `${fmt(num(ctx.measurement.total_area_adjusted_sqft || ctx.totals.total_area_pitch_adjusted_sqft))} sq ft`],
    ['Squares', fmt(num(ctx.measurement.total_squares || ctx.totals.roof_square_count))],
    ['Facets', fmt(num(ctx.measurement.facet_count || ctx.planes.length), 0)],
    ['Pitch', safe(ctx.measurement.predominant_pitch || ctx.totals.dominant_pitch || '—')],
    ['Ridge', `${fmt(num(ctx.measurement.total_ridge_length || ctx.totals.ridge_length_ft), 0)} LF`],
    ['Hip', `${fmt(num(ctx.measurement.total_hip_length || ctx.totals.hip_length_ft), 0)} LF`],
    ['Valley', `${fmt(num(ctx.measurement.total_valley_length || ctx.totals.valley_length_ft), 0)} LF`],
    ['Eave', `${fmt(num(ctx.measurement.total_eave_length || ctx.totals.eave_length_ft), 0)} LF`],
  ]
  drawStatGrid(page, ctx.font, ctx.bold, stats, 56, 126)
  drawFooter(page, ctx.font)
}

function drawOverlayPage(ctx: any) {
  const page = newPage(ctx, 'Image / Overlay')
  const box = { x: 56, y: 150, w: 500, h: 520 }
  drawImageContain(page, ctx.embeddedImage, box)
  drawGeometry(page, ctx, box, 'raster', { fillPlanes: true, showLabels: false })
  drawLegend(page, ctx.font, 56, 118)
  drawFooter(page, ctx.font)
}

function drawLengthPage(ctx: any) {
  const page = newPage(ctx, 'Length Diagram')
  drawSummaryLine(page, ctx.font, ctx.bold, ctx, 650)
  const box = { x: 72, y: 160, w: 468, h: 450 }
  drawGeometry(page, ctx, box, 'bbox', { fillPlanes: false, showLabels: true, labelMode: 'length' })
  drawLegend(page, ctx.font, 72, 122)
  drawFooter(page, ctx.font)
}

function drawPitchPage(ctx: any) {
  const page = newPage(ctx, 'Pitch Diagram')
  const box = { x: 72, y: 150, w: 468, h: 500 }
  drawGeometry(page, ctx, box, 'bbox', { fillPlanes: true, showLabels: true, labelMode: 'pitch' })
  drawFooter(page, ctx.font)
}

function drawAreaPage(ctx: any) {
  const page = newPage(ctx, 'Area Diagram')
  const box = { x: 72, y: 150, w: 468, h: 500 }
  drawGeometry(page, ctx, box, 'bbox', { fillPlanes: true, showLabels: true, labelMode: 'area' })
  drawFooter(page, ctx.font)
}

function drawNotesPage(ctx: any) {
  const page = newPage(ctx, 'Notes / QA')
  const quality = ctx.grj.quality || {}
  const cal = ctx.grj.overlay_calibration || {}
  const rows = [
    ['Validation status', safe(ctx.measurement.validation_status || ctx.grj.status || 'validated')],
    ['Topology source', safe(ctx.grj.topology_source || ctx.grj.inference_source || '—')],
    ['Footprint source', safe(ctx.measurement.footprint_source || ctx.grj.footprint_source || '—')],
    ['Coordinate solver', safe(ctx.grj.coordinate_space_solver || ctx.grj.overlay_debug?.coordinate_space_solver || '—')],
    ['Validated faces', fmt(num(ctx.grj.validated_faces || ctx.measurement.facet_count || ctx.planes.length), 0)],
    ['Attempted faces', fmt(num(ctx.grj.attempted_faces || ctx.planes.length), 0)],
    ['Overlay calibrated', cal.calibrated === true ? 'true' : 'false'],
    ['Coverage width/height', `${fmt(num(cal.coverage_ratio_width), 3)} / ${fmt(num(cal.coverage_ratio_height), 3)}`],
    ['Quality score', quality.overall_score != null ? `${Math.round(Number(quality.overall_score) * 100)}%` : '—'],
  ]
  let y = 660
  for (const [label, value] of rows) {
    page.drawText(label, { x: 70, y, size: 10, font: ctx.bold, color: rgb(0.18, 0.2, 0.24) })
    page.drawText(value, { x: 250, y, size: 10, font: ctx.font, color: rgb(0.18, 0.2, 0.24) })
    y -= 24
  }
  if (ctx.warnings.length) {
    drawWrappedText(page, ctx.font, `Warnings: ${ctx.warnings.join('; ')}`, 70, y - 10, 10, 470)
  }
  drawWrappedText(page, ctx.font, 'This report is generated from validated DSM/satellite geometry only. Measurements are rounded for presentation and should remain tied to the saved roof measurement record for estimating.', 70, 170, 10, 470)
  drawFooter(page, ctx.font)
}

function newPage(ctx: any, title: string) {
  const page = ctx.pdf.addPage([PAGE_W, PAGE_H])
  page.drawText(title, { x: MARGIN, y: 744, size: 18, font: ctx.bold, color: rgb(0.07, 0.08, 0.1) })
  page.drawLine({ start: { x: MARGIN, y: 728 }, end: { x: PAGE_W - MARGIN, y: 728 }, thickness: 0.8, color: rgb(0.82, 0.84, 0.88) })
  return page
}

function drawGeometry(page: any, ctx: any, box: Box, mode: 'raster' | 'bbox', opts: any) {
  // Build footprint polygon (convex hull of all plane vertices) for clipping
  const allPlaneVerts: PointTuple[] = ctx.planes.flatMap((p: any) => p.polygon)
  const footprintHull = convexHull(allPlaneVerts)

  const mapper = mode === 'raster'
    ? rasterMapper(ctx.rasterSize, box)
    : bboxMapper([...allPlaneVerts, ...ctx.edges.flatMap((e: any) => [e.p1, e.p2])], box)

  if (opts.fillPlanes) {
    ctx.planes.forEach((plane: any, idx: number) => {
      const pts = plane.polygon.map(mapper)
      drawPolygon(page, pts, rgb(0.9, 0.94, 0.98), rgb(0.36, 0.46, 0.58), 0.45)
      if (opts.showLabels) drawPlaneLabel(page, ctx, pts, plane, idx, opts.labelMode)
    })
  } else {
    ctx.planes.forEach((plane: any) => drawPolygon(page, plane.polygon.map(mapper), undefined, rgb(0.35, 0.38, 0.42), 0.5))
  }

  // Clip internal edges (ridge/hip/valley) to the footprint polygon so they
  // don't extend outside the perimeter. Eave/rake are perimeter edges — draw as-is.
  ctx.edges.forEach((edge: any) => {
    const t = String(edge.type).toLowerCase()
    let ep1: PointTuple = edge.p1
    let ep2: PointTuple = edge.p2
    if (['ridge', 'hip', 'valley'].includes(t) && footprintHull.length >= 3) {
      const clipped = clipSegmentToConvexPolygon(ep1, ep2, footprintHull)
      if (!clipped) return // fully outside
      ep1 = clipped[0]
      ep2 = clipped[1]
    }
    const p1 = mapper(ep1)
    const p2 = mapper(ep2)
    page.drawLine({ start: { x: p1[0], y: p1[1] }, end: { x: p2[0], y: p2[1] }, thickness: edgeThickness(t), color: edgeColor(t) })
    if (opts.showLabels && opts.labelMode === 'length') {
      const mx = (p1[0] + p2[0]) / 2
      const my = (p1[1] + p2[1]) / 2
      page.drawText(String(Math.round(num(edge.length))), { x: mx + 3, y: my + 3, size: 7, font: ctx.bold, color: edgeColor(t) })
    }
  })
}

// ---- Convex hull (Andrew's monotone chain) ----
function cross2d(o: PointTuple, a: PointTuple, b: PointTuple): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function convexHull(pts: PointTuple[]): PointTuple[] {
  const sorted = pts.filter(validTuple).map(p => [Number(p[0]), Number(p[1])] as PointTuple)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const lower: PointTuple[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross2d(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: PointTuple[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross2d(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) upper.pop()
    upper.push(sorted[i])
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

// ---- Cyrus-Beck line-segment clipping against convex polygon ----
function clipSegmentToConvexPolygon(a: PointTuple, b: PointTuple, poly: PointTuple[]): [PointTuple, PointTuple] | null {
  let tMin = 0
  let tMax = 1
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    // outward normal of edge poly[i]→poly[j]
    const ex = poly[j][0] - poly[i][0]
    const ey = poly[j][1] - poly[i][1]
    const nx = ey   // outward normal (assuming CCW winding, flip if needed)
    const ny = -ex
    const wx = a[0] - poly[i][0]
    const wy = a[1] - poly[i][1]
    const num_ = -(nx * wx + ny * wy)
    const den = nx * dx + ny * dy
    if (Math.abs(den) < 1e-10) {
      // parallel — if outside this edge, reject
      if (num_ < 0) return null
    } else {
      const t = num_ / den
      if (den < 0) { if (t > tMin) tMin = t }
      else { if (t < tMax) tMax = t }
      if (tMin > tMax) return null
    }
  }
  // Also try with flipped normals (handles CW winding)
  // Quick check: if tMin==0 && tMax==1, both points already inside — return as is
  if (tMin > tMax) return null
  return [
    [a[0] + tMin * dx, a[1] + tMin * dy],
    [a[0] + tMax * dx, a[1] + tMax * dy],
  ]
}

function drawPlaneLabel(page: any, ctx: any, pts: PointTuple[], plane: any, idx: number, mode: string) {
  const c = centroid(pts)
  const text = mode === 'pitch'
    ? `${fmt(num(plane.pitch), 1)}/12`
    : mode === 'area'
      ? `${fmt(num(plane.area), 0)} sf`
      : `P${idx + 1}`
  page.drawText(text, { x: c[0] - 12, y: c[1] - 3, size: 8, font: ctx.bold, color: rgb(0.07, 0.08, 0.1) })
}

function drawPolygon(page: any, pts: PointTuple[], fill: any, stroke: any, strokeWidth: number) {
  if (pts.length < 3) return
  const path = `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(' ') + ' Z'
  page.drawSvgPath(path, { color: fill, borderColor: stroke, borderWidth: strokeWidth, opacity: fill ? 0.35 : 1, borderOpacity: 1 })
}

function drawImageContain(page: any, img: any | null, box: Box) {
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, color: rgb(0.94, 0.95, 0.97), borderColor: rgb(0.82, 0.84, 0.88), borderWidth: 0.8 })
  if (!img) return
  const scale = Math.min(box.w / img.width, box.h / img.height)
  const w = img.width * scale
  const h = img.height * scale
  page.drawImage(img, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, width: w, height: h })
}

function rasterMapper(size: any, box: Box) {
  const rw = Number(size?.width || 1280)
  const rh = Number(size?.height || 1280)
  const scale = Math.min(box.w / rw, box.h / rh)
  const w = rw * scale
  const h = rh * scale
  const ox = box.x + (box.w - w) / 2
  const oy = box.y + (box.h - h) / 2
  return (p: PointTuple): PointTuple => [ox + Number(p[0]) * scale, oy + h - Number(p[1]) * scale]
}

function bboxMapper(points: PointTuple[], box: Box) {
  const valid = points.filter(validTuple)
  if (!valid.length) return (p: PointTuple): PointTuple => [box.x + box.w / 2, box.y + box.h / 2]
  const minX = Math.min(...valid.map((p) => p[0]))
  const maxX = Math.max(...valid.map((p) => p[0]))
  const minY = Math.min(...valid.map((p) => p[1]))
  const maxY = Math.max(...valid.map((p) => p[1]))
  const sw = Math.max(maxX - minX, 1)
  const sh = Math.max(maxY - minY, 1)
  const scale = Math.min(box.w / sw, box.h / sh)
  const w = sw * scale
  const h = sh * scale
  const ox = box.x + (box.w - w) / 2
  const oy = box.y + (box.h - h) / 2
  return (p: PointTuple): PointTuple => [ox + (Number(p[0]) - minX) * scale, oy + h - (Number(p[1]) - minY) * scale]
}

function drawStatGrid(page: any, font: any, bold: any, rows: string[][], x: number, y: number) {
  const colW = 125
  const rowH = 48
  rows.forEach(([label, value], idx) => {
    const cx = x + (idx % 4) * colW
    const cy = y + (idx < 4 ? rowH : 0)
    page.drawRectangle({ x: cx, y: cy, width: colW - 8, height: 40, borderColor: rgb(0.82, 0.84, 0.88), borderWidth: 0.8, color: rgb(0.98, 0.99, 1) })
    page.drawText(label, { x: cx + 8, y: cy + 24, size: 7, font, color: rgb(0.42, 0.46, 0.52) })
    page.drawText(value, { x: cx + 8, y: cy + 9, size: 11, font: bold, color: rgb(0.07, 0.08, 0.1) })
  })
}

function drawSummaryLine(page: any, font: any, bold: any, ctx: any, y: number) {
  const text = `Area ${fmt(num(ctx.measurement.total_area_adjusted_sqft || ctx.totals.total_area_pitch_adjusted_sqft), 0)} sq ft · Ridge ${fmt(num(ctx.measurement.total_ridge_length || ctx.totals.ridge_length_ft), 0)} LF · Hip ${fmt(num(ctx.measurement.total_hip_length || ctx.totals.hip_length_ft), 0)} LF · Valley ${fmt(num(ctx.measurement.total_valley_length || ctx.totals.valley_length_ft), 0)} LF`
  page.drawText(text, { x: 72, y, size: 10, font: bold, color: rgb(0.18, 0.2, 0.24) })
}

function drawLegend(page: any, font: any, x: number, y: number) {
  const items = [['ridge', 'Ridge'], ['hip', 'Hip'], ['valley', 'Valley'], ['eave', 'Eave/Rake']]
  items.forEach(([type, label], idx) => {
    const cx = x + idx * 120
    page.drawLine({ start: { x: cx, y: y + 4 }, end: { x: cx + 24, y: y + 4 }, thickness: 2, color: edgeColor(type) })
    page.drawText(label, { x: cx + 30, y, size: 8, font, color: rgb(0.22, 0.24, 0.28) })
  })
}

function drawFooter(page: any, font: any) {
  page.drawLine({ start: { x: MARGIN, y: 34 }, end: { x: PAGE_W - MARGIN, y: 34 }, thickness: 0.5, color: rgb(0.82, 0.84, 0.88) })
  page.drawText('Generated by PITCH CRM AI Measurement', { x: MARGIN, y: 18, size: 8, font, color: rgb(0.42, 0.46, 0.52) })
}

function drawText(page: any, font: any, text: string, x: number, y: number, size: number) {
  page.drawText(safe(text), { x, y, size, font, color: rgb(0.07, 0.08, 0.1) })
}

function drawWrappedText(page: any, font: any, text: string, x: number, y: number, size: number, maxWidth: number) {
  const words = safe(text).split(/\s+/)
  let line = ''
  let cy = y
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      page.drawText(line, { x, y: cy, size, font, color: rgb(0.25, 0.28, 0.32) })
      cy -= size + 4
      line = word
    } else {
      line = next
    }
  }
  if (line) page.drawText(line, { x, y: cy, size, font, color: rgb(0.25, 0.28, 0.32) })
}

function edgeColor(type: string) {
  switch (String(type).toLowerCase()) {
    case 'ridge': return rgb(0.84, 0.1, 0.13)
    case 'hip': return rgb(0.96, 0.45, 0.1)
    case 'valley': return rgb(0.12, 0.42, 0.78)
    case 'eave': return rgb(0.06, 0.42, 0.18)
    case 'rake': return rgb(0.06, 0.42, 0.18)
    default: return rgb(0.45, 0.48, 0.54)
  }
}

function edgeThickness(type: string) {
  return ['ridge', 'hip', 'valley'].includes(String(type).toLowerCase()) ? 1.6 : 1.1
}

function centroid(pts: PointTuple[]): PointTuple {
  if (!pts.length) return [0, 0]
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
}

function asTuplePoints(value: any): PointTuple[] {
  return Array.isArray(value) ? value.filter(validTuple).map((p: any) => [Number(p[0]), Number(p[1])]) : []
}

function asPointObjects(value: any): Array<{ x: number; y: number }> {
  if (!Array.isArray(value)) return []
  return value.map((p: any) => Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p?.x), y: Number(p?.y) })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
}

function validTuple(p: any): p is PointTuple {
  return Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))
}

function num(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function fmt(value: number, max = 1): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { maximumFractionDigits: max })
}

function safe(value: any): string {
  return String(value ?? '—').replace(/[\r\n]+/g, ' ').slice(0, 260)
}
