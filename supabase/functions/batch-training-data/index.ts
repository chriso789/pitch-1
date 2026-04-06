import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { action } = await req.json();

    if (action === 'list-reports') {
      // Return all vendor reports with real measurement data
      const { data, error } = await supabase
        .from('roof_vendor_reports')
        .select('id, address, parsed, diagram_geometry, geocoded_lat, geocoded_lng')
        .not('address', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      // Filter to those with real area data
      const real = (data || []).filter((r: any) => {
        const p = r.parsed;
        if (!p || typeof p !== 'object') return false;
        const area = parseFloat(p.total_area_sqft || 0);
        return area > 0;
      });

      return new Response(JSON.stringify({ count: real.length, reports: real }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'update-geocode') {
      const { id, lat, lng } = await req.json();
      const { error } = await supabase
        .from('roof_vendor_reports')
        .update({ geocoded_lat: lat, geocoded_lng: lng })
        .eq('id', id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'batch-geocode') {
      const MAPBOX_TOKEN = Deno.env.get('MAPBOX_PUBLIC_TOKEN');
      if (!MAPBOX_TOKEN) throw new Error('No MAPBOX_PUBLIC_TOKEN');

      // Get un-geocoded reports
      const { data: reports, error } = await supabase
        .from('roof_vendor_reports')
        .select('id, address')
        .not('address', 'is', null)
        .is('geocoded_lat', null)
        .limit(200);

      if (error) throw error;

      // Filter to those with real parsed data
      const { data: allReports } = await supabase
        .from('roof_vendor_reports')
        .select('id, parsed')
        .in('id', (reports || []).map((r: any) => r.id));

      const withArea = new Set(
        (allReports || [])
          .filter((r: any) => r.parsed && parseFloat(r.parsed.total_area_sqft || 0) > 0)
          .map((r: any) => r.id)
      );

      const toGeocode = (reports || []).filter((r: any) => withArea.has(r.id));
      let geocoded = 0;
      const results: any[] = [];

      for (const r of toGeocode) {
        try {
          const encoded = encodeURIComponent(r.address);
          const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&limit=1&country=US`;
          const resp = await fetch(url);
          const data = await resp.json();
          const features = data.features || [];

          if (features.length > 0) {
            const [lng, lat] = features[0].center;
            await supabase
              .from('roof_vendor_reports')
              .update({ geocoded_lat: lat, geocoded_lng: lng })
              .eq('id', r.id);
            geocoded++;
            results.push({ id: r.id, lat, lng, address: r.address.substring(0, 50) });
          }

          // Rate limit
          await new Promise(res => setTimeout(res, 300));
        } catch (e) {
          console.error(`Geocode error for ${r.id}:`, e);
        }
      }

      return new Response(JSON.stringify({ 
        total: toGeocode.length, 
        geocoded, 
        results: results.slice(0, 20) 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
