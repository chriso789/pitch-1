import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { 
  Cloud, 
  Sun, 
  CloudRain, 
  CloudSnow, 
  Wind, 
  Droplets,
  AlertTriangle,
  ThermometerSun,
  Loader2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface WeatherData {
  date: string;
  temp_high: number;
  temp_low: number;
  precipitation_chance: number;
  precipitation_inches: number;
  wind_speed: number;
  condition: string;
  icon: string;
}

interface WeatherRisk {
  level: "low" | "medium" | "high";
  reasons: string[];
  recommendation: string;
}

interface WeatherOverlayProps {
  latitude: number;
  longitude: number;
  scheduledDate?: string;
  compact?: boolean;
  className?: string;
}

const conditionIcons: Record<string, typeof Sun> = {
  clear: Sun,
  sunny: Sun,
  cloudy: Cloud,
  partly_cloudy: Cloud,
  rain: CloudRain,
  snow: CloudSnow,
  wind: Wind,
};

const riskColors: Record<string, string> = {
  low: "text-green-500 bg-green-500/10 border-green-500/20",
  medium: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  high: "text-red-500 bg-red-500/10 border-red-500/20",
};

export function WeatherOverlay({
  latitude,
  longitude,
  scheduledDate,
  compact = false,
  className,
}: WeatherOverlayProps) {
  const [forecast, setForecast] = useState<WeatherData[]>([]);
  const [risk, setRisk] = useState<WeatherRisk | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (latitude && longitude) {
      fetchWeatherData();
    }
  }, [latitude, longitude]);

  async function fetchWeatherData() {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("weather-forecast", {
        body: { latitude, longitude, days: 7 },
      });

      if (fnError) throw fnError;

      if (data?.forecast) {
        setForecast(data.forecast);
        
        // Calculate risk if scheduled date provided
        if (scheduledDate && data.forecast.length > 0) {
          const dayForecast = data.forecast.find(
            (f: WeatherData) => f.date === scheduledDate
          );
          if (dayForecast) {
            setRisk(calculateRisk(dayForecast));
          }
        }
      }
    } catch (err) {
      console.error("Weather fetch error:", err);
      setError("Unable to load weather data");
    } finally {
      setLoading(false);
    }
  }

  function calculateRisk(day: WeatherData): WeatherRisk {
    const reasons: string[] = [];
    let level: "low" | "medium" | "high" = "low";

    if (day.precipitation_chance > 70) {
      reasons.push(`High precipitation chance (${day.precipitation_chance}%)`);
      level = "high";
    } else if (day.precipitation_chance > 40) {
      reasons.push(`Moderate precipitation chance (${day.precipitation_chance}%)`);
      if (level === "low") level = "medium";
    }

    if (day.wind_speed > 25) {
      reasons.push(`High winds (${day.wind_speed} mph)`);
      level = "high";
    } else if (day.wind_speed > 15) {
      reasons.push(`Moderate winds (${day.wind_speed} mph)`);
      if (level === "low") level = "medium";
    }

    if (day.temp_high > 95 || day.temp_low < 35) {
      reasons.push("Extreme temperatures");
      if (level === "low") level = "medium";
    }

    const recommendations: Record<string, string> = {
      low: "Good conditions for outdoor work",
      medium: "Proceed with caution, monitor conditions",
      high: "Consider rescheduling outdoor work",
    };

    return {
      level,
      reasons: reasons.length > 0 ? reasons : ["Good conditions expected"],
      recommendation: recommendations[level],
    };
  }

  function getWeatherIcon(condition: string) {
    const normalizedCondition = condition.toLowerCase().replace(/\s+/g, "_");
    return conditionIcons[normalizedCondition] || Cloud;
  }

  if (loading) {
    return (
      <div className={cn("space-y-2", className)}>
        <Skeleton className="h-6 w-24" />
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-16" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        {error}
      </div>
    );
  }

  if (compact) {
    // Compact version for inline display
    const today = forecast[0];
    if (!today) return null;

    const Icon = getWeatherIcon(today.condition);

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("inline-flex items-center gap-1.5", className)}>
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{today.temp_high}°</span>
              {today.precipitation_chance > 30 && (
                <span className="text-xs text-blue-500 flex items-center gap-0.5">
                  <Droplets className="h-3 w-3" />
                  {today.precipitation_chance}%
                </span>
              )}
              {risk && risk.level !== "low" && (
                <AlertTriangle className={cn(
                  "h-3 w-3",
                  risk.level === "high" ? "text-red-500" : "text-amber-500"
                )} />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              <p className="font-medium">{today.condition}</p>
              <p>High: {today.temp_high}° / Low: {today.temp_low}°</p>
              <p>Precipitation: {today.precipitation_chance}%</p>
              <p>Wind: {today.wind_speed} mph</p>
              {risk && (
                <p className={cn(
                  "mt-2 pt-2 border-t",
                  risk.level === "high" ? "text-red-400" : 
                  risk.level === "medium" ? "text-amber-400" : "text-green-400"
                )}>
                  {risk.recommendation}
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Full weather card
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ThermometerSun className="h-4 w-4" />
          7-Day Forecast
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Risk alert if applicable */}
        {risk && scheduledDate && (
          <div className={cn(
            "mb-3 p-2 rounded-md border text-sm",
            riskColors[risk.level]
          )}>
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              {risk.level.charAt(0).toUpperCase() + risk.level.slice(1)} Risk
            </div>
            <p className="text-xs mt-1 opacity-90">{risk.recommendation}</p>
          </div>
        )}

        {/* Forecast grid */}
        <div className="grid grid-cols-7 gap-1">
          {forecast.slice(0, 7).map((day) => {
            const Icon = getWeatherIcon(day.condition);
            const isScheduled = day.date === scheduledDate;

            return (
              <div 
                key={day.date}
                className={cn(
                  "flex flex-col items-center p-2 rounded-md text-center",
                  isScheduled && "bg-primary/10 ring-1 ring-primary"
                )}
              >
                <span className="text-xs text-muted-foreground">
                  {format(new Date(day.date), "EEE")}
                </span>
                <Icon className="h-5 w-5 my-1" />
                <span className="text-sm font-medium">{day.temp_high}°</span>
                <span className="text-xs text-muted-foreground">{day.temp_low}°</span>
                {day.precipitation_chance > 20 && (
                  <span className="text-xs text-blue-500 flex items-center gap-0.5">
                    <Droplets className="h-2 w-2" />
                    {day.precipitation_chance}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
