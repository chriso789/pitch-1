import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const OPENWEATHER_API_KEY = Deno.env.get('OPENWEATHER_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface WeatherCondition {
  temp: number;
  feels_like: number;
  humidity: number;
  wind_speed: number;
  wind_gust?: number;
  description: string;
  icon: string;
  rain_chance: number;
  snow_chance: number;
}

interface DailyForecast {
  date: string;
  day_name: string;
  temp_high: number;
  temp_low: number;
  condition: string;
  icon: string;
  rain_chance: number;
  wind_speed: number;
  is_work_safe: boolean;
  risk_level: 'low' | 'medium' | 'high';
  risk_reasons: string[];
}

function assessWorkSafety(forecast: any): { is_safe: boolean; risk_level: 'low' | 'medium' | 'high'; reasons: string[] } {
  const reasons: string[] = [];
  let riskScore = 0;

  // Rain check
  const rainChance = forecast.pop * 100 || 0;
  if (rainChance > 70) {
    reasons.push(`High rain chance (${Math.round(rainChance)}%)`);
    riskScore += 3;
  } else if (rainChance > 40) {
    reasons.push(`Moderate rain chance (${Math.round(rainChance)}%)`);
    riskScore += 1;
  }

  // Wind check
  const windSpeed = forecast.wind_speed || 0;
  if (windSpeed > 25) {
    reasons.push(`High winds (${Math.round(windSpeed)} mph)`);
    riskScore += 3;
  } else if (windSpeed > 15) {
    reasons.push(`Moderate winds (${Math.round(windSpeed)} mph)`);
    riskScore += 1;
  }

  // Temperature check
  const tempHigh = forecast.temp?.max || forecast.temp?.day || 0;
  const tempLow = forecast.temp?.min || forecast.temp?.night || 0;
  if (tempHigh > 95) {
    reasons.push(`Extreme heat (${Math.round(tempHigh)}°F)`);
    riskScore += 2;
  } else if (tempLow < 32) {
    reasons.push(`Freezing temperatures (${Math.round(tempLow)}°F)`);
    riskScore += 2;
  }

  // Snow check
  if (forecast.snow) {
    reasons.push('Snow expected');
    riskScore += 3;
  }

  const riskLevel = riskScore >= 3 ? 'high' : riskScore >= 1 ? 'medium' : 'low';
  const is_safe = riskScore < 3;

  return { is_safe, risk_level: riskLevel, reasons };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!OPENWEATHER_API_KEY) {
      throw new Error('OpenWeather API key not configured');
    }

    const { latitude, longitude, project_id } = await req.json();

    if (!latitude || !longitude) {
      throw new Error('Latitude and longitude are required');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const locationKey = `${latitude.toFixed(4)}_${longitude.toFixed(4)}`;

    // Check cache first (1 hour cache)
    const { data: cached } = await supabase
      .from('weather_cache')
      .select('*')
      .eq('location_key', locationKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached) {
      console.log('Returning cached weather data');
      return new Response(JSON.stringify({
        success: true,
        cached: true,
        current: cached.current_conditions,
        forecast: cached.forecast_data,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch from OpenWeather One Call API
    const weatherUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${latitude}&lon=${longitude}&exclude=minutely,hourly&units=imperial&appid=${OPENWEATHER_API_KEY}`;
    
    const weatherResponse = await fetch(weatherUrl);
    if (!weatherResponse.ok) {
      // Fallback to 2.5 API if 3.0 fails
      const fallbackUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${latitude}&lon=${longitude}&units=imperial&appid=${OPENWEATHER_API_KEY}`;
      const fallbackResponse = await fetch(fallbackUrl);
      
      if (!fallbackResponse.ok) {
        throw new Error(`Weather API error: ${fallbackResponse.statusText}`);
      }
      
      const fallbackData = await fallbackResponse.json();
      
      // Process 2.5 API data
      const dailyMap = new Map<string, any>();
      fallbackData.list.forEach((item: any) => {
        const date = item.dt_txt.split(' ')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, item);
        }
      });

      const forecast: DailyForecast[] = Array.from(dailyMap.values()).slice(0, 7).map((day: any) => {
        const date = new Date(day.dt * 1000);
        const safety = assessWorkSafety({
          pop: day.pop,
          wind_speed: day.wind?.speed || 0,
          temp: { max: day.main.temp_max, min: day.main.temp_min },
          snow: day.snow,
        });

        return {
          date: date.toISOString().split('T')[0],
          day_name: date.toLocaleDateString('en-US', { weekday: 'short' }),
          temp_high: Math.round(day.main.temp_max),
          temp_low: Math.round(day.main.temp_min),
          condition: day.weather[0].main,
          icon: day.weather[0].icon,
          rain_chance: Math.round((day.pop || 0) * 100),
          wind_speed: Math.round(day.wind?.speed || 0),
          is_work_safe: safety.is_safe,
          risk_level: safety.risk_level,
          risk_reasons: safety.reasons,
        };
      });

      const current = fallbackData.list[0];
      const currentConditions: WeatherCondition = {
        temp: Math.round(current.main.temp),
        feels_like: Math.round(current.main.feels_like),
        humidity: current.main.humidity,
        wind_speed: Math.round(current.wind?.speed || 0),
        wind_gust: current.wind?.gust ? Math.round(current.wind.gust) : undefined,
        description: current.weather[0].description,
        icon: current.weather[0].icon,
        rain_chance: Math.round((current.pop || 0) * 100),
        snow_chance: current.snow ? 100 : 0,
      };

      // Cache the result
      await supabase.from('weather_cache').upsert({
        location_key: locationKey,
        latitude,
        longitude,
        forecast_data: forecast,
        current_conditions: currentConditions,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      return new Response(JSON.stringify({
        success: true,
        cached: false,
        current: currentConditions,
        forecast,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const weatherData = await weatherResponse.json();

    // Process current conditions
    const currentConditions: WeatherCondition = {
      temp: Math.round(weatherData.current.temp),
      feels_like: Math.round(weatherData.current.feels_like),
      humidity: weatherData.current.humidity,
      wind_speed: Math.round(weatherData.current.wind_speed),
      wind_gust: weatherData.current.wind_gust ? Math.round(weatherData.current.wind_gust) : undefined,
      description: weatherData.current.weather[0].description,
      icon: weatherData.current.weather[0].icon,
      rain_chance: weatherData.daily?.[0]?.pop ? Math.round(weatherData.daily[0].pop * 100) : 0,
      snow_chance: weatherData.current.snow ? 100 : 0,
    };

    // Process 7-day forecast
    const forecast: DailyForecast[] = weatherData.daily.slice(0, 7).map((day: any) => {
      const date = new Date(day.dt * 1000);
      const safety = assessWorkSafety(day);

      return {
        date: date.toISOString().split('T')[0],
        day_name: date.toLocaleDateString('en-US', { weekday: 'short' }),
        temp_high: Math.round(day.temp.max),
        temp_low: Math.round(day.temp.min),
        condition: day.weather[0].main,
        icon: day.weather[0].icon,
        rain_chance: Math.round((day.pop || 0) * 100),
        wind_speed: Math.round(day.wind_speed),
        is_work_safe: safety.is_safe,
        risk_level: safety.risk_level,
        risk_reasons: safety.reasons,
      };
    });

    // Cache the result (1 hour)
    await supabase.from('weather_cache').upsert({
      location_key: locationKey,
      latitude,
      longitude,
      forecast_data: forecast,
      current_conditions: currentConditions,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    // Create weather alerts if needed for the project
    if (project_id) {
      const authHeader = req.headers.get('Authorization');
      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('tenant_id')
            .eq('id', user.id)
            .single();

          if (profile?.tenant_id) {
            const unsafeDays = forecast.filter(day => !day.is_work_safe);
            
            for (const day of unsafeDays) {
              await supabase.from('production_weather_alerts').upsert({
                tenant_id: profile.tenant_id,
                project_id,
                alert_type: 'weather_risk',
                severity: day.risk_level === 'high' ? 'critical' : 'medium',
                message: `${day.day_name}: ${day.risk_reasons.join(', ')}`,
                weather_data: day,
              }, {
                onConflict: 'project_id,created_at',
                ignoreDuplicates: true,
              });
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      cached: false,
      current: currentConditions,
      forecast,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Weather forecast error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to fetch weather data',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});