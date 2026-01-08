import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { Cloud, CloudRain, CloudSnow, Sun, Wind, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface WeatherData {
  current: {
    temp: number;
    description: string;
    wind_speed: number;
    rain_chance: number;
  };
  forecast: DailyForecast[];
}

interface CalendarWeatherOverlayProps {
  latitude?: number;
  longitude?: number;
  date: Date;
  compact?: boolean;
  showRiskBadge?: boolean;
}

const getWeatherIcon = (condition: string) => {
  const lower = condition.toLowerCase();
  if (lower.includes('rain') || lower.includes('storm') || lower.includes('drizzle')) {
    return <CloudRain className="h-4 w-4" />;
  } else if (lower.includes('snow') || lower.includes('sleet')) {
    return <CloudSnow className="h-4 w-4" />;
  } else if (lower.includes('cloud') || lower.includes('overcast')) {
    return <Cloud className="h-4 w-4" />;
  } else {
    return <Sun className="h-4 w-4" />;
  }
};

const getRiskColor = (riskLevel: string) => {
  switch (riskLevel) {
    case 'high':
      return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'medium':
      return 'bg-warning/10 text-warning-foreground border-warning/30';
    case 'low':
      return 'bg-green-500/10 text-green-700 border-green-500/30';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

export const CalendarWeatherOverlay: React.FC<CalendarWeatherOverlayProps> = ({
  latitude,
  longitude,
  date,
  compact = false,
  showRiskBadge = true,
}) => {
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (latitude && longitude) {
      fetchWeather();
    }
  }, [latitude, longitude]);

  const fetchWeather = async () => {
    if (!latitude || !longitude) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('weather-forecast', {
        body: { latitude, longitude },
      });

      if (invokeError) throw invokeError;

      if (data.success) {
        setWeatherData({
          current: data.current,
          forecast: data.forecast,
        });
      } else {
        setError(data.error || 'Failed to fetch weather');
      }
    } catch (err: any) {
      console.error('Weather fetch error:', err);
      setError(err.message || 'Weather unavailable');
    } finally {
      setLoading(false);
    }
  };

  // Find forecast for the specific date
  const dateStr = date.toISOString().split('T')[0];
  const dayForecast = weatherData?.forecast.find((f) => f.date === dateStr);

  if (loading) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground text-xs">
        <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !dayForecast) {
    return null; // Silently fail - weather is optional
  }

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border',
                getRiskColor(dayForecast.risk_level)
              )}
            >
              {getWeatherIcon(dayForecast.condition)}
              <span>{dayForecast.temp_high}°</span>
              {dayForecast.risk_level === 'high' && (
                <AlertTriangle className="h-3 w-3" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="space-y-2">
              <div className="font-medium">{dayForecast.condition}</div>
              <div className="text-xs space-y-1">
                <div className="flex justify-between gap-4">
                  <span>High / Low</span>
                  <span>{dayForecast.temp_high}° / {dayForecast.temp_low}°</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Rain Chance</span>
                  <span>{dayForecast.rain_chance}%</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Wind</span>
                  <span>{dayForecast.wind_speed} mph</span>
                </div>
              </div>
              {dayForecast.risk_reasons.length > 0 && (
                <div className="pt-2 border-t">
                  <div className="font-medium text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Work Risks:
                  </div>
                  <ul className="text-xs mt-1 space-y-0.5">
                    {dayForecast.risk_reasons.map((reason, i) => (
                      <li key={i}>• {reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className={cn('flex items-center gap-2 p-2 rounded-md border', getRiskColor(dayForecast.risk_level))}>
      <div className="flex items-center gap-1">
        {getWeatherIcon(dayForecast.condition)}
        <span className="text-sm font-medium">{dayForecast.temp_high}°F</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {dayForecast.condition}
      </div>
      {showRiskBadge && !dayForecast.is_work_safe && (
        <Badge variant="destructive" className="text-xs gap-1">
          <AlertTriangle className="h-3 w-3" />
          {dayForecast.risk_level === 'high' ? 'Not Safe' : 'Caution'}
        </Badge>
      )}
      {dayForecast.rain_chance > 30 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <CloudRain className="h-3 w-3" />
          {dayForecast.rain_chance}%
        </div>
      )}
      {dayForecast.wind_speed > 15 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Wind className="h-3 w-3" />
          {dayForecast.wind_speed}mph
        </div>
      )}
    </div>
  );
};

export default CalendarWeatherOverlay;
