import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Cloud,
  CloudRain,
  CloudSnow,
  Sun,
  Wind,
  Thermometer,
  Droplets,
  AlertTriangle,
  RefreshCw,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface WeatherWidgetProps {
  latitude?: number;
  longitude?: number;
  projectId?: string;
  compact?: boolean;
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

interface CurrentConditions {
  temp: number;
  feels_like: number;
  humidity: number;
  wind_speed: number;
  wind_gust?: number;
  description: string;
  icon: string;
  rain_chance: number;
}

const getWeatherIcon = (condition: string) => {
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('drizzle')) return CloudRain;
  if (c.includes('snow')) return CloudSnow;
  if (c.includes('cloud')) return Cloud;
  if (c.includes('wind')) return Wind;
  return Sun;
};

const getRiskColor = (level: 'low' | 'medium' | 'high') => {
  switch (level) {
    case 'high': return 'bg-destructive/10 text-destructive border-destructive/20';
    case 'medium': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    default: return 'bg-green-500/10 text-green-600 border-green-500/20';
  }
};

export const WeatherWidget: React.FC<WeatherWidgetProps> = ({
  latitude = 27.9506,
  longitude = -82.4572, // Default to Tampa, FL
  projectId,
  compact = false,
}) => {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['weather-forecast', latitude, longitude],
    queryFn: async () => {
      const { data: response, error } = await supabase.functions.invoke('weather-forecast', {
        body: { latitude, longitude, project_id: projectId },
      });
      if (error) throw error;
      if (!response.success) throw new Error(response.error);
      return response as {
        current: CurrentConditions;
        forecast: DailyForecast[];
        cached: boolean;
      };
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="space-y-3">
          <Skeleton className="h-6 w-32" />
          <div className="flex gap-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-16" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Cloud className="h-5 w-5" />
            <span className="text-sm">Weather unavailable</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    );
  }

  const current = data?.current;
  const forecast = data?.forecast || [];
  const unsafeDays = forecast.filter(d => !d.is_work_safe).length;
  const CurrentWeatherIcon = current ? getWeatherIcon(current.description) : Sun;

  if (compact) {
    return (
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <CurrentWeatherIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold">{current?.temp}°F</span>
                {unsafeDays > 0 && (
                  <Badge variant="outline" className={getRiskColor('high')}>
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {unsafeDays} risky day{unsafeDays > 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground capitalize">{current?.description}</p>
            </div>
          </div>
          <div className="flex gap-1">
            {forecast.slice(0, 3).map((day) => (
              <div
                key={day.date}
                className={cn(
                  'text-center p-1.5 rounded border',
                  day.is_work_safe ? 'bg-green-500/5 border-green-500/20' : 'bg-destructive/5 border-destructive/20'
                )}
              >
                <p className="text-xs font-medium">{day.day_name}</p>
                <p className="text-xs">{day.temp_high}°</p>
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CurrentWeatherIcon className="h-5 w-5 text-primary" />
          <span className="font-semibold">7-Day Production Forecast</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        </Button>
      </div>

      {/* Current Conditions */}
      {current && (
        <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
          <div className="p-3 rounded-xl bg-primary/10">
            <CurrentWeatherIcon className="h-8 w-8 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{current.temp}°F</span>
              <span className="text-sm text-muted-foreground">
                Feels like {current.feels_like}°
              </span>
            </div>
            <p className="text-sm text-muted-foreground capitalize">{current.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-1.5">
              <Wind className="h-4 w-4 text-muted-foreground" />
              <span>{current.wind_speed} mph</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Droplets className="h-4 w-4 text-muted-foreground" />
              <span>{current.humidity}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CloudRain className="h-4 w-4 text-muted-foreground" />
              <span>{current.rain_chance}%</span>
            </div>
            {current.wind_gust && (
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <span>Gusts {current.wind_gust}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Work Safety Summary */}
      {unsafeDays > 0 && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <div className="flex-1">
            <p className="text-sm font-medium text-destructive">
              {unsafeDays} day{unsafeDays > 1 ? 's' : ''} with weather risks this week
            </p>
            <p className="text-xs text-muted-foreground">
              Consider rescheduling outdoor work
            </p>
          </div>
        </div>
      )}

      {/* 7-Day Forecast */}
      <div className="grid grid-cols-7 gap-1">
        {forecast.map((day) => {
          const DayIcon = getWeatherIcon(day.condition);
          return (
            <div
              key={day.date}
              className={cn(
                'text-center p-2 rounded-lg border transition-colors',
                day.is_work_safe
                  ? 'bg-green-500/5 border-green-500/20 hover:bg-green-500/10'
                  : 'bg-destructive/5 border-destructive/20 hover:bg-destructive/10'
              )}
            >
              <p className="text-xs font-medium mb-1">{day.day_name}</p>
              <DayIcon className={cn(
                'h-5 w-5 mx-auto mb-1',
                day.is_work_safe ? 'text-green-600' : 'text-destructive'
              )} />
              <p className="text-sm font-semibold">{day.temp_high}°</p>
              <p className="text-xs text-muted-foreground">{day.temp_low}°</p>
              <div className="mt-1">
                {day.is_work_safe ? (
                  <CheckCircle className="h-3 w-3 mx-auto text-green-600" />
                ) : (
                  <XCircle className="h-3 w-3 mx-auto text-destructive" />
                )}
              </div>
              {day.rain_chance > 30 && (
                <p className="text-xs text-blue-500 mt-1">{day.rain_chance}%</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Risk Details */}
      {forecast.filter(d => d.risk_reasons.length > 0).slice(0, 2).map((day) => (
        <div
          key={`risk-${day.date}`}
          className={cn('p-2 rounded border text-sm', getRiskColor(day.risk_level))}
        >
          <span className="font-medium">{day.day_name}:</span>{' '}
          <span>{day.risk_reasons.join(', ')}</span>
        </div>
      ))}
    </Card>
  );
};