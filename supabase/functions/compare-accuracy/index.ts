import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// Compute accuracy between AI area (from tags) and a reference area
function computeAccuracy(aiArea: number, refArea: number) {
  if (!refArea || refArea <= 0) return null
  const variancePct = ((aiArea - refArea) / refArea) * 100
  const accuracy = Math.max(0, 100 - Math.abs(variancePct))
  return { variancePct, accuracy }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const body = await req.json().catch(() => ({}))

    // ───────────── BATCH MODE ─────────────
    // POST { mode: 'batch', tenantId } → run comparison on every confirmed
    // verification session that has both AI + vendor data, return aggregate
    // AI-vs-Vendor accuracy score.
    if (body?.mode === 'batch') {
      const tenantId = body.tenantId
      if (!tenantId) return json({ success: false, error: 'tenantId required' }, 400)

      const { data: sessions, error: sErr } = await supabase
        .from('roof_training_sessions')
        .select('id, ai_measurement_id, vendor_report_id, ai_totals, traced_totals, verification_score, property_address')
        .eq('tenant_id', tenantId)
        .eq('ground_truth_source', 'vendor_report')
        .eq('verification_verdict', 'confirmed')
        .not('ai_measurement_id', 'is', null)
        .not('vendor_report_id', 'is', null)

      if (sErr) return json({ success: false, error: sErr.message }, 500)

      const eligible = sessions || []
      if (eligible.length === 0) {
        return json({ success: true, processed: 0, averageAccuracy: null, comparisons: [] })
      }

      // Pull AI measurement areas in one query
      const aiIds = eligible.map(s => s.ai_measurement_id).filter(Boolean) as string[]
      const { data: aiMeas } = await supabase
        .from('roof_measurements')
        .select('id, total_area_adjusted_sqft, total_area_flat_sqft, tags')
        .in('id', aiIds)
      const aiMap = new Map((aiMeas || []).map(m => [m.id, m]))

      // Pull vendor areas
      const vrIds = eligible.map(s => s.vendor_report_id).filter(Boolean) as string[]
      const { data: vendors } = await supabase
        .from('roof_vendor_reports')
        .select('id, total_area_sqft, parsed')
        .in('id', vrIds)
      const vendorMap = new Map((vendors || []).map(v => [v.id, v]))

      const comparisons: any[] = []
      let totalAcc = 0
      let counted = 0

      for (const s of eligible) {
        const ai = s.ai_measurement_id ? aiMap.get(s.ai_measurement_id) : null
        const vr = s.vendor_report_id ? vendorMap.get(s.vendor_report_id) : null
        if (!ai || !vr) continue

        const aiArea = Number(
          ai.total_area_adjusted_sqft ||
          ai.total_area_flat_sqft ||
          (ai.tags as any)?.['roof.area'] ||
          0
        )
        const vendorArea = Number(vr.total_area_sqft || (vr.parsed as any)?.total_area_sqft || 0)
        const acc = computeAccuracy(aiArea, vendorArea)
        if (!acc) continue

        // Persist per-row accuracy
        await supabase.from('roof_measurements').update({
          manual_reference_area_sqft: vendorArea,
          accuracy_vs_manual_percent: acc.accuracy,
          accuracy_compared_at: new Date().toISOString(),
        }).eq('id', ai.id)

        comparisons.push({
          sessionId: s.id,
          address: s.property_address,
          aiArea,
          vendorArea,
          accuracyPercent: acc.accuracy,
          variancePercent: acc.variancePct,
        })
        totalAcc += acc.accuracy
        counted++
      }

      const averageAccuracy = counted > 0 ? totalAcc / counted : null
      return json({
        success: true,
        processed: counted,
        eligibleCount: eligible.length,
        averageAccuracy,
        comparisons,
      })
    }

    // ───────────── SINGLE MODE (legacy) ─────────────
    const { measurementId, manualAreaSqft } = body
    const { data: m, error } = await supabase
      .from('roof_measurements')
      .select('*')
      .eq('id', measurementId)
      .single()

    if (error || !m) return json({ success: false, error: 'Not found' }, 404)

    const aiArea = (m.tags as any)?.['roof.area'] || m.total_area_adjusted_sqft || 0
    const accuracy = manualAreaSqft ? ((aiArea - manualAreaSqft) / manualAreaSqft) * 100 : null

    await supabase.from('roof_measurements').update({
      manual_reference_area_sqft: manualAreaSqft,
      accuracy_vs_manual_percent: accuracy != null ? Math.max(0, 100 - Math.abs(accuracy)) : null,
      accuracy_compared_at: new Date().toISOString(),
    }).eq('id', measurementId)

    return json({
      success: true,
      data: { aiArea, manualArea: manualAreaSqft, accuracyPercent: accuracy },
    })
  } catch (e) {
    return json({ success: false, error: String(e) }, 500)
  }
})
