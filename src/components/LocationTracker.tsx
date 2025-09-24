import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Clock, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { locationService, LocationData } from "@/services/locationService";

interface LocationTrackerProps {
  onLocationUpdate?: (location: LocationData) => void;
  autoUpdate?: boolean;
  showAddress?: boolean;
  className?: string;
}

const LocationTracker: React.FC<LocationTrackerProps> = ({
  onLocationUpdate,
  autoUpdate = false,
  showAddress = true,
  className = "",
}) => {
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const { toast } = useToast();

  useEffect(() => {
    // Load last known location on mount
    loadLastKnownLocation();

    // Start auto-tracking if enabled
    if (autoUpdate) {
      startTracking();
    }

    return () => {
      if (isTracking) {
        stopTracking();
      }
    };
  }, [autoUpdate]);

  const loadLastKnownLocation = async () => {
    try {
      const location = await locationService.getUserLocation();
      if (location) {
        setCurrentLocation(location);
        setLastUpdated(new Date(location.timestamp));
      }
    } catch (error) {
      console.error("Failed to load last known location:", error);
    }
  };

  const getCurrentLocation = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const location = await locationService.getCurrentLocation();
      setCurrentLocation(location);
      setLastUpdated(new Date());
      
      // Update in database
      await locationService.updateUserLocation(location);
      
      // Call callback
      onLocationUpdate?.(location);
      
      toast({
        title: "Location Updated",
        description: "Your current location has been captured successfully.",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to get location";
      setError(errorMessage);
      toast({
        title: "Location Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const startTracking = () => {
    if (isTracking) return;

    setIsTracking(true);
    setError(null);

    const cleanup = locationService.watchLocation(
      async (location) => {
        setCurrentLocation(location);
        setLastUpdated(new Date());
        
        try {
          await locationService.updateUserLocation(location);
          onLocationUpdate?.(location);
        } catch (error) {
          console.error("Failed to update location in database:", error);
        }
      },
      (error) => {
        setError(error.message);
        setIsTracking(false);
        toast({
          title: "Location Tracking Error",
          description: error.message,
          variant: "destructive",
        });
      }
    );

    // Store cleanup function
    window.locationCleanup = cleanup;

    toast({
      title: "Location Tracking Started",
      description: "Your location will be updated automatically.",
    });
  };

  const stopTracking = () => {
    if (!isTracking) return;

    locationService.stopWatching();
    setIsTracking(false);
    
    if (window.locationCleanup) {
      window.locationCleanup();
      delete window.locationCleanup;
    }

    toast({
      title: "Location Tracking Stopped",
      description: "Automatic location updates have been disabled.",
    });
  };

  const formatCoordinates = (lat: number, lng: number) => {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleString();
  };

  const getAccuracyBadge = (accuracy?: number) => {
    if (!accuracy) return null;
    
    let variant: "default" | "secondary" | "destructive" = "default";
    let label = "High";
    
    if (accuracy > 100) {
      variant = "destructive";
      label = "Low";
    } else if (accuracy > 50) {
      variant = "secondary";
      label = "Medium";
    }
    
    return (
      <Badge variant={variant} className="text-xs">
        {label} ({Math.round(accuracy)}m)
      </Badge>
    );
  };

  return (
    <Card className={`w-full ${className}`}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Location Tracker
          </CardTitle>
          <div className="flex gap-2">
            {isTracking && (
              <Badge variant="default" className="animate-pulse">
                Live
              </Badge>
            )}
            {currentLocation && getAccuracyBadge(currentLocation.accuracy)}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {currentLocation && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Navigation className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono">
                {formatCoordinates(currentLocation.lat, currentLocation.lng)}
              </span>
            </div>
            
            {showAddress && currentLocation.address && (
              <div className="text-sm text-muted-foreground">
                {currentLocation.address}
              </div>
            )}
            
            {lastUpdated && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Last updated: {formatTimestamp(lastUpdated)}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={getCurrentLocation}
            disabled={isLoading || isTracking}
            variant="outline"
            size="sm"
          >
            {isLoading ? "Getting Location..." : "Get Current Location"}
          </Button>
          
          {!autoUpdate && (
            <Button
              onClick={isTracking ? stopTracking : startTracking}
              variant={isTracking ? "destructive" : "default"}
              size="sm"
            >
              {isTracking ? "Stop Tracking" : "Start Tracking"}
            </Button>
          )}
        </div>

        {!currentLocation && !error && (
          <div className="text-center text-muted-foreground text-sm py-4">
            Click "Get Current Location" to start tracking your position
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Extend Window interface for cleanup function
declare global {
  interface Window {
    locationCleanup?: () => void;
  }
}

export default LocationTracker;