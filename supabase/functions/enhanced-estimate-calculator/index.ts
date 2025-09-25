import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface EstimateCalculationRequest {
  pipeline_entry_id?: string;
  template_id?: string;
  property_details: {
    roof_area_sq_ft: number;
    roof_type: string;
    complexity_level: string;
    roof_pitch: string;
    customer_name: string;
    customer_address: string;
    season: string;
    location_zone?: string;
  };
  line_items?: Array<{
    item_category: string;
    item_name: string;
    description?: string;
    quantity: number;
    unit_cost: number;
    unit_type: string;
    markup_percent?: number;
  }>;
  sales_rep_id?: string;
  override_percentages?: {
    overhead_percent?: number;
    target_profit_percent?: number;
    sales_rep_commission_percent?: number;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from request
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's profile and tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: 'No tenant found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const requestData = await req.json() as EstimateCalculationRequest;

    // Generate estimate number
    const estimateNumber = `EST-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    // Get calculation template if specified
    let template = null;
    if (requestData.template_id) {
      const { data: templateData } = await supabase
        .from('estimate_calculation_templates')
        .select('*')
        .eq('id', requestData.template_id)
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .single();
      
      template = templateData;
    } else {
      // Get default template for roof type
      const { data: templateData } = await supabase
        .from('estimate_calculation_templates')
        .select('*')
        .eq('roof_type', requestData.property_details.roof_type)
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .eq('template_category', 'standard')
        .single();
      
      template = templateData;
    }

    if (!template) {
      return new Response(JSON.stringify({ error: 'No calculation template found for this roof type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate material and labor costs
    const calculations = await calculateEnhancedEstimate(
      requestData.property_details,
      template,
      requestData.line_items || [],
      requestData.override_percentages || {},
      profile.tenant_id
    );

    // Create enhanced estimate record
    const estimateData = {
      tenant_id: profile.tenant_id,
      pipeline_entry_id: requestData.pipeline_entry_id,
      template_id: template.id,
      estimate_number: estimateNumber,
      customer_name: requestData.property_details.customer_name,
      customer_address: requestData.property_details.customer_address,
      roof_area_sq_ft: requestData.property_details.roof_area_sq_ft,
      roof_pitch: requestData.property_details.roof_pitch,
      complexity_level: requestData.property_details.complexity_level,
      season: requestData.property_details.season,
      location_zone: requestData.property_details.location_zone,
      
      // Material costs
      material_cost: calculations.material_cost,
      material_markup_percent: calculations.material_markup_percent,
      material_total: calculations.material_total,
      
      // Labor costs
      labor_hours: calculations.labor_hours,
      labor_rate_per_hour: calculations.labor_rate_per_hour,
      labor_cost: calculations.labor_cost,
      labor_markup_percent: calculations.labor_markup_percent,
      labor_total: calculations.labor_total,
      
      // Overhead and profits
      subtotal: calculations.subtotal,
      overhead_percent: calculations.overhead_percent,
      overhead_amount: calculations.overhead_amount,
      sales_rep_id: requestData.sales_rep_id,
      sales_rep_commission_percent: calculations.sales_rep_commission_percent,
      sales_rep_commission_amount: calculations.sales_rep_commission_amount,
      target_profit_percent: calculations.target_profit_percent,
      target_profit_amount: calculations.target_profit_amount,
      actual_profit_amount: calculations.actual_profit_amount,
      actual_profit_percent: calculations.actual_profit_percent,
      
      // Final pricing
      selling_price: calculations.selling_price,
      price_per_sq_ft: calculations.price_per_sq_ft,
      permit_costs: calculations.permit_costs,
      
      // Line items
      line_items: calculations.line_items,
      
      // Metadata
      property_details: requestData.property_details,
      calculation_metadata: calculations.metadata,
      
      status: 'draft',
      created_by: user.id
    };

    const { data: newEstimate, error: estimateError } = await supabase
      .from('enhanced_estimates')
      .insert(estimateData)
      .select()
      .single();

    if (estimateError) {
      console.error('Error creating estimate:', estimateError);
      return new Response(JSON.stringify({ error: 'Failed to create estimate' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create line items if provided
    if (requestData.line_items && requestData.line_items.length > 0) {
      const lineItemsData = requestData.line_items.map((item, index) => ({
        tenant_id: profile.tenant_id,
        estimate_id: newEstimate.id,
        line_number: index + 1,
        item_category: item.item_category,
        item_name: item.item_name,
        description: item.description,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        unit_type: item.unit_type,
        markup_percent: item.markup_percent || 0,
        markup_amount: (item.unit_cost * item.quantity) * ((item.markup_percent || 0) / 100),
        extended_cost: item.unit_cost * item.quantity,
        total_price: (item.unit_cost * item.quantity) * (1 + ((item.markup_percent || 0) / 100)),
        sort_order: index
      }));

      await supabase
        .from('estimate_line_items')
        .insert(lineItemsData);
    }

    return new Response(JSON.stringify({
      success: true,
      estimate: newEstimate,
      calculations: calculations,
      message: `Enhanced estimate ${estimateNumber} created successfully`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in enhanced-estimate-calculator:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function calculateEnhancedEstimate(
  propertyDetails: any,
  template: any,
  lineItems: any[],
  overrides: any,
  tenantId: string
): Promise<any> {
  
  const roofArea = propertyDetails.roof_area_sq_ft;
  
  // Get multipliers from template
  const complexityMultiplier = template.complexity_multipliers[propertyDetails.complexity_level] || 1.0;
  const seasonMultiplier = template.seasonal_multipliers[propertyDetails.season] || 1.0;
  const locationMultiplier = template.location_multipliers[propertyDetails.location_zone] || 1.0;
  
  // Calculate base material cost
  const baseMaterialCost = template.base_material_cost_per_sq * roofArea;
  const adjustedMaterialCost = baseMaterialCost * complexityMultiplier * seasonMultiplier * locationMultiplier;
  
  // Calculate labor
  const laborHours = template.base_labor_hours_per_sq * roofArea * complexityMultiplier;
  const laborCost = laborHours * template.base_labor_rate_per_hour;
  
  // Apply markup to materials and labor
  const materialMarkupPercent = 25; // Default markup
  const laborMarkupPercent = 35; // Default markup
  
  const materialTotal = adjustedMaterialCost * (1 + materialMarkupPercent / 100);
  const laborTotal = laborCost * (1 + laborMarkupPercent / 100);
  
  const subtotal = materialTotal + laborTotal;
  
  // Calculate overhead, commission, and profit
  const overheadPercent = overrides.overhead_percent || template.overhead_percentage;
  const overheadAmount = subtotal * (overheadPercent / 100);
  
  const salesCommissionPercent = overrides.sales_rep_commission_percent || 5.0;
  const salesCommissionAmount = (subtotal + overheadAmount) * (salesCommissionPercent / 100);
  
  const targetProfitPercent = overrides.target_profit_percent || template.target_profit_percentage;
  const targetProfitAmount = (subtotal + overheadAmount + salesCommissionAmount) * (targetProfitPercent / 100);
  
  // Calculate final selling price
  const permitCosts = 500; // Default permit cost
  const sellingPrice = subtotal + overheadAmount + salesCommissionAmount + targetProfitAmount + permitCosts;
  
  return {
    // Material calculations
    material_cost: adjustedMaterialCost,
    material_markup_percent: materialMarkupPercent,
    material_total: materialTotal,
    
    // Labor calculations  
    labor_hours: laborHours,
    labor_rate_per_hour: template.base_labor_rate_per_hour,
    labor_cost: laborCost,
    labor_markup_percent: laborMarkupPercent,
    labor_total: laborTotal,
    
    // Totals and margins
    subtotal: subtotal,
    overhead_percent: overheadPercent,
    overhead_amount: overheadAmount,
    sales_rep_commission_percent: salesCommissionPercent,
    sales_rep_commission_amount: salesCommissionAmount,
    target_profit_percent: targetProfitPercent,
    target_profit_amount: targetProfitAmount,
    actual_profit_amount: targetProfitAmount,
    actual_profit_percent: (targetProfitAmount / sellingPrice) * 100,
    
    // Final pricing
    selling_price: sellingPrice,
    price_per_sq_ft: sellingPrice / roofArea,
    permit_costs: permitCosts,
    
    // Line items for detailed breakdown
    line_items: [
      {
        category: 'material',
        name: `${propertyDetails.roof_type} Materials`,
        quantity: roofArea,
        unit: 'sq_ft',
        unit_cost: template.base_material_cost_per_sq,
        total: materialTotal
      },
      {
        category: 'labor',
        name: 'Installation Labor',
        quantity: laborHours,
        unit: 'hours',
        unit_cost: template.base_labor_rate_per_hour,
        total: laborTotal
      },
      {
        category: 'overhead',
        name: 'Overhead & Administrative',
        quantity: 1,
        unit: 'lot',
        unit_cost: overheadAmount,
        total: overheadAmount
      },
      {
        category: 'permit',
        name: 'Permits & Inspections',
        quantity: 1,
        unit: 'lot',
        unit_cost: permitCosts,
        total: permitCosts
      }
    ],
    
    // Calculation metadata
    metadata: {
      template_used: template.name,
      complexity_multiplier: complexityMultiplier,
      season_multiplier: seasonMultiplier,
      location_multiplier: locationMultiplier,
      calculation_date: new Date().toISOString(),
      roof_area_sq_ft: roofArea
    }
  };
}