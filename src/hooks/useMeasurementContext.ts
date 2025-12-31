/**
 * Hook to fetch and build measurement context for smart tag evaluation
 */
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MeasurementContext {
  roof: {
    squares: number;
    total_sqft: number;
  };
  waste: {
    '10pct': { squares: number; sqft: number };
    '12pct': { squares: number; sqft: number };
    '15pct': { squares: number; sqft: number };
  };
  lf: {
    eave: number;
    rake: number;
    ridge: number;
    hip: number;
    valley: number;
    step: number;
  };
  pen: {
    pipe_vent: number;
  };
}

export interface MeasurementSummary {
  totalSquares: number;
  totalSqFt: number;
  wastePercent: number;
  eaveLength: number;
  rakeLength: number;
  ridgeLength: number;
  hipLength: number;
  valleyLength: number;
  stepFlashingLength: number;
  pipeVents: number;
}

// Build context from roof_measurements data
function buildContext(data: any): MeasurementContext {
  const squares = data?.total_squares || 0;
  const sqft = data?.total_area_adjusted_sqft || squares * 100;
  const eave = data?.total_eave_length || 0;
  const rake = data?.total_rake_length || 0;
  const ridge = data?.total_ridge_length || 0;
  const hip = data?.total_hip_length || 0;
  const valley = data?.total_valley_length || 0;
  const step = data?.total_step_flashing_length || 0;

  return {
    roof: {
      squares,
      total_sqft: sqft,
    },
    waste: {
      '10pct': { squares: squares * 1.10, sqft: sqft * 1.10 },
      '12pct': { squares: squares * 1.12, sqft: sqft * 1.12 },
      '15pct': { squares: squares * 1.15, sqft: sqft * 1.15 },
    },
    lf: {
      eave,
      rake,
      ridge,
      hip,
      valley,
      step,
    },
    pen: {
      pipe_vent: data?.penetration_count || 3, // Default estimate
    },
  };
}

// Build summary for display
function buildSummary(data: any): MeasurementSummary {
  return {
    totalSquares: data?.total_squares || 0,
    totalSqFt: data?.total_area_adjusted_sqft || 0,
    wastePercent: data?.waste_factor_percent || 10,
    eaveLength: data?.total_eave_length || 0,
    rakeLength: data?.total_rake_length || 0,
    ridgeLength: data?.total_ridge_length || 0,
    hipLength: data?.total_hip_length || 0,
    valleyLength: data?.total_valley_length || 0,
    stepFlashingLength: data?.total_step_flashing_length || 0,
    pipeVents: data?.penetration_count || 3,
  };
}

// Evaluate a formula like "{{ ceil(waste.10pct.squares * 3) }}"
export function evaluateFormula(formula: string, ctx: MeasurementContext): number {
  if (!formula || typeof formula !== 'string') return 0;

  // Handle static numbers
  const staticNum = parseFloat(formula);
  if (!isNaN(staticNum) && formula.trim() === String(staticNum)) {
    return staticNum;
  }

  // Extract expression from {{ }} 
  const match = formula.match(/\{\{\s*(.+?)\s*\}\}/);
  if (!match) {
    // Try parsing as plain number
    const num = parseFloat(formula);
    return isNaN(num) ? 0 : num;
  }

  const expression = match[1];

  try {
    // Build a flat context object for safe evaluation
    const flatCtx: Record<string, number> = {
      'roof.squares': ctx.roof.squares,
      'roof.total_sqft': ctx.roof.total_sqft,
      'waste.10pct.squares': ctx.waste['10pct'].squares,
      'waste.10pct.sqft': ctx.waste['10pct'].sqft,
      'waste.12pct.squares': ctx.waste['12pct'].squares,
      'waste.12pct.sqft': ctx.waste['12pct'].sqft,
      'waste.15pct.squares': ctx.waste['15pct'].squares,
      'waste.15pct.sqft': ctx.waste['15pct'].sqft,
      'lf.eave': ctx.lf.eave,
      'lf.rake': ctx.lf.rake,
      'lf.ridge': ctx.lf.ridge,
      'lf.hip': ctx.lf.hip,
      'lf.valley': ctx.lf.valley,
      'lf.step': ctx.lf.step,
      'pen.pipe_vent': ctx.pen.pipe_vent,
    };

    // Replace dot notation with values
    let evalExpr = expression;
    for (const [key, value] of Object.entries(flatCtx)) {
      const escapedKey = key.replace(/\./g, '\\.');
      evalExpr = evalExpr.replace(new RegExp(escapedKey, 'g'), String(value));
    }

    // Safe evaluation with math functions
    const safeEval = new Function(
      'ceil', 'floor', 'round', 'min', 'max', 'abs',
      `return ${evalExpr};`
    );
    const result = safeEval(Math.ceil, Math.floor, Math.round, Math.min, Math.max, Math.abs);
    return typeof result === 'number' && !isNaN(result) ? result : 0;
  } catch (error) {
    console.warn(`Failed to evaluate formula: ${formula}`, error);
    return 0;
  }
}

export function useMeasurementContext(pipelineEntryId: string) {
  const [context, setContext] = useState<MeasurementContext | null>(null);
  const [summary, setSummary] = useState<MeasurementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMeasurements() {
      if (!pipelineEntryId) {
        setLoading(false);
        return;
      }

      try {
        // Try to get measurements from roof_measurements table linked to this pipeline entry
        const { data, error: queryError } = await supabase
          .from('roof_measurements')
          .select('*')
          .eq('customer_id', pipelineEntryId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (queryError) {
          console.error('Error fetching measurements:', queryError);
          // Don't set error - measurements might not exist yet
        }

        if (data) {
          setContext(buildContext(data));
          setSummary(buildSummary(data));
        } else {
          // Try to get from pipeline entry metadata
          const { data: entry } = await supabase
            .from('pipeline_entries')
            .select('metadata')
            .eq('id', pipelineEntryId)
            .single();

          const metadata = entry?.metadata as any;
          if (metadata?.comprehensive_measurements) {
            const cm = metadata.comprehensive_measurements;
            const mockData = {
              total_squares: cm.roof_squares || cm.total_squares || 0,
              total_area_adjusted_sqft: cm.roof_area_sq_ft || cm.total_area_sqft || 0,
              total_eave_length: cm.eave_length || 0,
              total_rake_length: cm.rake_length || 0,
              total_ridge_length: cm.ridge_length || 0,
              total_hip_length: cm.hip_length || 0,
              total_valley_length: cm.valley_length || 0,
              total_step_flashing_length: cm.step_flashing_length || 0,
              penetration_count: cm.penetration_count || 3,
              waste_factor_percent: cm.waste_factor_percent || 10,
            };
            setContext(buildContext(mockData));
            setSummary(buildSummary(mockData));
          }
        }
      } catch (err) {
        console.error('Error in fetchMeasurements:', err);
        setError('Failed to load measurements');
      } finally {
        setLoading(false);
      }
    }

    fetchMeasurements();
  }, [pipelineEntryId]);

  return { context, summary, loading, error, evaluateFormula };
}
