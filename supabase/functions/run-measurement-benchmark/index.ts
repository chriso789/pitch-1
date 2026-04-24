import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VendorReport {
  id: string;
  address: string;
  geocoded_lat: number;
  geocoded_lng: number;
  parsed: {
    total_area_sqft?: number;
    predominant_pitch?: string;
    ridges_ft?: number;
    hips_ft?: number;
    valleys_ft?: number;
    eaves_ft?: number;
    rakes_ft?: number;
    facet_count?: number;
    pitches?: Array<{ pitch: string; area_sqft: number }>;
  };
  provider: string;
}

interface ComparisonResult {
  vendorReportId: string;
  address: string;
  provider: string;
  vendorArea: number;
  aiArea: number;
  areaErrorPct: number;
  vendorRidge: number;
  aiRidge: number;
  ridgeErrorPct: number;
  vendorHip: number;
  aiHip: number;
  hipErrorPct: number;
  vendorValley: number;
  aiValley: number;
  valleyErrorPct: number;
  vendorPitch: string;
  aiPitch: string;
  pitchMatch: boolean;
  overallAccuracyPct: number;
  processingTimeMs: number;
  error?: string;
}

function pctError(vendor: number, ai: number): number {
  if (vendor === 0 && ai === 0) return 0;
  if (vendor === 0) return 100;
  return Math.abs((ai - vendor) / vendor) * 100;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json().catch(() => ({}));
    const { limit = 20, provider_filter, min_area } = body;
    const startTime = Date.now();

    // Fetch vendor reports with parsed data and geocoded coordinates
    let query = supabase
      .from('roof_vendor_reports')
      .select('id, address, geocoded_lat, geocoded_lng, parsed, provider')
      .not('parsed', 'is', null)
      .not('geocoded_lat', 'is', null)
      .not('geocoded_lng', 'is', null)
      .limit(limit);

    if (provider_filter) {
      query = query.eq('provider', provider_filter);
    }

    const { data: vendorReports, error: vError } = await query;
    if (vError) throw vError;

    const reports = (vendorReports || []) as VendorReport[];
    
    // Filter to reports that have total_area_sqft in parsed
    const validReports = reports.filter(r => {
      const area = r.parsed?.total_area_sqft;
      return area && area > 0 && (!min_area || area >= min_area);
    });

    console.log(`🏠 Benchmarking ${validReports.length} vendor reports (of ${reports.length} fetched)`);

    const results: ComparisonResult[] = [];

    for (const report of validReports) {
      const caseStart = Date.now();
      
      try {
        // Call measure edge function for this property
        const { data: measData, error: measError } = await supabase.functions.invoke('measure', {
          body: {
            action: 'pull',
            propertyId: `benchmark-${report.id}`,
            lat: report.geocoded_lat,
            lng: report.geocoded_lng,
            engine: 'skeleton'
          }
        });

        if (measError || !measData?.ok) {
          results.push({
            vendorReportId: report.id,
            address: report.address || '',
            provider: report.provider || '',
            vendorArea: report.parsed.total_area_sqft || 0,
            aiArea: 0, areaErrorPct: 100,
            vendorRidge: report.parsed.ridges_ft || 0,
            aiRidge: 0, ridgeErrorPct: 100,
            vendorHip: report.parsed.hips_ft || 0,
            aiHip: 0, hipErrorPct: 100,
            vendorValley: report.parsed.valleys_ft || 0,
            aiValley: 0, valleyErrorPct: 100,
            vendorPitch: report.parsed.predominant_pitch || '',
            aiPitch: '', pitchMatch: false,
            overallAccuracyPct: 0,
            processingTimeMs: Date.now() - caseStart,
            error: measError?.message || measData?.error || 'Measure failed'
          });
          continue;
        }

        const measurement = measData.data?.measurement;
        const summary = measurement?.summary || measurement?.measurement_data?.summary || {};

        const aiArea = summary.total_area_sqft || 0;
        const aiRidge = summary.ridge_ft || 0;
        const aiHip = summary.hip_ft || 0;
        const aiValley = summary.valley_ft || 0;
        const aiPitch = summary.pitch || summary.pitch_method || '';

        const vendorArea = report.parsed.total_area_sqft || 0;
        const vendorRidge = report.parsed.ridges_ft || 0;
        const vendorHip = report.parsed.hips_ft || 0;
        const vendorValley = report.parsed.valleys_ft || 0;
        const vendorPitch = report.parsed.predominant_pitch || '';

        const areaErr = pctError(vendorArea, aiArea);
        const ridgeErr = pctError(vendorRidge, aiRidge);
        const hipErr = pctError(vendorHip, aiHip);
        const valleyErr = pctError(vendorValley, aiValley);

        // Weighted overall: area 40%, ridge 20%, hip 20%, valley 20%
        const overallError = (areaErr * 0.4) + (ridgeErr * 0.2) + (hipErr * 0.2) + (valleyErr * 0.2);
        const overallAccuracy = Math.max(0, 100 - overallError);

        results.push({
          vendorReportId: report.id,
          address: report.address || '',
          provider: report.provider || '',
          vendorArea, aiArea, areaErrorPct: areaErr,
          vendorRidge, aiRidge, ridgeErrorPct: ridgeErr,
          vendorHip, aiHip, hipErrorPct: hipErr,
          vendorValley, aiValley, valleyErrorPct: valleyErr,
          vendorPitch, aiPitch, pitchMatch: vendorPitch === aiPitch,
          overallAccuracyPct: overallAccuracy,
          processingTimeMs: Date.now() - caseStart,
        });

        console.log(`  ✅ ${report.address}: area=${areaErr.toFixed(1)}% err, overall=${overallAccuracy.toFixed(1)}%`);

      } catch (err: any) {
        results.push({
          vendorReportId: report.id,
          address: report.address || '',
          provider: report.provider || '',
          vendorArea: report.parsed.total_area_sqft || 0,
          aiArea: 0, areaErrorPct: 100,
          vendorRidge: 0, aiRidge: 0, ridgeErrorPct: 100,
          vendorHip: 0, aiHip: 0, hipErrorPct: 100,
          vendorValley: 0, aiValley: 0, valleyErrorPct: 100,
          vendorPitch: '', aiPitch: '', pitchMatch: false,
          overallAccuracyPct: 0,
          processingTimeMs: Date.now() - caseStart,
          error: (err instanceof Error ? err.message : String(err))
        });
      }
    }

    // Summary stats
    const successful = results.filter(r => !r.error);
    const avgAreaError = successful.length > 0 ? successful.reduce((s, r) => s + r.areaErrorPct, 0) / successful.length : 0;
    const avgOverall = successful.length > 0 ? successful.reduce((s, r) => s + r.overallAccuracyPct, 0) / successful.length : 0;
    const passed = successful.filter(r => r.overallAccuracyPct >= 95);
    const areaWithin2Pct = successful.filter(r => r.areaErrorPct <= 2);
    const areaWithin5Pct = successful.filter(r => r.areaErrorPct <= 5);

    // Worst cases for investigation
    const worst5 = [...successful].sort((a, b) => a.overallAccuracyPct - b.overallAccuracyPct).slice(0, 5);

    const summary = {
      totalReports: validReports.length,
      successfulComparisons: successful.length,
      errors: results.length - successful.length,
      avgAreaErrorPct: avgAreaError.toFixed(2),
      avgOverallAccuracyPct: avgOverall.toFixed(2),
      passed95Pct: passed.length,
      areaWithin2Pct: areaWithin2Pct.length,
      areaWithin5Pct: areaWithin5Pct.length,
      pitchMatchRate: successful.length > 0 
        ? (successful.filter(r => r.pitchMatch).length / successful.length * 100).toFixed(1) + '%'
        : '0%',
      durationMs: Date.now() - startTime,
      worst5: worst5.map(r => ({
        address: r.address,
        areaError: r.areaErrorPct.toFixed(1) + '%',
        overall: r.overallAccuracyPct.toFixed(1) + '%'
      }))
    };

    console.log(`\n📊 BENCHMARK SUMMARY:`);
    console.log(`   Avg area error: ${summary.avgAreaErrorPct}%`);
    console.log(`   Avg overall accuracy: ${summary.avgOverallAccuracyPct}%`);
    console.log(`   Passed (≥95%): ${passed.length}/${successful.length}`);
    console.log(`   Area within ±2%: ${areaWithin2Pct.length}/${successful.length}`);

    return new Response(JSON.stringify({
      success: true,
      summary,
      results
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Benchmark error:', error);
    return new Response(JSON.stringify({ error: (error instanceof Error ? error.message : String(error)) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
