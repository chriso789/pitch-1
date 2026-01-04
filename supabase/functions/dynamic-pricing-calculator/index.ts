// Remove xhr import - not needed and causes deployment issues
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PricingRequest {
  tenantId: string;
  estimateId?: string;
  baseCost: number;
  laborCost: number;
  zipCode: string;
  season?: string;
  backlogDays?: number;
  vendorLeadtimeDays?: number;
  weatherRiskScore?: number;
  conversionRatePercent?: number;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const pricingRequest: PricingRequest = await req.json();

    const {
      tenantId,
      estimateId,
      baseCost,
      laborCost,
      zipCode,
      season,
      backlogDays = 0,
      vendorLeadtimeDays = 0,
      weatherRiskScore,
      conversionRatePercent
    } = pricingRequest;

    console.log(`Calculating dynamic pricing for tenant ${tenantId}, ZIP ${zipCode}`);

    // Validate required fields - use explicit checks to allow 0 values
    if (!tenantId || baseCost === undefined || laborCost === undefined || !zipCode) {
      throw new Error('tenantId, baseCost, laborCost, and zipCode are required');
    }

    // Get pricing configuration
    const { data: config, error: configError } = await supabase
      .from('dynamic_pricing_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle();

    if (configError) {
      throw new Error(`Failed to get pricing config: ${configError.message}`);
    }

    if (!config) {
      throw new Error('No active pricing configuration found for tenant');
    }

    // Get weather data if not provided - use supabase.functions.invoke instead of direct HTTP
    let finalWeatherRiskScore = weatherRiskScore || 0;
    let weatherData = null;

    if (weatherRiskScore === undefined && zipCode) {
      try {
        const { data: weatherResult, error: weatherError } = await supabase.functions.invoke('weather-risk-analyzer', {
          body: { zipCode, tenantId }
        });

        if (!weatherError && weatherResult) {
          finalWeatherRiskScore = weatherResult.riskScore || 0;
          weatherData = weatherResult.weatherData;
        } else if (weatherError) {
          console.warn(`Weather function error: ${weatherError.message}`);
        }
      } catch (error) {
        console.warn(`Failed to get weather data: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Determine season if not provided
    const currentSeason = season || getCurrentSeason();

    // Calculate base markup
    let finalMarkupPercent = config.base_markup_percent;
    let adjustments: any = {
      weather: 0,
      backlog: 0,
      season: 0,
      leadtime: 0,
      total: 0
    };

    let rationale: string[] = [];
    rationale.push(`Base markup: ${config.base_markup_percent}%`);

    // Weather risk adjustment
    if (finalWeatherRiskScore > 0) {
      const weatherMultiplier = config.weather_risk_multiplier || 1.15;
      const weatherAdjustment = (weatherMultiplier - 1) * finalWeatherRiskScore * 100;
      adjustments.weather = weatherAdjustment;
      finalMarkupPercent += weatherAdjustment;
      
      const riskLevel = finalWeatherRiskScore > 0.7 ? 'HIGH' : finalWeatherRiskScore > 0.4 ? 'MEDIUM' : 'LOW';
      rationale.push(`Weather risk adjustment: +${weatherAdjustment.toFixed(1)}% (${riskLevel} risk: ${(finalWeatherRiskScore * 100).toFixed(0)}%)`);
    }

    // Backlog adjustment
    if (backlogDays > 0) {
      const backlogMultiplier = config.backlog_multiplier || 1.10;
      const backlogAdjustment = Math.min((backlogMultiplier - 1) * (backlogDays / 30) * 100, 10); // Cap at 10%
      adjustments.backlog = backlogAdjustment;
      finalMarkupPercent += backlogAdjustment;
      rationale.push(`Backlog adjustment: +${backlogAdjustment.toFixed(1)}% (${backlogDays} days backlog)`);
    }

    // Seasonal adjustment
    const seasonMultipliers = config.season_multipliers || {};
    const seasonMultiplier = seasonMultipliers[currentSeason.toLowerCase()] || 1.0;
    if (seasonMultiplier !== 1.0) {
      const seasonAdjustment = (seasonMultiplier - 1) * 100;
      adjustments.season = seasonAdjustment;
      finalMarkupPercent += seasonAdjustment;
      rationale.push(`Seasonal adjustment (${currentSeason}): ${seasonAdjustment > 0 ? '+' : ''}${seasonAdjustment.toFixed(1)}%`);
    }

    // Vendor leadtime adjustment
    if (vendorLeadtimeDays > 0) {
      const leadtimeMultipliers = config.vendor_leadtime_multipliers || {};
      // Use a simple linear adjustment if no specific multipliers are configured
      const leadtimeAdjustment = Math.min(vendorLeadtimeDays * 0.1, 5); // 0.1% per day, max 5%
      adjustments.leadtime = leadtimeAdjustment;
      finalMarkupPercent += leadtimeAdjustment;
      rationale.push(`Leadtime adjustment: +${leadtimeAdjustment.toFixed(1)}% (${vendorLeadtimeDays} days leadtime)`);
    }

    // Apply min/max constraints
    finalMarkupPercent = Math.max(config.min_margin_percent, Math.min(config.max_margin_percent, finalMarkupPercent));

    if (finalMarkupPercent === config.min_margin_percent) {
      rationale.push(`⚠️ Constrained to minimum margin: ${config.min_margin_percent}%`);
    } else if (finalMarkupPercent === config.max_margin_percent) {
      rationale.push(`⚠️ Constrained to maximum margin: ${config.max_margin_percent}%`);
    }

    // Calculate suggested price
    const totalCost = baseCost + laborCost;
    const markupAmount = totalCost * (finalMarkupPercent / 100);
    const suggestedPrice = totalCost + markupAmount;

    // Calculate total adjustment
    adjustments.total = finalMarkupPercent - config.base_markup_percent;

    // Anomaly detection
    let anomalyWarnings: string[] = [];
    
    // Check for large price changes (if we have historical data)
    if (adjustments.total > config.price_anomaly_threshold_percent) {
      anomalyWarnings.push(`Large markup adjustment detected: +${adjustments.total.toFixed(1)}% (threshold: ${config.price_anomaly_threshold_percent}%)`);
    }

    // Log the calculation
    const calculationRecord = {
      tenant_id: tenantId,
      estimate_id: estimateId,
      base_cost: baseCost,
      labor_cost: laborCost,
      zip_code: zipCode,
      season: currentSeason,
      weather_risk_score: finalWeatherRiskScore,
      backlog_days: backlogDays,
      vendor_leadtime_days: vendorLeadtimeDays,
      conversion_rate_percent: conversionRatePercent,
      base_markup_percent: config.base_markup_percent,
      weather_adjustment: adjustments.weather,
      backlog_adjustment: adjustments.backlog,
      season_adjustment: adjustments.season,
      leadtime_adjustment: adjustments.leadtime,
      final_markup_percent: finalMarkupPercent,
      suggested_price: suggestedPrice,
      rationale: {
        factors: rationale,
        adjustments,
        anomalyWarnings,
        totalCost,
        markupAmount
      },
      weather_data: weatherData,
      calculated_by: null // Will be set by the client
    };

    const { data: calculation, error: calcError } = await supabase
      .from('pricing_calculations')
      .insert(calculationRecord)
      .select('*')
      .single();

    if (calcError) {
      console.warn(`Failed to log calculation: ${calcError.message}`);
    }

    console.log(`Dynamic pricing calculation complete: ${suggestedPrice.toFixed(2)} (${finalMarkupPercent.toFixed(1)}% markup)`);

    const response = {
      calculationId: calculation?.id,
      suggestedPrice: Math.round(suggestedPrice * 100) / 100, // Round to cents
      finalMarkupPercent: Math.round(finalMarkupPercent * 100) / 100,
      totalCost,
      markupAmount: Math.round(markupAmount * 100) / 100,
      rationale: {
        summary: `Suggested price: $${Math.round(suggestedPrice * 100) / 100} (${finalMarkupPercent.toFixed(1)}% markup)`,
        factors: rationale,
        adjustments,
        anomalyWarnings,
        weatherRiskScore: finalWeatherRiskScore,
        season: currentSeason
      },
      config: {
        minMargin: config.min_margin_percent,
        maxMargin: config.max_margin_percent,
        baseMarkup: config.base_markup_percent
      }
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in dynamic-pricing-calculator:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : String(error),
      details: 'Failed to calculate dynamic pricing'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function getCurrentSeason(): string {
  const month = new Date().getMonth() + 1; // 1-12
  
  if (month >= 3 && month <= 5) {
    return 'spring';
  } else if (month >= 6 && month <= 8) {
    return 'summer';
  } else if (month >= 9 && month <= 11) {
    return 'fall';
  } else {
    return 'winter';
  }
}
