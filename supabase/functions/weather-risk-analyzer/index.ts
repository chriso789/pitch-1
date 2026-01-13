import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

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

    const supabase = supabaseService();
    const { latitude, longitude, zipCode, tenantId, projectId, scheduledDates } = await req.json();

    // Accept either coordinates or zipCode, prefer coordinates
    let lat, lon, finalZipCode;
    
    if (latitude && longitude) {
      lat = latitude;
      lon = longitude;
      
      // Convert coordinates to ZIP code for caching
      try {
        const reverseGeoResponse = await fetch(
          `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${openWeatherApiKey}`
        );
        if (reverseGeoResponse.ok) {
          const reverseGeoData = await reverseGeoResponse.json();
          if (reverseGeoData[0]?.zip) {
            finalZipCode = reverseGeoData[0].zip;
          } else {
            // Fallback: use coordinates as cache key
            finalZipCode = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
          }
        } else {
          finalZipCode = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
        }
      } catch (error) {
        console.warn('Failed to get ZIP from coordinates, using coordinate string:', error);
        finalZipCode = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
      }
    } else if (zipCode) {
      finalZipCode = zipCode;
      // Get coordinates from ZIP code
      const geoResponse = await fetch(
        `https://api.openweathermap.org/geo/1.0/zip?zip=${zipCode},US&appid=${openWeatherApiKey}`
      );

      if (!geoResponse.ok) {
        throw new Error(`Failed to get coordinates for ZIP ${zipCode}`);
      }

      const geoData = await geoResponse.json();
      lat = geoData.lat;
      lon = geoData.lon;
    } else {
      throw new Error('Either coordinates (latitude, longitude) or zipCode is required');
    }

    const currentTenantId = tenantId || projectId || 'default';

    console.log(`Analyzing weather risk for coordinates ${lat}, ${lon} (cache key: ${finalZipCode})`);

    // Check cache first
    const { data: cachedWeather } = await supabase
      .from('weather_cache')
      .select('*')
      .eq('tenant_id', currentTenantId)
      .eq('zip_code', finalZipCode)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cachedWeather) {
      console.log(`Using cached weather data for cache key ${finalZipCode}`);
      return new Response(JSON.stringify({
        weather: cachedWeather.weather_data,
        riskScore: cachedWeather.risk_score,
        cached: true
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Fetching weather data for coordinates: ${lat}, ${lon}`);

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

    // Transform data to match WeatherRiskAnalyzer component expectations
    const transformedWeatherData = {
      location: `${lat}, ${lon}`,
      current: {
        temperature: Math.round((weatherData.current.temp - 273.15) * 9/5 + 32), // Convert K to F
        condition: weatherData.current.weather[0]?.description || 'Unknown',
        humidity: weatherData.current.humidity,
        windSpeed: Math.round(weatherData.current.wind_speed * 2.237), // m/s to mph
        visibility: weatherData.current.visibility ? Math.round(weatherData.current.visibility * 0.000621371) : 10, // m to miles
        precipitationChance: Math.round((weatherData.hourly[0]?.pop || 0) * 100)
      },
      forecast: dailyForecasts.map((day: any, index: number) => {
        const precipProb = (day.pop || 0) * 100;
        const windSpeedMph = (day.wind_speed || 0) * 2.237;
        let dayRisk = 0;
        const dayRiskFactors = [];
        
        if (precipProb > 70) {
          dayRisk += 0.4;
          dayRiskFactors.push(`High precipitation (${precipProb.toFixed(0)}%)`);
        } else if (precipProb > 40) {
          dayRisk += 0.2;
          dayRiskFactors.push(`Moderate precipitation (${precipProb.toFixed(0)}%)`);
        }
        
        if (windSpeedMph > 25) {
          dayRisk += 0.3;
          dayRiskFactors.push(`High wind speed (${windSpeedMph.toFixed(1)} mph)`);
        } else if (windSpeedMph > 15) {
          dayRisk += 0.1;
          dayRiskFactors.push(`Moderate wind speed (${windSpeedMph.toFixed(1)} mph)`);
        }
        
        const tempMaxF = Math.round((day.temp.max - 273.15) * 9/5 + 32);
        const tempMinF = Math.round((day.temp.min - 273.15) * 9/5 + 32);
        
        if (tempMaxF > 95 || tempMinF < 14) { // Very hot or very cold
          dayRisk += 0.1;
          dayRiskFactors.push(`Extreme temperature (${tempMaxF}°F/${tempMinF}°F)`);
        }
        
        const riskLevel = dayRisk > 0.7 ? 'extreme' : dayRisk > 0.4 ? 'high' : dayRisk > 0.2 ? 'medium' : 'low';
        
        return {
          date: new Date(day.dt * 1000).toISOString().split('T')[0],
          temperature: {
            high: tempMaxF,
            low: tempMinF
          },
          condition: day.weather[0]?.description || 'Unknown',
          precipitationChance: Math.round(precipProb),
          windSpeed: Math.round(windSpeedMph),
          workable: dayRisk < 0.5 && precipProb < 60 && windSpeedMph < 20,
          riskLevel,
          riskFactors: dayRiskFactors
        };
      }),
      alerts: weatherData.alerts || []
    };

    // Cache the weather data
    await supabase
      .from('weather_cache')
      .upsert({
        tenant_id: currentTenantId,
        zip_code: finalZipCode,
        weather_data: transformedWeatherData,
        risk_score: riskScore,
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() // 6 hours
      });

    console.log(`Weather risk analysis complete for ${finalZipCode}: ${riskScore.toFixed(2)} (${riskScore > 0.7 ? 'HIGH' : riskScore > 0.4 ? 'MEDIUM' : 'LOW'})`);

    return new Response(JSON.stringify({
      weather: transformedWeatherData,
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