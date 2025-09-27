import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface ExcelStyleCalculationRequest {
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
  // Excel-style configuration
  target_margin_percent: number; // Guaranteed margin (default 30%)
  overhead_percent: number; // Overhead as % of selling price
  commission_percent: number; // Sales commission as % of selling price
  waste_factor_percent?: number; // Material waste factor
  contingency_percent?: number; // Project contingency
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

    const requestData = await req.json() as ExcelStyleCalculationRequest;

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

    // Calculate Excel-style estimate with guaranteed margins
    const calculations = await calculateExcelStyleEstimate(
      requestData.property_details,
      template,
      requestData.line_items || [],
      {
        target_margin_percent: requestData.target_margin_percent || 30.0,
        overhead_percent: requestData.overhead_percent || 15.0,
        commission_percent: requestData.commission_percent || 5.0,
        waste_factor_percent: requestData.waste_factor_percent || 10.0,
        contingency_percent: requestData.contingency_percent || 5.0
      },
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
      
      // Excel-style calculations
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
      
      // Final pricing (Excel-style reverse calculation)
      selling_price: calculations.selling_price,
      price_per_sq_ft: calculations.price_per_sq_ft,
      permit_costs: calculations.permit_costs,
      
      // Waste and contingency
      waste_factor_percent: calculations.waste_factor_percent,
      contingency_percent: calculations.contingency_percent,
      
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
      message: `Excel-style estimate ${estimateNumber} created with guaranteed ${calculations.target_profit_percent}% margin`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in excel-style-estimate-calculator:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function calculateExcelStyleEstimate(
  propertyDetails: any,
  template: any,
  lineItems: any[],
  config: {
    target_margin_percent: number;
    overhead_percent: number;
    commission_percent: number;
    waste_factor_percent: number;
    contingency_percent: number;
  },
  tenantId: string
): Promise<any> {
  
  const roofArea = propertyDetails.roof_area_sq_ft;
  
  // Get multipliers from template
  const complexityMultiplier = template.complexity_multipliers[propertyDetails.complexity_level] || 1.0;
  const seasonMultiplier = template.seasonal_multipliers[propertyDetails.season] || 1.0;
  const locationMultiplier = template.location_multipliers[propertyDetails.location_zone] || 1.0;
  
  // Calculate base material cost with waste factor
  const baseMaterialCost = template.base_material_cost_per_sq * roofArea;
  const adjustedMaterialCost = baseMaterialCost * complexityMultiplier * seasonMultiplier * locationMultiplier;
  const materialCostWithWaste = adjustedMaterialCost * (1 + config.waste_factor_percent / 100);
  
  // Calculate labor
  const laborHours = template.base_labor_hours_per_sq * roofArea * complexityMultiplier;
  const laborCost = laborHours * template.base_labor_rate_per_hour;
  
  // Add contingency to labor
  const laborCostWithContingency = laborCost * (1 + config.contingency_percent / 100);
  
  // Base costs (no markup yet)
  const baseCosts = materialCostWithWaste + laborCostWithContingency;
  
  // Fixed costs (permits, etc.)
  const permitCosts = 500;
  const totalBaseCosts = baseCosts + permitCosts;
  
  // EXCEL-STYLE REVERSE CALCULATION
  // Selling Price = Base Costs / (1 - Overhead% - Commission% - Target Margin%)
  const totalPercentages = (config.overhead_percent + config.commission_percent + config.target_margin_percent) / 100;
  
  if (totalPercentages >= 1.0) {
    throw new Error('Total percentages (overhead + commission + margin) cannot exceed 100%');
  }
  
  const sellingPrice = totalBaseCosts / (1 - totalPercentages);
  
  // Now calculate all components based on selling price
  const overheadAmount = sellingPrice * (config.overhead_percent / 100);
  const commissionAmount = sellingPrice * (config.commission_percent / 100);
  const targetProfitAmount = sellingPrice * (config.target_margin_percent / 100);
  
  // Material and labor markups to reach selling price
  const availableForMaterialsAndLabor = sellingPrice - overheadAmount - commissionAmount - targetProfitAmount - permitCosts;
  
  // Distribute available amount proportionally to materials and labor
  const materialPortion = materialCostWithWaste / baseCosts;
  const laborPortion = laborCostWithContingency / baseCosts;
  
  const materialTotal = availableForMaterialsAndLabor * materialPortion;
  const laborTotal = availableForMaterialsAndLabor * laborPortion;
  
  // Calculate effective markup percentages
  const materialMarkupPercent = ((materialTotal - materialCostWithWaste) / materialCostWithWaste) * 100;
  const laborMarkupPercent = ((laborTotal - laborCostWithContingency) / laborCostWithContingency) * 100;
  
  const subtotal = materialTotal + laborTotal;
  
  return {
    // Material calculations
    material_cost: materialCostWithWaste,
    material_markup_percent: materialMarkupPercent,
    material_total: materialTotal,
    
    // Labor calculations  
    labor_hours: laborHours,
    labor_rate_per_hour: template.base_labor_rate_per_hour,
    labor_cost: laborCostWithContingency,
    labor_markup_percent: laborMarkupPercent,
    labor_total: laborTotal,
    
    // Excel-style totals and margins
    subtotal: subtotal,
    overhead_percent: config.overhead_percent,
    overhead_amount: overheadAmount,
    sales_rep_commission_percent: config.commission_percent,
    sales_rep_commission_amount: commissionAmount,
    target_profit_percent: config.target_margin_percent,
    target_profit_amount: targetProfitAmount,
    actual_profit_amount: targetProfitAmount,
    actual_profit_percent: config.target_margin_percent, // Guaranteed
    
    // Waste and contingency
    waste_factor_percent: config.waste_factor_percent,
    contingency_percent: config.contingency_percent,
    
    // Final pricing
    selling_price: sellingPrice,
    price_per_sq_ft: sellingPrice / roofArea,
    permit_costs: permitCosts,
    
    // Base costs breakdown
    base_material_cost: adjustedMaterialCost,
    base_labor_cost: laborCost,
    total_base_costs: totalBaseCosts,
    
    // Line items for detailed breakdown
    line_items: [
      {
        category: 'material',
        name: `${propertyDetails.roof_type} Materials (incl. ${config.waste_factor_percent}% waste)`,
        quantity: roofArea,
        unit: 'sq_ft',
        unit_cost: template.base_material_cost_per_sq,
        base_cost: materialCostWithWaste,
        total: materialTotal,
        markup_percent: materialMarkupPercent
      },
      {
        category: 'labor',
        name: `Installation Labor (incl. ${config.contingency_percent}% contingency)`,
        quantity: laborHours,
        unit: 'hours',
        unit_cost: template.base_labor_rate_per_hour,
        base_cost: laborCostWithContingency,
        total: laborTotal,
        markup_percent: laborMarkupPercent
      },
      {
        category: 'overhead',
        name: `Overhead & Administrative (${config.overhead_percent}% of selling price)`,
        quantity: 1,
        unit: 'lot',
        unit_cost: overheadAmount,
        total: overheadAmount,
        calculation_note: 'Calculated as percentage of selling price'
      },
      {
        category: 'commission',
        name: `Sales Commission (${config.commission_percent}% of selling price)`,
        quantity: 1,
        unit: 'lot',
        unit_cost: commissionAmount,
        total: commissionAmount,
        calculation_note: 'Calculated as percentage of selling price'
      },
      {
        category: 'profit',
        name: `Guaranteed Profit (${config.target_margin_percent}% margin)`,
        quantity: 1,
        unit: 'lot',
        unit_cost: targetProfitAmount,
        total: targetProfitAmount,
        calculation_note: 'Guaranteed margin maintained'
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
      calculation_method: 'excel_style_reverse_calculation',
      complexity_multiplier: complexityMultiplier,
      season_multiplier: seasonMultiplier,
      location_multiplier: locationMultiplier,
      calculation_date: new Date().toISOString(),
      roof_area_sq_ft: roofArea,
      guaranteed_margin: true,
      total_percentages: totalPercentages * 100,
      overhead_on_selling_price: true,
      commission_on_selling_price: true
    }
  };
}