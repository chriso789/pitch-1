import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAPBOX_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN') || Deno.env.get('MAPBOX_ACCESS_TOKEN');

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address&limit=1`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    return d?.features?.[0]?.place_name ?? null;
  } catch (e) {
    console.error('reverseGeocode error', e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { tenantId } = await req.json().catch(() => ({}));

    if (!MAPBOX_TOKEN) {
      return new Response(JSON.stringify({ error: 'MAPBOX_PUBLIC_TOKEN not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find sessions missing property_address
    let q = supabase
      .from('roof_training_sessions')
      .select('id, tenant_id, vendor_report_id, ai_measurement_id, property_address, lat, lng')
      .or('property_address.is.null,property_address.eq.');
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data: sessions, error: sErr } = await q;
    if (sErr) throw sErr;

    let backfilled = 0;
    let failed = 0;
    const details: any[] = [];

    for (const s of sessions || []) {
      let lat: number | null = s.lat ? Number(s.lat) : null;
      let lng: number | null = s.lng ? Number(s.lng) : null;
      let address: string | null = null;

      // Try linked vendor report first
      if (s.vendor_report_id) {
        const { data: vr } = await supabase
          .from('roof_vendor_reports')
          .select('address, parsed, geocoded_lat, geocoded_lng')
          .eq('id', s.vendor_report_id)
          .maybeSingle();
        if (vr) {
          address = vr.address || (vr.parsed as any)?.address || (vr.parsed as any)?.property_address || null;
          if (!lat) lat = vr.geocoded_lat ? Number(vr.geocoded_lat) : (vr.parsed as any)?.latitude ?? null;
          if (!lng) lng = vr.geocoded_lng ? Number(vr.geocoded_lng) : (vr.parsed as any)?.longitude ?? null;
        }
      }

      // Try linked ai_measurement
      if (!address && s.ai_measurement_id) {
        const { data: m } = await supabase
          .from('roof_measurements')
          .select('property_address, target_lat, target_lng')
          .eq('id', s.ai_measurement_id)
          .maybeSingle();
        if (m) {
          address = m.property_address || null;
          if (!lat) lat = m.target_lat;
          if (!lng) lng = m.target_lng;
        }
      }

      // Reverse geocode if still missing
      if (!address && lat && lng) {
        address = await reverseGeocode(lat, lng);
      }

      if (address) {
        const updates: Record<string, any> = { property_address: address };
        if (lat && !s.lat) updates.lat = lat;
        if (lng && !s.lng) updates.lng = lng;
        const { error: uErr } = await supabase
          .from('roof_training_sessions')
          .update(updates)
          .eq('id', s.id);
        if (uErr) { failed++; details.push({ id: s.id, error: uErr.message }); }
        else {
          backfilled++;
          // also patch the vendor report
          if (s.vendor_report_id) {
            await supabase
              .from('roof_vendor_reports')
              .update({ address, geocoded_lat: lat, geocoded_lng: lng })
              .eq('id', s.vendor_report_id)
              .is('address', null);
          }
        }
      } else {
        failed++;
        details.push({ id: s.id, reason: 'no_coordinates_or_geocode_failed' });
      }
    }

    return new Response(JSON.stringify({
      success: true, scanned: sessions?.length || 0, backfilled, failed, details,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('backfill-verification-addresses error', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
