import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// Material calculation types
interface RoofMeasurementData {
  total_area_sqft: number;
  total_squares: number;
  lf_ridge: number;
  lf_hip: number;
  lf_valley: number;
  lf_eave: number;
  lf_rake: number;
  lf_step: number;
  penetration_counts?: {
    pipe_vent?: number;
    skylight?: number;
    chimney?: number;
    hvac?: number;
  };
}

interface MaterialCalculationRequest {
  measurement_id?: string;
  pipeline_entry_id?: string;
  measurement_data?: RoofMeasurementData;
  waste_percentage?: number;
  selected_brands?: {
    shingles?: string;
    underlayment?: string;
    ridge_cap?: string;
    ice_water?: string;
    starter?: string;
  };
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const requestData: MaterialCalculationRequest = await req.json();
    
    let measurementData: RoofMeasurementData;

    // If measurement_id provided, fetch from database
    if (requestData.measurement_id) {
      const { data: measurement, error } = await supabase
        .from('measurements')
        .select('*')
        .eq('id', requestData.measurement_id)
        .single();

      if (error) throw new Error(`Failed to fetch measurement: ${error.message}`);
      if (!measurement) throw new Error('Measurement not found');

      // Also fetch facets for detailed calculations
      const { data: facets } = await supabase
        .from('roof_facets')
        .select('*')
        .eq('measurement_id', requestData.measurement_id);

      measurementData = {
        total_area_sqft: measurement.roof_area_sq_ft || 0,
        total_squares: (measurement.roof_area_sq_ft || 0) / 100,
        lf_ridge: measurement.ridges_lf || 0,
        lf_hip: measurement.hips_lf || 0,
        lf_valley: measurement.valleys_lf || 0,
        lf_eave: measurement.eaves_lf || 0,
        lf_rake: measurement.rakes_lf || 0,
        lf_step: measurement.step_flashing_lf || 0,
        penetration_counts: {
          pipe_vent: measurement.pipe_vents || 0,
          skylight: measurement.skylights || 0,
          chimney: measurement.chimneys || 0,
          hvac: 0,
        },
      };
    } 
    // If pipeline_entry_id provided, fetch measurement via pipeline entry
    else if (requestData.pipeline_entry_id) {
      const { data: pipelineEntry, error: peError } = await supabase
        .from('pipeline_entries')
        .select('id')
        .eq('id', requestData.pipeline_entry_id)
        .single();

      if (peError) throw new Error(`Failed to fetch pipeline entry: ${peError.message}`);

      const { data: measurement, error: mError } = await supabase
        .from('measurements')
        .select('*')
        .eq('property_id', requestData.pipeline_entry_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (mError) throw new Error(`Failed to fetch measurement: ${mError.message}`);
      if (!measurement) throw new Error('No measurement found for pipeline entry');

      measurementData = {
        total_area_sqft: measurement.roof_area_sq_ft || 0,
        total_squares: (measurement.roof_area_sq_ft || 0) / 100,
        lf_ridge: measurement.ridges_lf || 0,
        lf_hip: measurement.hips_lf || 0,
        lf_valley: measurement.valleys_lf || 0,
        lf_eave: measurement.eaves_lf || 0,
        lf_rake: measurement.rakes_lf || 0,
        lf_step: measurement.step_flashing_lf || 0,
        penetration_counts: {
          pipe_vent: measurement.pipe_vents || 0,
          skylight: measurement.skylights || 0,
          chimney: measurement.chimneys || 0,
          hvac: 0,
        },
      };
    }
    // If measurement_data provided directly, use it
    else if (requestData.measurement_data) {
      measurementData = requestData.measurement_data;
    } else {
      throw new Error('Must provide measurement_id, pipeline_entry_id, or measurement_data');
    }

    // Calculate materials
    const wastePercentage = requestData.waste_percentage || 10;
    const selectedBrands = requestData.selected_brands || {
      shingles: 'GAF',
      underlayment: 'Top Shield',
      ridge_cap: 'GAF',
      ice_water: 'GAF',
      starter: 'GAF',
    };

    const result = calculateMaterialsInternal(measurementData, wastePercentage, selectedBrands);

    console.log('Material calculation completed:', {
      measurement_id: requestData.measurement_id,
      total_cost: result.total_waste_adjusted_cost,
      item_count: result.waste_adjusted_materials.length,
    });

    return new Response(JSON.stringify({ ok: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error calculating materials:', error);
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// Simplified material calculation (mirrors frontend logic)
function calculateMaterialsInternal(
  measurements: RoofMeasurementData,
  wastePercentage: number,
  selectedBrands: any
) {
  const baseMaterials: any[] = [];
  const wasteFactor = 1 + (wastePercentage / 100);

  // Shingles
  const squares = measurements.total_squares;
  const shingleBundles = Math.ceil(squares * 3);
  baseMaterials.push({
    category: 'Shingles',
    product_name: `${selectedBrands.shingles} Shingles`,
    brand: selectedBrands.shingles,
    quantity: Math.ceil(squares),
    unit_of_measure: 'SQ',
    unit_cost: 121.00, // GAF HDZ default
    total_cost: Math.ceil(squares) * 121.00,
  });

  // Ridge Cap
  const totalRidgeHip = measurements.lf_ridge + measurements.lf_hip;
  if (totalRidgeHip > 0) {
    const ridgeBundles = Math.ceil(totalRidgeHip / 33);
    baseMaterials.push({
      category: 'Hip & Ridge',
      product_name: `${selectedBrands.ridge_cap} Ridge Cap`,
      brand: selectedBrands.ridge_cap,
      quantity: ridgeBundles,
      unit_of_measure: 'BD',
      unit_cost: 59.00,
      total_cost: ridgeBundles * 59.00,
    });
  }

  // Underlayment
  const underlaymentRolls = Math.ceil(squares / 10);
  baseMaterials.push({
    category: 'Underlayment',
    product_name: `${selectedBrands.underlayment} Underlayment`,
    brand: selectedBrands.underlayment,
    quantity: underlaymentRolls,
    unit_of_measure: 'RL',
    unit_cost: 67.00,
    total_cost: underlaymentRolls * 67.00,
  });

  // Apply waste factor
  const wasteAdjustedMaterials = baseMaterials.map(m => ({
    ...m,
    quantity: Math.ceil(m.quantity * wasteFactor),
    total_cost: Math.ceil(m.quantity * wasteFactor) * m.unit_cost,
  }));

  const totalBaseCost = baseMaterials.reduce((sum, m) => sum + m.total_cost, 0);
  const totalWasteAdjustedCost = wasteAdjustedMaterials.reduce((sum, m) => sum + m.total_cost, 0);

  return {
    base_materials: baseMaterials,
    waste_adjusted_materials: wasteAdjustedMaterials,
    total_base_cost: totalBaseCost,
    total_waste_adjusted_cost: totalWasteAdjustedCost,
    waste_percentage: wastePercentage,
    summary: {
      shingle_bundles: Math.ceil(squares * 3 * wasteFactor),
      ridge_cap_bundles: totalRidgeHip > 0 ? Math.ceil((totalRidgeHip / 33) * wasteFactor) : 0,
      underlayment_rolls: Math.ceil((squares / 10) * wasteFactor),
      ice_water_rolls: 0,
      starter_bundles: 0,
      drip_edge_sticks: 0,
      valley_rolls: 0,
      penetration_flashings: 0,
    },
  };
}
