import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openWeatherApiKey = Deno.env.get('OPENWEATHER_API_KEY');

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!openWeatherApiKey) {
      throw new Error('OpenWeather API key not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { zipCode, tenantId } = await req.json();

    if (!zipCode || !tenantId) {
      throw new Error('zipCode and tenantId are required');
    }

    console.log(`Analyzing weather risk for ZIP ${zipCode}`);

    // Check cache first
    const { data: cachedWeather } = await supabase
      .from('weather_cache')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('zip_code', zipCode)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cachedWeather) {
      console.log(`Using cached weather data for ZIP ${zipCode}`);
      return new Response(JSON.stringify({
        weatherData: cachedWeather.weather_data,
        riskScore: cachedWeather.risk_score,
        cached: true
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get coordinates from ZIP code using OpenWeather Geocoding API
    const geoResponse = await fetch(
      `https://api.openweathermap.org/geo/1.0/zip?zip=${zipCode},US&appid=${openWeatherApiKey}`
    );

    if (!geoResponse.ok) {
      throw new Error(`Failed to get coordinates for ZIP ${zipCode}`);
    }

    const geoData = await geoResponse.json();
    const { lat, lon } = geoData;

    console.log(`Coordinates for ${zipCode}: ${lat}, ${lon}`);

    // Get 8-day weather forecast using One Call API
    const weatherResponse = await fetch(
      `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,alerts&appid=${openWeatherApiKey}&units=metric`
    );

    if (!weatherResponse.ok) {
      throw new Error(`Failed to get weather data: ${weatherResponse.statusText}`);
    }

    const weatherData = await weatherResponse.json();

    // Calculate weather risk score for next 7-8 days
    const dailyForecasts = weatherData.daily.slice(0, 8);
    let totalRiskScore = 0;
    let riskFactors: string[] = [];

    dailyForecasts.forEach((day: any, index: number) => {
      let dayRisk = 0;
      
      // Precipitation risk (higher = worse for roofing)
      const precipProbability = (day.pop || 0) * 100; // Convert to percentage
      if (precipProbability > 70) {
        dayRisk += 0.4;
        riskFactors.push(`High precipitation probability (${precipProbability.toFixed(0)}%) on day ${index + 1}`);
      } else if (precipProbability > 40) {
        dayRisk += 0.2;
        riskFactors.push(`Moderate precipitation probability (${precipProbability.toFixed(0)}%) on day ${index + 1}`);
      }

      // Wind speed risk (higher = more dangerous for roofing)
      const windSpeed = day.wind_speed || 0; // m/s
      const windSpeedMph = windSpeed * 2.237; // Convert to mph
      if (windSpeedMph > 25) {
        dayRisk += 0.3;
        riskFactors.push(`High wind speed (${windSpeedMph.toFixed(1)} mph) on day ${index + 1}`);
      } else if (windSpeedMph > 15) {
        dayRisk += 0.1;
        riskFactors.push(`Moderate wind speed (${windSpeedMph.toFixed(1)} mph) on day ${index + 1}`);
      }

      // Temperature extremes (very hot or cold can be problematic)
      const tempMax = day.temp.max;
      const tempMin = day.temp.min;
      if (tempMax > 35 || tempMin < -10) { // Celsius
        dayRisk += 0.1;
        riskFactors.push(`Extreme temperature (${tempMax}°C max, ${tempMin}°C min) on day ${index + 1}`);
      }

      totalRiskScore += dayRisk;
    });

    // Normalize risk score to 0-1 scale
    const riskScore = Math.min(totalRiskScore / dailyForecasts.length, 1.0);

    const enrichedWeatherData = {
      ...weatherData,
      riskAnalysis: {
        overallRiskScore: riskScore,
        riskLevel: riskScore > 0.7 ? 'HIGH' : riskScore > 0.4 ? 'MEDIUM' : 'LOW',
        riskFactors,
        dailyRisks: dailyForecasts.map((day: any, index: number) => ({
          date: new Date(day.dt * 1000).toISOString().split('T')[0],
          precipProbability: (day.pop || 0) * 100,
          windSpeedMph: (day.wind_speed || 0) * 2.237,
          tempMax: day.temp.max,
          tempMin: day.temp.min,
          conditions: day.weather[0]?.description || 'Unknown'
        }))
      }
    };

    // Cache the weather data
    await supabase
      .from('weather_cache')
      .upsert({
        tenant_id: tenantId,
        zip_code: zipCode,
        weather_data: enrichedWeatherData,
        risk_score: riskScore,
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() // 6 hours
      });

    console.log(`Weather risk analysis complete for ${zipCode}: ${riskScore.toFixed(2)} (${riskScore > 0.7 ? 'HIGH' : riskScore > 0.4 ? 'MEDIUM' : 'LOW'})`);

    return new Response(JSON.stringify({
      weatherData: enrichedWeatherData,
      riskScore: riskScore,
      cached: false
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in weather-risk-analyzer:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : String(error),
      details: 'Failed to analyze weather risk'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});