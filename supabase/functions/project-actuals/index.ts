import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { project_id } = await req.json();

    // Get project details with budget snapshot
    const { data: project, error: projectError } = await supabaseClient
      .from('projects')
      .select(`
        *,
        project_budget_snapshots (
          original_budget,
          is_current
        )
      `)
      .eq('id', project_id)
      .single();

    if (projectError) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all project costs (actuals)
    const { data: costs, error: costsError } = await supabaseClient
      .from('project_costs')
      .select('*')
      .eq('project_id', project_id)
      .order('cost_date', { ascending: false });

    if (costsError) {
      console.error('Costs error:', costsError);
      return new Response(JSON.stringify({ error: 'Failed to fetch project costs' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate actual totals
    const actualMaterialCost = costs
      .filter(cost => cost.cost_type === 'material')
      .reduce((sum, cost) => sum + parseFloat(cost.total_cost), 0);

    const actualLaborCost = costs
      .filter(cost => cost.cost_type === 'labor')
      .reduce((sum, cost) => sum + parseFloat(cost.total_cost), 0);

    const actualOtherCost = costs
      .filter(cost => !['material', 'labor'].includes(cost.cost_type))
      .reduce((sum, cost) => sum + parseFloat(cost.total_cost), 0);

    const totalActualCost = actualMaterialCost + actualLaborCost + actualOtherCost;

    // Get original budget from snapshot
    const currentSnapshot = project.project_budget_snapshots?.find((s: any) => s.is_current);
    const originalBudget = currentSnapshot?.original_budget || {};

    const budgetMaterialCost = parseFloat(originalBudget.material_cost) || 0;
    const budgetLaborCost = parseFloat(originalBudget.labor_cost) || 0;
    const budgetSellingPrice = parseFloat(originalBudget.selling_price) || 0;
    const budgetOverheadAmount = parseFloat(originalBudget.overhead_amount) || 0;

    // Calculate variances
    const materialVariance = actualMaterialCost - budgetMaterialCost;
    const laborVariance = actualLaborCost - budgetLaborCost;
    const totalVariance = totalActualCost - (budgetMaterialCost + budgetLaborCost);

    // Calculate current project profit (selling price - actual costs - overhead)
    const currentProfit = budgetSellingPrice - totalActualCost - budgetOverheadAmount;
    const currentMargin = budgetSellingPrice > 0 ? (currentProfit / budgetSellingPrice) * 100 : 0;

    const analysis = {
      project_id,
      project_name: project.name,
      project_number: project.project_number,
      status: project.status,
      
      // Original Budget
      budget: {
        material_cost: budgetMaterialCost,
        labor_cost: budgetLaborCost,
        total_cost: budgetMaterialCost + budgetLaborCost,
        selling_price: budgetSellingPrice,
        overhead_amount: budgetOverheadAmount,
        original_profit: parseFloat(originalBudget.actual_profit) || 0,
        original_margin: parseFloat(originalBudget.actual_margin_percent) || 0
      },
      
      // Actual Costs
      actuals: {
        material_cost: Math.round(actualMaterialCost * 100) / 100,
        labor_cost: Math.round(actualLaborCost * 100) / 100,
        other_cost: Math.round(actualOtherCost * 100) / 100,
        total_cost: Math.round(totalActualCost * 100) / 100
      },
      
      // Variances
      variances: {
        material_variance: Math.round(materialVariance * 100) / 100,
        labor_variance: Math.round(laborVariance * 100) / 100,
        total_variance: Math.round(totalVariance * 100) / 100,
        material_variance_percent: budgetMaterialCost > 0 ? Math.round((materialVariance / budgetMaterialCost) * 10000) / 100 : 0,
        labor_variance_percent: budgetLaborCost > 0 ? Math.round((laborVariance / budgetLaborCost) * 10000) / 100 : 0
      },
      
      // Current Profit Analysis
      current_analysis: {
        current_profit: Math.round(currentProfit * 100) / 100,
        current_margin: Math.round(currentMargin * 100) / 100,
        profit_impact: Math.round((currentProfit - (parseFloat(originalBudget.actual_profit) || 0)) * 100) / 100
      },
      
      // Cost Details
      cost_breakdown: costs.map(cost => ({
        id: cost.id,
        date: cost.cost_date,
        type: cost.cost_type,
        description: cost.description,
        quantity: cost.quantity,
        unit_cost: cost.unit_cost,
        total_cost: parseFloat(cost.total_cost),
        vendor: cost.vendor_name,
        is_change_order: cost.is_change_order
      }))
    };

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in project-actuals function:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});