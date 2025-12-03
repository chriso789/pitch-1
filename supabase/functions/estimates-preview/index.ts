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
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Safe mathematical expression parser using recursive descent
 * Eliminates code injection risk by NOT using eval() or new Function()
 * Only allows: numbers, +, -, *, /, parentheses, decimals
 */
function evaluateFormula(formula: string, parameters: Record<string, any>): number {
  try {
    // Input validation
    if (!formula || typeof formula !== 'string') return 0;
    if (formula.length > 500) {
      console.error('Formula too long (max 500 chars)');
      return 0;
    }
    
    // Replace parameter names with values
    let expression = formula;
    for (const [key, value] of Object.entries(parameters)) {
      const numValue = Number(value);
      if (isNaN(numValue)) continue;
      // Escape special regex characters in key
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expression = expression.replace(new RegExp(escapedKey, 'g'), numValue.toString());
    }
    
    // Remove all whitespace
    expression = expression.replace(/\s/g, '');
    
    // Strict validation - only allow numbers, operators, parentheses, decimals
    if (!/^[0-9+\-*/.()]+$/.test(expression)) {
      console.error('Invalid characters in expression:', expression);
      return 0;
    }
    
    // Parse and evaluate using safe recursive descent parser
    const result = safeParse(expression);
    return typeof result === 'number' && isFinite(result) ? result : 0;
  } catch (error) {
    console.error('Formula evaluation error:', error);
    return 0;
  }
}

/**
 * Recursive descent parser - completely safe, no eval/Function
 * Grammar:
 *   expression = term (('+' | '-') term)*
 *   term = factor (('*' | '/') factor)*
 *   factor = '-'? (number | '(' expression ')')
 */
function safeParse(expr: string): number {
  let pos = 0;
  
  function parseExpression(): number {
    let left = parseTerm();
    while (pos < expr.length && (expr[pos] === '+' || expr[pos] === '-')) {
      const op = expr[pos++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  
  function parseTerm(): number {
    let left = parseFactor();
    while (pos < expr.length && (expr[pos] === '*' || expr[pos] === '/')) {
      const op = expr[pos++];
      const right = parseFactor();
      if (op === '/') {
        // Safe division by zero - return 0 instead of Infinity
        left = right === 0 ? 0 : left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }
  
  function parseFactor(): number {
    // Handle unary minus
    if (expr[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    
    // Handle unary plus
    if (expr[pos] === '+') {
      pos++;
      return parseFactor();
    }
    
    // Handle parentheses
    if (expr[pos] === '(') {
      pos++; // skip '('
      const result = parseExpression();
      if (expr[pos] === ')') pos++; // skip ')'
      return result;
    }
    
    // Parse number (including decimals)
    let numStr = '';
    while (pos < expr.length && /[0-9.]/.test(expr[pos])) {
      numStr += expr[pos++];
    }
    
    const num = parseFloat(numStr);
    return isNaN(num) ? 0 : num;
  }
  
  const result = parseExpression();
  return result;
}
