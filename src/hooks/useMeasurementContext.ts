/**
 * Hook to fetch and build measurement context for smart tag evaluation
 * Priority: measurement_approvals.saved_tags > roof_measurements > pipeline_entries.metadata
 * 
 * REFACTORED: Now uses React Query for proper cache invalidation
 * When measurements are updated (AI analysis, import, manual), invalidate:
 * queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] })
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  source: 'approval' | 'roof_measurements' | 'metadata' | 'none';
  approvalId?: string;
  approvalDate?: string;
}

// Build context from saved_tags (measurement_approvals format)
function buildContextFromTags(tags: Record<string, any>): MeasurementContext {
  // Handle different tag naming conventions - fix operator precedence
  const planArea = Number(tags['roof.plan_area']) || 0;
  const squares = Number(tags['roof.squares']) || (planArea > 0 ? planArea / 100 : 0);
  const sqft = Number(tags['roof.total_sqft']) || planArea || (squares * 100);
  const eave = Number(tags['lf.eave'] || tags['lf.eaves'] || 0);
  const rake = Number(tags['lf.rake'] || tags['lf.rakes'] || 0);
  const ridge = Number(tags['lf.ridge'] || tags['lf.ridges'] || 0);
  const hip = Number(tags['lf.hip'] || tags['lf.hips'] || 0);
  const valley = Number(tags['lf.valley'] || tags['lf.valleys'] || 0);
  const step = Number(tags['lf.step'] || tags['lf.step_flashing'] || 0);
  const pipeVent = Number(tags['pen.pipe_vent'] || tags['pen.pipe_vents'] || tags['penetrations'] || 3);

  return {
    roof: {
      squares,
      total_sqft: sqft,
    },
    waste: {
      '10pct': { 
        squares: Number(tags['waste.10pct.squares']) || squares * 1.10, 
        sqft: Number(tags['waste.10pct.sqft']) || sqft * 1.10 
      },
      '12pct': { 
        squares: Number(tags['waste.12pct.squares']) || squares * 1.12, 
        sqft: Number(tags['waste.12pct.sqft']) || sqft * 1.12 
      },
      '15pct': { 
        squares: Number(tags['waste.15pct.squares']) || squares * 1.15, 
        sqft: Number(tags['waste.15pct.sqft']) || sqft * 1.15 
      },
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
      pipe_vent: pipeVent,
    },
  };
}

// Build context from roof_measurements data
function buildContextFromRoofMeasurements(data: any): MeasurementContext {
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
      pipe_vent: data?.penetration_count || 3,
    },
  };
}

// Build summary for display
function buildSummaryFromContext(
  ctx: MeasurementContext, 
  source: 'approval' | 'roof_measurements' | 'metadata' | 'none',
  approvalId?: string,
  approvalDate?: string
): MeasurementSummary {
  return {
    totalSquares: ctx.roof.squares,
    totalSqFt: ctx.roof.total_sqft,
    wastePercent: 10,
    eaveLength: ctx.lf.eave,
    rakeLength: ctx.lf.rake,
    ridgeLength: ctx.lf.ridge,
    hipLength: ctx.lf.hip,
    valleyLength: ctx.lf.valley,
    stepFlashingLength: ctx.lf.step,
    pipeVents: ctx.pen.pipe_vent,
    source,
    approvalId,
    approvalDate,
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
      // Compound convenience keys for common calculations
      'lf.ridge_hip': ctx.lf.ridge + ctx.lf.hip,    // Ridge cap coverage (ridge + hip)
      'lf.eave_rake': ctx.lf.eave + ctx.lf.rake,    // Drip edge perimeter (eave + rake)
      'lf.perimeter': ctx.lf.eave + ctx.lf.rake,    // Alias for drip edge
    };

    // Replace dot notation with values
    // CRITICAL: Sort by key length descending to replace longer keys first
    // This prevents 'lf.ridge' from partially matching within 'lf.ridge_hip'
    let evalExpr = expression;
    const sortedEntries = Object.entries(flatCtx).sort(
      ([a], [b]) => b.length - a.length
    );
    for (const [key, value] of sortedEntries) {
      const escapedKey = key.replace(/\./g, '\\.');
      evalExpr = evalExpr.replace(new RegExp(escapedKey, 'g'), String(value));
    }

    // Safe evaluation with math functions
    const safeEval = new Function(
      'ceil', 'floor', 'round', 'min', 'max', 'abs',
      `return ${evalExpr};`
    );
    const result = safeEval(Math.ceil, Math.floor, Math.round, Math.min, Math.max, Math.abs);
    // Round to 2 decimal places to avoid floating-point precision issues
    return typeof result === 'number' && !isNaN(result) 
      ? Math.round(result * 100) / 100 
      : 0;
  } catch (error) {
    console.warn(`Failed to evaluate formula: ${formula}`, error);
    return 0;
  }
}

interface MeasurementContextResult {
  context: MeasurementContext | null;
  summary: MeasurementSummary | null;
  activeApprovalId: string | null;
}

async function fetchMeasurementContext(pipelineEntryId: string): Promise<MeasurementContextResult> {
  if (!pipelineEntryId) {
    return { context: null, summary: null, activeApprovalId: null };
  }

  // PRIORITY 1: Check for selected or latest measurement_approval
  const { data: pipelineEntry } = await supabase
    .from('pipeline_entries')
    .select('metadata')
    .eq('id', pipelineEntryId)
    .single();

  const metadata = pipelineEntry?.metadata as any;
  const selectedApprovalId = metadata?.selected_measurement_approval_id;

  // Fetch approval - either selected or latest
  let approvalQuery = supabase
    .from('measurement_approvals')
    .select('id, saved_tags, approved_at')
    .eq('pipeline_entry_id', pipelineEntryId)
    .order('approved_at', { ascending: false });

  if (selectedApprovalId) {
    approvalQuery = supabase
      .from('measurement_approvals')
      .select('id, saved_tags, approved_at')
      .eq('id', selectedApprovalId);
  }

  const { data: approvals, error: approvalError } = await approvalQuery.limit(1);

  if (!approvalError && approvals && approvals.length > 0) {
    const approval = approvals[0];
    const savedTags = approval.saved_tags as Record<string, any>;
    
    if (savedTags && Object.keys(savedTags).length > 0) {
      const ctx = buildContextFromTags(savedTags);
      console.log('🔧 MeasurementContext built from approval:', {
        source: 'approval',
        approvalId: approval.id,
        squares: ctx.roof.squares,
        hip: ctx.lf.hip,
        eave: ctx.lf.eave,
        ridge: ctx.lf.ridge,
      });
      return {
        context: ctx,
        summary: buildSummaryFromContext(ctx, 'approval', approval.id, approval.approved_at),
        activeApprovalId: approval.id,
      };
    }
  }

  // PRIORITY 2: Try roof_measurements table
  const { data: roofData, error: roofError } = await supabase
    .from('roof_measurements')
    .select('*')
    .eq('customer_id', pipelineEntryId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!roofError && roofData) {
    const ctx = buildContextFromRoofMeasurements(roofData);
    console.log('🔧 MeasurementContext built from roof_measurements:', {
      source: 'roof_measurements',
      squares: ctx.roof.squares,
    });
    return {
      context: ctx,
      summary: buildSummaryFromContext(ctx, 'roof_measurements'),
      activeApprovalId: null,
    };
  }

  // PRIORITY 3: Fallback to pipeline entry metadata
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
    const ctx = buildContextFromRoofMeasurements(mockData);
    console.log('🔧 MeasurementContext built from metadata:', {
      source: 'metadata',
      squares: ctx.roof.squares,
    });
    return {
      context: ctx,
      summary: buildSummaryFromContext(ctx, 'metadata'),
      activeApprovalId: null,
    };
  }

  // No measurements found
  console.log('🔧 MeasurementContext: No measurements found');
  return { context: null, summary: null, activeApprovalId: null };
}

export function useMeasurementContext(pipelineEntryId: string) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['measurement-context', pipelineEntryId],
    queryFn: () => fetchMeasurementContext(pipelineEntryId),
    enabled: !!pipelineEntryId,
    staleTime: 1000 * 60, // 1 minute - keep fresh
    gcTime: 1000 * 60 * 5, // 5 minutes in cache
  });

  return { 
    context: data?.context ?? null, 
    summary: data?.summary ?? null, 
    loading: isLoading, 
    error: error?.message ?? null, 
    evaluateFormula, 
    activeApprovalId: data?.activeApprovalId ?? null,
    refetch, // Expose refetch for manual refresh
  };
}
