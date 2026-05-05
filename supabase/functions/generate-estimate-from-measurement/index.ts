import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

interface MeasurementInput {
  total_area_sqft: number;
  total_squares: number;
  eaves_ft: number;
  rakes_ft: number;
  valleys_ft: number;
  hips_ft: number;
  ridges_ft: number;
  step_flashing_ft: number;
  pitch: number; // rise per 12
  facet_count: number;
  starter_ft?: number;
  pipe_boot_count?: number;
  stories?: number;
}

interface GeneratedLineItem {
  trade: string;
  xactimate_code: string;
  description: string;
  quantity: number;
  unit: string;
  waste_percent: number;
  source: string;
  ai_reason: string;
  sort_order: number;
}

// Deterministic scope engine - NO AI guessing quantities
function buildScopeFromMeasurements(m: MeasurementInput): {
  line_items: GeneratedLineItem[];
  waste_factor: number;
  complexity_score: string;
} {
  const items: GeneratedLineItem[] = [];
  let order = 0;

  // --- Complexity & Waste Engine ---
  const { waste, complexity } = calculateComplexity(m);

  // === TEAR-OFF ===
  items.push({
    trade: 'roofing', xactimate_code: 'RFG TEAR',
    description: 'Remove roofing - comp. shingle',
    quantity: round2(m.total_squares), unit: 'SQ',
    waste_percent: 0, source: 'measurement',
    ai_reason: `${m.total_area_sqft} sqft = ${m.total_squares} SQ from measurement`,
    sort_order: order++,
  });

  // === UNDERLAYMENT ===
  items.push({
    trade: 'roofing', xactimate_code: 'RFG SYNTH',
    description: 'Synthetic underlayment',
    quantity: round2(m.total_squares), unit: 'SQ',
    waste_percent: waste, source: 'measurement',
    ai_reason: `Full deck coverage, ${waste}% waste for ${complexity} complexity`,
    sort_order: order++,
  });

  // === ICE & WATER SHIELD ===
  // Eaves (first 3 ft from edge) + valleys
  const iceWaterEaves = m.eaves_ft * 3; // 3 ft width along eaves
  const iceWaterValleys = m.valleys_ft * 3; // 3 ft width along valleys
  const iceWaterSF = iceWaterEaves + iceWaterValleys;
  if (iceWaterSF > 0) {
    items.push({
      trade: 'roofing', xactimate_code: 'RFG ICE',
      description: 'Ice & water shield membrane',
      quantity: round2(iceWaterSF), unit: 'SF',
      waste_percent: 5, source: 'measurement',
      ai_reason: `Eaves (${m.eaves_ft}ft × 3ft) + valleys (${m.valleys_ft}ft × 3ft)`,
      sort_order: order++,
    });
  }

  // === SHINGLES ===
  items.push({
    trade: 'roofing', xactimate_code: 'RFG ARCH',
    description: 'Architectural/dimensional shingle',
    quantity: round2(m.total_squares), unit: 'SQ',
    waste_percent: waste, source: 'measurement',
    ai_reason: `${m.total_squares} SQ with ${waste}% waste (${complexity} complexity: ${m.facet_count} facets, ${m.valleys_ft}ft valleys)`,
    sort_order: order++,
  });

  // === STARTER STRIP ===
  const starterLength = m.starter_ft || (m.eaves_ft + m.rakes_ft);
  if (starterLength > 0) {
    items.push({
      trade: 'roofing', xactimate_code: 'RFG STRTR',
      description: 'Starter strip',
      quantity: round2(starterLength), unit: 'LF',
      waste_percent: 5, source: 'measurement',
      ai_reason: m.starter_ft
        ? `From measurement: ${m.starter_ft} LF`
        : `Eaves (${m.eaves_ft}) + rakes (${m.rakes_ft}) = ${starterLength} LF`,
      sort_order: order++,
    });
  }

  // === DRIP EDGE ===
  const dripEdge = m.eaves_ft + m.rakes_ft;
  if (dripEdge > 0) {
    items.push({
      trade: 'roofing', xactimate_code: 'RFG DRIP',
      description: 'Drip edge - aluminum',
      quantity: round2(dripEdge), unit: 'LF',
      waste_percent: 5, source: 'measurement',
      ai_reason: `Eaves (${m.eaves_ft}) + rakes (${m.rakes_ft})`,
      sort_order: order++,
    });
  }

  // === RIDGE CAP ===
  const ridgeHipTotal = m.ridges_ft + m.hips_ft;
  if (ridgeHipTotal > 0) {
    items.push({
      trade: 'roofing', xactimate_code: 'RFG RIDGE',
      description: 'Ridge cap shingles',
      quantity: round2(ridgeHipTotal), unit: 'LF',
      waste_percent: 5, source: 'measurement',
      ai_reason: `Ridges (${m.ridges_ft}) + hips (${m.hips_ft}) = ${ridgeHipTotal} LF`,
      sort_order: order++,
    });
  }

  // === RIDGE VENT ===
  if (m.ridges_ft > 0) {
    items.push({
      trade: 'roofing', xactimate_code: 'RFG VENT',
      description: 'Ridge vent',
      quantity: round2(m.ridges_ft), unit: 'LF',
      waste_percent: 0, source: 'measurement',
      ai_reason: `Ridge length: ${m.ridges_ft} LF`,
      sort_order: order++,
    });
  }

  // === VALLEY METAL ===
  if (m.valleys_ft > 0) {
    items.push({
      trade: 'roofing', xactimate_code: 'RFG VALLEY',
      description: 'Valley metal',
      quantity: round2(m.valleys_ft), unit: 'LF',
      waste_percent: 5, source: 'measurement',
      ai_reason: `Valley length from measurement: ${m.valleys_ft} LF`,
      sort_order: order++,
    });
  }

  // === STEP FLASHING ===
  if (m.step_flashing_ft > 0) {
    items.push({
      trade: 'roofing', xactimate_code: 'RFG FLASH',
      description: 'Step flashing - aluminum',
      quantity: round2(m.step_flashing_ft), unit: 'LF',
      waste_percent: 5, source: 'measurement',
      ai_reason: `Step flashing from measurement: ${m.step_flashing_ft} LF`,
      sort_order: order++,
    });
  }

  // === PIPE BOOTS ===
  const pipeBoots = m.pipe_boot_count ?? estimatePipeBoots(m.total_area_sqft);
  if (pipeBoots > 0) {
    items.push({
      trade: 'roofing', xactimate_code: 'RFG PIPE',
      description: 'Pipe boot/jack',
      quantity: pipeBoots, unit: 'EA',
      waste_percent: 0, source: m.pipe_boot_count != null ? 'measurement' : 'ai_suggested',
      ai_reason: m.pipe_boot_count != null
        ? `From measurement: ${pipeBoots} pipe boots`
        : `Estimated ${pipeBoots} pipe boots for ${m.total_area_sqft} sqft (industry avg ~1 per 500 sqft, min 2)`,
      sort_order: order++,
    });
  }

  // === STEEP CHARGE ===
  if (m.pitch >= 7 && m.pitch < 10) {
    items.push({
      trade: 'roofing', xactimate_code: 'GEN STEEP',
      description: 'Steep charge (7/12-9/12)',
      quantity: round2(m.total_squares), unit: 'SQ',
      waste_percent: 0, source: 'measurement',
      ai_reason: `Pitch ${m.pitch}/12 qualifies for steep charge`,
      sort_order: order++,
    });
  } else if (m.pitch >= 10) {
    items.push({
      trade: 'roofing', xactimate_code: 'GEN STEEPH',
      description: 'Steep charge (10/12+)',
      quantity: round2(m.total_squares), unit: 'SQ',
      waste_percent: 0, source: 'measurement',
      ai_reason: `Pitch ${m.pitch}/12 qualifies for extreme steep charge`,
      sort_order: order++,
    });
  }

  // === HIGH CHARGE ===
  if ((m.stories ?? 1) >= 2) {
    items.push({
      trade: 'roofing', xactimate_code: 'GEN HIGH',
      description: 'High charge (2+ stories)',
      quantity: round2(m.total_squares), unit: 'SQ',
      waste_percent: 0, source: 'measurement',
      ai_reason: `${m.stories}-story structure`,
      sort_order: order++,
    });
  }

  // === STANDARD ADDS ===
  items.push({
    trade: 'roofing', xactimate_code: 'GEN DUMP',
    description: 'Dumpster / haul-off',
    quantity: Math.max(1, Math.ceil(m.total_squares / 25)),
    unit: 'EA',
    waste_percent: 0, source: 'ai_suggested',
    ai_reason: `~1 dumpster per 25 SQ, ${m.total_squares} SQ → ${Math.max(1, Math.ceil(m.total_squares / 25))}`,
    sort_order: order++,
  });

  items.push({
    trade: 'roofing', xactimate_code: 'GEN PERMIT',
    description: 'Building permit',
    quantity: 1, unit: 'EA',
    waste_percent: 0, source: 'ai_suggested',
    ai_reason: 'Standard permit requirement',
    sort_order: order++,
  });

  return { line_items: items, waste_factor: waste / 100, complexity_score: complexity };
}

function calculateComplexity(m: MeasurementInput): { waste: number; complexity: string } {
  let score = 0;

  // Facet complexity
  if (m.facet_count <= 4) score += 0;
  else if (m.facet_count <= 8) score += 1;
  else if (m.facet_count <= 14) score += 2;
  else score += 3;

  // Valley complexity
  if (m.valleys_ft > 100) score += 2;
  else if (m.valleys_ft > 40) score += 1;

  // Pitch complexity
  if (m.pitch >= 10) score += 2;
  else if (m.pitch >= 7) score += 1;

  // Hip complexity
  if (m.hips_ft > 150) score += 1;

  let complexity: string;
  let waste: number;

  if (score <= 1) { complexity = 'simple'; waste = 10; }
  else if (score <= 3) { complexity = 'moderate'; waste = 13; }
  else if (score <= 5) { complexity = 'medium-high'; waste = 15; }
  else { complexity = 'complex'; waste = 18; }

  return { waste, complexity };
}

function estimatePipeBoots(totalAreaSqft: number): number {
  return Math.max(2, Math.round(totalAreaSqft / 500));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      // Direct measurement input
      measurements,
      // OR: pull from database
      pipeline_entry_id,
      measurement_id,
      // Target scope project
      scope_project_id,
    } = body;

    let input: MeasurementInput;

    if (measurements) {
      // Direct input
      input = {
        total_area_sqft: measurements.total_area_sqft || measurements.roof_area || 0,
        total_squares: measurements.total_squares || (measurements.total_area_sqft || measurements.roof_area || 0) / 100,
        eaves_ft: measurements.eaves_ft || measurements.eaves || 0,
        rakes_ft: measurements.rakes_ft || measurements.rakes || 0,
        valleys_ft: measurements.valleys_ft || measurements.valleys || 0,
        hips_ft: measurements.hips_ft || measurements.hips || measurements.hips_ridges ? (measurements.hips_ridges - (measurements.ridges || 0)) : 0,
        ridges_ft: measurements.ridges_ft || measurements.ridges || 0,
        step_flashing_ft: measurements.step_flashing_ft || measurements.step_flashing || 0,
        pitch: measurements.pitch || 4,
        facet_count: measurements.facet_count || measurements.facets || 1,
        starter_ft: measurements.starter_ft || measurements.starter,
        pipe_boot_count: measurements.pipe_boot_count,
        stories: measurements.stories,
      };
    } else if (pipeline_entry_id || measurement_id) {
      // Pull from database
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sb = createClient(supabaseUrl, serviceKey);

      let query = sb.from('roof_measurements').select(
        'total_area_adjusted_sqft, total_squares, total_eave_length, total_rake_length, total_valley_length, total_hip_length, total_ridge_length, total_step_flashing_length, predominant_pitch, facet_count'
      );

      if (measurement_id) {
        query = query.eq('id', measurement_id);
      } else {
        query = query.eq('pipeline_entry_id', pipeline_entry_id).order('created_at', { ascending: false }).limit(1);
      }

      const { data: mRow, error: mErr } = await query.maybeSingle();
      if (mErr) throw new Error(`Measurement lookup failed: ${mErr.message}`);
      if (!mRow) throw new Error('No measurement found');

      // Parse pitch from predominant_pitch string (e.g., "6/12")
      let pitchVal = 4;
      if (mRow.predominant_pitch) {
        const match = String(mRow.predominant_pitch).match(/(\d+(?:\.\d+)?)/);
        if (match) pitchVal = parseFloat(match[1]);
      }

      input = {
        total_area_sqft: mRow.total_area_adjusted_sqft || 0,
        total_squares: mRow.total_squares || (mRow.total_area_adjusted_sqft || 0) / 100,
        eaves_ft: mRow.total_eave_length || 0,
        rakes_ft: mRow.total_rake_length || 0,
        valleys_ft: mRow.total_valley_length || 0,
        hips_ft: mRow.total_hip_length || 0,
        ridges_ft: mRow.total_ridge_length || 0,
        step_flashing_ft: mRow.total_step_flashing_length || 0,
        pitch: pitchVal,
        facet_count: mRow.facet_count || 1,
      };
    } else {
      throw new Error('Provide either "measurements" object or "pipeline_entry_id"/"measurement_id"');
    }

    // Validate minimum data
    if (input.total_area_sqft <= 0) {
      throw new Error('total_area_sqft must be > 0');
    }

    // Generate scope
    const result = buildScopeFromMeasurements(input);

    // If scope_project_id provided, insert into database
    if (scope_project_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sb = createClient(supabaseUrl, serviceKey);

      const insertRows = result.line_items.map(item => ({
        scope_project_id,
        trade: item.trade,
        xactimate_code: item.xactimate_code,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: 0, // User sets pricing
        waste_percent: item.waste_percent,
        tax_rate: 0,
        source: item.source,
        confidence: item.source === 'measurement' ? 1.0 : 0.85,
        ai_reason: item.ai_reason,
        sort_order: item.sort_order,
      }));

      const { error: insertErr } = await sb.from('xact_scope_items').insert(insertRows);
      if (insertErr) throw new Error(`Failed to insert items: ${insertErr.message}`);
    }

    return new Response(JSON.stringify({
      success: true,
      input_summary: {
        total_sqft: input.total_area_sqft,
        total_squares: input.total_squares,
        pitch: `${input.pitch}/12`,
        facets: input.facet_count,
      },
      waste_factor: result.waste_factor,
      complexity_score: result.complexity_score,
      line_items: result.line_items,
      line_item_count: result.line_items.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err: any) {
    console.error('generate-estimate-from-measurement error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
