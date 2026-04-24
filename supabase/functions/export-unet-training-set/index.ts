// Export U-Net training dataset from confirmed verification sessions.
// Builds JSONL records that match roof-training/classes.json schema and
// uploads to the private `unet-training-data` storage bucket. Returns a
// signed download URL for the master/owner who triggered the export.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ ok: false, error: 'Missing bearer token' }, 401);
    }

    // Caller-scoped client to identify the requester
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Authorize: master or owner only
    const { data: roles } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);
    const isPrivileged = (roles ?? []).some(
      (r: any) => r.role === 'master' || r.role === 'owner',
    );
    if (!isPrivileged) {
      return json({ ok: false, error: 'Forbidden — master/owner only' }, 403);
    }

    // Resolve tenant
    const { data: profile } = await admin
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();
    const tenantId = profile?.tenant_id;
    if (!tenantId) return json({ ok: false, error: 'No tenant on profile' }, 400);

    // Pull confirmed + denied sessions. Denied sessions are included ONLY when
    // we have human-corrected geometry in ai_feedback_sessions (highest-value
    // training signals because the AI was wrong and a human fixed it).
    const { data: sessions, error: sessErr } = await admin
      .from('roof_training_sessions')
      .select(
        'id, property_address, lat, lng, traced_totals, ai_totals, vendor_report_id, ai_measurement_id, verification_verdict',
      )
      .eq('tenant_id', tenantId)
      .eq('ground_truth_source', 'vendor_report')
      .in('verification_verdict', ['confirmed', 'denied']);

    if (sessErr) {
      console.error('Sessions query error:', sessErr);
      return json({ ok: false, error: sessErr.message }, 500);
    }

    const deniedIds = (sessions ?? [])
      .filter((s: any) => s.verification_verdict === 'denied' && s.ai_measurement_id)
      .map((s: any) => s.ai_measurement_id);
    const correctionsByMeasId: Record<string, any> = {};
    if (deniedIds.length > 0) {
      const { data: feedback } = await admin
        .from('ai_feedback_sessions')
        .select('measurement_id, corrected_geometry, original_geometry, corrections_made')
        .in('measurement_id', deniedIds)
        .not('corrected_geometry', 'is', null);
      for (const f of feedback ?? []) {
        if (f.measurement_id) correctionsByMeasId[f.measurement_id] = f;
      }
    }

    const eligible = (sessions ?? []).filter((s: any) => {
      if (s.verification_verdict === 'confirmed') return s.ai_measurement_id || s.vendor_report_id;
      return s.ai_measurement_id && correctionsByMeasId[s.ai_measurement_id];
    });

    if (eligible.length === 0) {
      return json({ ok: false, error: 'No confirmed sessions or denied corrections to export' }, 400);
    }

    // Pull linked roof_measurements for AI geometry + satellite imagery
    const measIds = eligible
      .map((s: any) => s.ai_measurement_id)
      .filter(Boolean);
    let measurementMap: Record<string, any> = {};
    if (measIds.length > 0) {
      const { data: measRows } = await admin
        .from('roof_measurements')
        .select(
          'id, satellite_image_url, perimeter_wkt, linear_features_wkt, total_area_adjusted_sqft, predominant_pitch',
        )
        .in('id', measIds);
      for (const m of measRows ?? []) measurementMap[m.id] = m;
    }

    // Pull vendor report ground truth
    const reportIds = eligible
      .map((s: any) => s.vendor_report_id)
      .filter(Boolean);
    let reportMap: Record<string, any> = {};
    if (reportIds.length > 0) {
      const { data: reportRows } = await admin
        .from('vendor_reports')
        .select(
          'id, perimeter_wkt, linear_features_wkt, total_area_sqft, predominant_pitch, diagram_image_url',
        )
        .in('id', reportIds);
      for (const r of reportRows ?? []) reportMap[r.id] = r;
    }

    // Build JSONL records
    const lines: string[] = [];
    let included = 0;
    for (const s of eligible) {
      const meas = s.ai_measurement_id
        ? measurementMap[s.ai_measurement_id]
        : null;
      const vendor = s.vendor_report_id ? reportMap[s.vendor_report_id] : null;
      const traced = (s.traced_totals ?? {}) as Record<string, number>;

      const correction = meas ? correctionsByMeasId[meas.id] : null;

      // Need at least imagery + ground truth perimeter to be useful
      const imageUrl = meas?.satellite_image_url ?? vendor?.diagram_image_url ?? null;
      const groundTruthPerimeter =
        correction?.corrected_geometry?.perimeter_wkt ?? vendor?.perimeter_wkt ?? null;
      if (!imageUrl || !groundTruthPerimeter) continue;

      const record = {
        session_id: s.id,
        address: s.property_address,
        location: { lat: s.lat, lng: s.lng },
        verdict: s.verification_verdict,
        signal_type: correction ? 'human_correction' : 'vendor_match',
        image_url: imageUrl,
        ground_truth: {
          source: correction ? 'human_correction' : 'vendor_report',
          vendor_report_id: s.vendor_report_id,
          perimeter_wkt: groundTruthPerimeter,
          linear_features_wkt:
            correction?.corrected_geometry?.linear_features_wkt ??
            vendor?.linear_features_wkt ??
            null,
          corrections_made: correction?.corrections_made ?? null,
        },
        ai_prediction: meas
          ? {
              measurement_id: meas.id,
              perimeter_wkt: meas.perimeter_wkt,
              linear_features_wkt: meas.linear_features_wkt,
            }
          : null,
        regression_targets: {
          total_area_sqft:
            vendor?.total_area_sqft ?? meas?.total_area_adjusted_sqft ?? null,
          predominant_pitch:
            vendor?.predominant_pitch ?? meas?.predominant_pitch ?? null,
          ridge_ft: traced.ridge ?? null,
          hip_ft: traced.hip ?? null,
          valley_ft: traced.valley ?? null,
          eave_ft: traced.eave ?? null,
          rake_ft: traced.rake ?? null,
        },
      };
      lines.push(JSON.stringify(record));
      included += 1;
    }

    if (included === 0) {
      return json(
        {
          ok: false,
          error:
            'No eligible sessions had both imagery and ground-truth (vendor or human-correction) geometry available',
        },
        400,
      );
    }

    // Upload to storage as JSONL
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${tenantId}/dataset_${ts}_n${included}.jsonl`;
    const body = lines.join('\n');

    const { error: uploadErr } = await admin.storage
      .from('unet-training-data')
      .upload(path, new Blob([body], { type: 'application/x-ndjson' }), {
        contentType: 'application/x-ndjson',
        upsert: true,
      });

    if (uploadErr) {
      console.error('Upload error:', uploadErr);
      return json({ ok: false, error: uploadErr.message }, 500);
    }

    // Signed URL valid for 24h
    const { data: signed, error: signErr } = await admin.storage
      .from('unet-training-data')
      .createSignedUrl(path, 60 * 60 * 24);

    if (signErr) {
      console.error('Signed URL error:', signErr);
      return json({ ok: false, error: signErr.message }, 500);
    }

    return json({
      ok: true,
      data: {
        eligible_sessions: eligible.length,
        included_records: included,
        skipped: eligible.length - included,
        storage_path: path,
        signed_url: signed?.signedUrl,
      },
    });
  } catch (e: any) {
    console.error('export-unet-training-set fatal:', e);
    return json({ ok: false, error: String((e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e)) ?? e) }, 500);
  }
});
