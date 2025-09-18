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

    const { template_id, parameters } = await req.json();

    // Get the estimate template
    const { data: template, error: templateError } = await supabaseClient
      .from('estimate_templates')
      .select('*')
      .eq('id', template_id)
      .single();

    if (templateError) {
      console.error('Template error:', templateError);
      return new Response(JSON.stringify({ error: 'Template not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate estimate based on template and parameters
    const templateData = template.template_data;
    let materialCost = 0;
    let laborCost = 0;
    const lineItems = [];

    // Calculate materials
    for (const material of templateData.materials) {
      const quantity = evaluateFormula(material.formula, parameters);
      const itemCost = quantity * material.unit_cost;
      materialCost += itemCost;
      
      lineItems.push({
        type: 'material',
        item: material.item,
        quantity,
        unit: material.unit,
        unit_cost: material.unit_cost,
        total_cost: itemCost
      });
    }

    // Calculate labor
    for (const labor of templateData.labor) {
      const quantity = evaluateFormula(labor.formula, parameters);
      const itemCost = quantity * labor.rate;
      laborCost += itemCost;
      
      lineItems.push({
        type: 'labor',
        task: labor.task,
        quantity,
        unit: labor.unit,
        rate: labor.rate,
        total_cost: itemCost
      });
    }

    // Get tenant settings for overhead and target margin
    const { data: tenantSettings } = await supabaseClient
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', template.tenant_id)
      .single();

    const targetMargin = tenantSettings?.default_target_margin_percent || 30;
    const overheadPercent = 15; // Default overhead, could be from rep settings

    // Calculate selling price using PITCH formula: P = C / (1 - oh - m)
    const totalCost = materialCost + laborCost;
    const overheadDecimal = overheadPercent / 100;
    const marginDecimal = targetMargin / 100;
    
    if (overheadDecimal + marginDecimal >= 1) {
      return new Response(JSON.stringify({ error: 'Invalid overhead + margin combination (>=100%)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sellingPrice = totalCost / (1 - overheadDecimal - marginDecimal);
    const overheadAmount = sellingPrice * overheadDecimal;
    const actualProfit = sellingPrice - totalCost - overheadAmount;
    const actualMargin = (actualProfit / sellingPrice) * 100;

    const estimate = {
      template_id,
      parameters,
      line_items: lineItems,
      material_cost: Math.round(materialCost * 100) / 100,
      labor_cost: Math.round(laborCost * 100) / 100,
      total_cost: Math.round(totalCost * 100) / 100,
      overhead_percent: overheadPercent,
      overhead_amount: Math.round(overheadAmount * 100) / 100,
      target_margin_percent: targetMargin,
      selling_price: Math.round(sellingPrice * 100) / 100,
      actual_profit: Math.round(actualProfit * 100) / 100,
      actual_margin_percent: Math.round(actualMargin * 100) / 100
    };

    return new Response(JSON.stringify({ estimate }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in estimates-preview function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Simple formula evaluator for basic calculations
function evaluateFormula(formula: string, parameters: Record<string, any>): number {
  try {
    // Replace parameter names with values
    let expression = formula;
    for (const [key, value] of Object.entries(parameters)) {
      expression = expression.replace(new RegExp(key, 'g'), value.toString());
    }
    
    // Basic safety check - only allow numbers, operators, and parentheses
    if (!/^[0-9+\-*/.() ]+$/.test(expression)) {
      throw new Error('Invalid expression');
    }
    
    // Use Function constructor for safe evaluation (limited scope)
    const result = new Function(`return ${expression}`)();
    return typeof result === 'number' && isFinite(result) ? result : 0;
  } catch (error) {
    console.error('Formula evaluation error:', error);
    return 0;
  }
}