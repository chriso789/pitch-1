import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Cloud, 
  CloudRain, 
  CloudSnow, 
  Sun, 
  Wind, 
  Thermometer,
  AlertTriangle,
  Calendar,
  Clock,
  MapPin
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface WeatherData {
  location: string;
  current: {
    temperature: number;
    condition: string;
    humidity: number;
    windSpeed: number;
    visibility: number;
    precipitationChance: number;
  };
  forecast: Array<{
    date: string;
    temperature: { high: number; low: number };
    condition: string;
    precipitationChance: number;
    windSpeed: number;
    workable: boolean;
    riskLevel: 'low' | 'medium' | 'high' | 'extreme';
    riskFactors: string[];
  }>;
  alerts: Array<{
    type: string;
    severity: string;
    description: string;
    startTime: string;
    endTime: string;
  }>;
}

interface WeatherRiskAnalyzerProps {
  projectId?: string;
  latitude: number;
  longitude: number;
  scheduledDates?: string[];
  onRiskAssessment?: (assessment: any) => void;
}

export const WeatherRiskAnalyzer: React.FC<WeatherRiskAnalyzerProps> = ({
  projectId,
  latitude,
  longitude,
  scheduledDates = [],
  onRiskAssessment
}) => {
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (latitude && longitude) {
      fetchWeatherData();
    }
  }, [latitude, longitude]);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchWeatherData, 30 * 60 * 1000); // 30 minutes
      return () => clearInterval(interval);
    }
  }, [autoRefresh, latitude, longitude]);

  const fetchWeatherData = async () => {
    if (!latitude || !longitude) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('weather-risk-analyzer', {
        body: {
          latitude,
          longitude,
          scheduledDates,
          projectId
        }
      });

      if (error) throw error;

      setWeatherData(data.weather);
      
      // Calculate risk assessment
      const assessment = calculateRiskAssessment(data.weather);
      onRiskAssessment?.(assessment);

      // Show high-risk alerts
      if (assessment.highRiskDays > 0) {
        toast({
          title: "Weather Risk Alert",
          description: `${assessment.highRiskDays} scheduled day(s) have high weather risk`,
          variant: "destructive",
        });
      }

    } catch (error: any) {
      console.error('Weather fetch error:', error);
      toast({
        title: "Weather Data Error",
        description: error.message || "Failed to fetch weather data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const calculateRiskAssessment = (weather: WeatherData) => {
    const highRiskDays = weather.forecast.filter(day => 
      day.riskLevel === 'high' || day.riskLevel === 'extreme'
    ).length;
    
    const workableDays = weather.forecast.filter(day => day.workable).length;
    
    const activeAlerts = weather.alerts.filter(alert => 
      new Date(alert.endTime) > new Date()
    );

    return {
      highRiskDays,
      workableDays,
      totalDays: weather.forecast.length,
      workabilityPercentage: Math.round((workableDays / weather.forecast.length) * 100),
      activeAlerts: activeAlerts.length,
      recommendation: highRiskDays > 2 ? 'postpone' : highRiskDays > 0 ? 'caution' : 'proceed'
    };
  };

  const getWeatherIcon = (condition: string) => {
    const lower = condition.toLowerCase();
    if (lower.includes('rain') || lower.includes('storm')) {
      return <CloudRain className="h-5 w-5" />;
    } else if (lower.includes('snow')) {
      return <CloudSnow className="h-5 w-5" />;
    } else if (lower.includes('cloud')) {
      return <Cloud className="h-5 w-5" />;
    } else {
      return <Sun className="h-5 w-5" />;
    }
  };

  const getRiskBadge = (riskLevel: string) => {
    switch (riskLevel) {
      case 'low':
        return <Badge variant="default" className="bg-green-100 text-green-800">Low Risk</Badge>;
      case 'medium':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Medium Risk</Badge>;
      case 'high':
        return <Badge variant="destructive" className="bg-orange-100 text-orange-800">High Risk</Badge>;
      case 'extreme':
        return <Badge variant="destructive">Extreme Risk</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const handlePauseProduction = async () => {
    if (!projectId) return;

    try {
      const { error } = await supabase.functions.invoke('production-workflow-manager', {
        body: {
          action: 'pause_weather',
          projectId,
          reason: 'Adverse weather conditions detected'
        }
      });

      if (error) throw error;

      toast({
        title: "Production Paused",
        description: "Production workflow has been paused due to weather conditions",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to pause production",
        variant: "destructive",
      });
    }
  };

  if (!weatherData && !loading) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground">Weather data unavailable</p>
          <Button onClick={fetchWeatherData} variant="outline" className="mt-2">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current Conditions */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Current Weather
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchWeatherData}
              disabled={loading}
            >
              {loading ? 'Updating...' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {weatherData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-2">
                {getWeatherIcon(weatherData.current.condition)}
                <div>
                  <p className="text-sm text-muted-foreground">Condition</p>
                  <p className="font-medium">{weatherData.current.condition}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Thermometer className="h-5 w-5 text-orange-500" />
                <div>
                  <p className="text-sm text-muted-foreground">Temperature</p>
                  <p className="font-medium">{weatherData.current.temperature}°F</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Wind className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-sm text-muted-foreground">Wind Speed</p>
                  <p className="font-medium">{weatherData.current.windSpeed} mph</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <CloudRain className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Rain Chance</p>
                  <p className="font-medium">{weatherData.current.precipitationChance}%</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weather Alerts */}
      {weatherData?.alerts && weatherData.alerts.length > 0 && (
        <div className="space-y-2">
          {weatherData.alerts.map((alert, index) => (
            <Alert key={index} variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>{alert.type}:</strong> {alert.description}
                <div className="text-xs mt-1 opacity-80">
                  Valid until {new Date(alert.endTime).toLocaleString()}
                </div>
              </AlertDescription>
            </Alert>
          ))}
          {projectId && (
            <Button onClick={handlePauseProduction} variant="destructive" size="sm">
              Pause Production Due to Weather
            </Button>
          )}
        </div>
      )}

      {/* 7-Day Forecast */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            7-Day Workability Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {weatherData?.forecast.map((day, index) => (
              <div
                key={day.date}
                className={`p-3 rounded-lg border ${
                  day.workable ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getWeatherIcon(day.condition)}
                    <div>
                      <p className="font-medium">{new Date(day.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                      <p className="text-sm text-muted-foreground">
                        {day.temperature.high}°F / {day.temperature.low}°F • {day.condition}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getRiskBadge(day.riskLevel)}
                    <Badge variant={day.workable ? "default" : "destructive"}>
                      {day.workable ? "Workable" : "Not Workable"}
                    </Badge>
                  </div>
                </div>
                {day.riskFactors.length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Risk factors: {day.riskFactors.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};