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
    const body = await req.json();
    const { action } = body;

    if (action === 'list-reports') {
      const { data, error } = await supabase
        .from('roof_vendor_reports')
        .select('id, address, parsed, diagram_geometry, geocoded_lat, geocoded_lng')
        .not('address', 'is', null)
        .limit(500);
      if (error) throw error;

      const real = (data || []).filter((r: any) => {
        const p = r.parsed;
        return p && typeof p === 'object' && parseFloat(p.total_area_sqft || 0) > 0;
      });

      return new Response(JSON.stringify({ count: real.length, reports: real }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'batch-geocode') {
      const MAPBOX_TOKEN = Deno.env.get('MAPBOX_ACCESS_TOKEN') || Deno.env.get('MAPBOX_PUBLIC_TOKEN');
      if (!MAPBOX_TOKEN) throw new Error('No MAPBOX_ACCESS_TOKEN or MAPBOX_PUBLIC_TOKEN');
      console.log(`Using Mapbox token starting with: ${MAPBOX_TOKEN.substring(0, 10)}...`);

      const batchSize = body.batchSize || 25;

      // Get all reports with address, no geocode, and real parsed data in one query
      const { data: reports, error } = await supabase
        .from('roof_vendor_reports')
        .select('id, address, parsed')
        .not('address', 'is', null)
        .is('geocoded_lat', null)
        .limit(300);
      if (error) throw error;

      // Filter client-side for real area
      const toGeocode = (reports || [])
        .filter((r: any) => r.parsed && parseFloat(r.parsed.total_area_sqft || 0) > 0)
        .slice(0, batchSize);

      console.log(`Geocoding ${toGeocode.length} reports (from ${(reports||[]).length} ungeo'd)`);

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
            const { error: updateErr } = await supabase
              .from('roof_vendor_reports')
              .update({ geocoded_lat: lat, geocoded_lng: lng })
              .eq('id', r.id);
            if (updateErr) {
              console.error(`Update failed for ${r.id}:`, updateErr);
            } else {
              geocoded++;
              results.push({ id: r.id, lat, lng, addr: r.address.substring(0, 50) });
            }
          } else {
            console.log(`No geocode result for: ${r.address}`);
          }
          await new Promise(res => setTimeout(res, 200));
        } catch (e) {
          console.error(`Geocode error for ${r.id}:`, e);
        }
      }

      return new Response(JSON.stringify({ total: toGeocode.length, geocoded, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'generate-batch') {
      const batchSize = body.batchSize || 10;
      const EDGE_URL = Deno.env.get('SUPABASE_URL')! + '/functions/v1/generate-training-pair';
      const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

      // Get geocoded reports
      const { data: reports, error } = await supabase
        .from('roof_vendor_reports')
        .select('id, address, parsed, diagram_geometry, geocoded_lat, geocoded_lng')
        .not('geocoded_lat', 'is', null)
        .not('geocoded_lng', 'is', null)
        .limit(300);
      if (error) throw error;

      // Filter to real data
      const ready = (reports || [])
        .filter((r: any) => r.parsed && parseFloat(r.parsed.total_area_sqft || 0) > 0)
        .slice(0, batchSize);

      console.log(`Generating training pairs for ${ready.length} reports`);

      let success = 0, failed = 0;
      const results: any[] = [];

      for (const r of ready) {
        const parsed = r.parsed;
        const lat = r.geocoded_lat;
        const lng = r.geocoded_lng;

        // Convert diagram geometry or build synthetic
        let vendorGeometry: any;
        let geoSource: string;

        if (r.diagram_geometry) {
          vendorGeometry = convertDiagramToVendorGeometry(r.diagram_geometry);
          geoSource = 'diagram';
        } else {
          vendorGeometry = buildSyntheticGeometry(parsed);
          geoSource = 'synthetic';
        }

        if (!vendorGeometry) {
          results.push({ id: r.id, status: 'skip', reason: 'no geometry' });
          continue;
        }

        // Build footprint
        const offset = 0.0003;
        const footprint = [
          [lng - offset, lat - offset],
          [lng + offset, lat - offset],
          [lng + offset, lat + offset],
          [lng - offset, lat + offset],
        ];

        const vendorTruth = {
          areaSqft: parseFloat(parsed.total_area_sqft || 0),
          facetCount: parseInt(parsed.facet_count || 0),
          predominantPitch: parsed.predominant_pitch,
          ridgeFt: parseFloat(parsed.ridges_ft || 0),
          valleyFt: parseFloat(parsed.valleys_ft || 0),
          hipFt: parseFloat(parsed.hips_ft || 0),
          eaveFt: parseFloat(parsed.eaves_ft || 0),
          rakeFt: parseFloat(parsed.rakes_ft || 0),
        };

        try {
          const resp = await fetch(EDGE_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${ANON_KEY}`,
            },
            body: JSON.stringify({
              lat,
              lng,
              address: r.address || 'Unknown',
              vendorGeometry,
              vendorTruth,
              footprintVerticesGeo: footprint,
              source: `vendor_${r.id.substring(0, 8)}_${geoSource}`,
            }),
          });

          const data = await resp.json();
          if (data.success || data.trainingPairId) {
            success++;
            results.push({ id: r.id, status: 'ok', pairId: data.trainingPairId, source: geoSource });
          } else {
            failed++;
            results.push({ id: r.id, status: 'fail', error: (data.error || '').substring(0, 100) });
          }
        } catch (e: any) {
          failed++;
          results.push({ id: r.id, status: 'error', error: e.message?.substring(0, 100) });
        }

        await new Promise(res => setTimeout(res, 1500));
      }

      return new Response(JSON.stringify({ total: ready.length, success, failed, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function convertDiagramToVendorGeometry(diagram: any, imgSize = 512) {
  if (!diagram?.vertices || !diagram?.edges) return null;
  
  const vMap: Record<string, number[]> = {};
  for (const v of diagram.vertices) {
    if (v.id) vMap[v.id] = [v.x * imgSize, v.y * imgSize];
  }
  
  const geometry: Record<string, number[][][]> = { ridge: [], valley: [], hip: [], eave: [], rake: [] };
  
  for (const edge of diagram.edges) {
    const t = (edge.type || '').toLowerCase();
    if (!(t in geometry)) continue;
    if (!vMap[edge.from] || !vMap[edge.to]) continue;
    geometry[t].push([vMap[edge.from], vMap[edge.to]]);
  }
  
  const total = Object.values(geometry).reduce((s, v) => s + v.length, 0);
  return total > 0 ? geometry : null;
}

function buildSyntheticGeometry(parsed: any, imgSize = 512) {
  const ridges = parseFloat(parsed.ridges_ft || 0);
  const valleys = parseFloat(parsed.valleys_ft || 0);
  const hips = parseFloat(parsed.hips_ft || 0);
  const eaves = parseFloat(parsed.eaves_ft || 0);
  const rakes = parseFloat(parsed.rakes_ft || 0);
  
  if (ridges + valleys + hips + eaves + rakes === 0) return null;
  
  const m = 50, w = imgSize - 2*m, h = imgSize - 2*m;
  const cx = imgSize/2, cy = imgSize/2;
  
  const geometry: Record<string, number[][][]> = { ridge: [], valley: [], hip: [], eave: [], rake: [] };
  
  const corners = [
    [m, m+h*0.3], [m+w*0.3, m], [m+w*0.7, m], [m+w, m+h*0.3],
    [m+w, m+h*0.7], [m+w*0.7, m+h], [m+w*0.3, m+h], [m, m+h*0.7],
  ];
  
  if (eaves > 0) for (let i=0; i<corners.length; i++) geometry.eave.push([corners[i], corners[(i+1)%corners.length]]);
  if (ridges > 0) geometry.ridge.push([[cx-w*0.3, cy], [cx+w*0.3, cy]]);
  if (hips > 0) {
    geometry.hip.push([corners[0], [cx-w*0.3, cy]], [corners[3], [cx+w*0.3, cy]]);
    geometry.hip.push([corners[4], [cx+w*0.3, cy]], [corners[7], [cx-w*0.3, cy]]);
  }
  if (valleys > 0) {
    geometry.valley.push([[cx, m+h*0.15], [cx, cy-h*0.1]]);
    geometry.valley.push([[cx, m+h*0.85], [cx, cy+h*0.1]]);
  }
  if (rakes > 0) {
    geometry.rake.push([[m, m+h*0.3], [m, m+h*0.7]]);
    geometry.rake.push([[m+w, m+h*0.3], [m+w, m+h*0.7]]);
  }
  
  return geometry;
}
