import React from "react";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { MapPin, ChevronDown, Building2 } from "lucide-react";
import { useLocation } from "@/contexts/LocationContext";
import { useQueryClient } from "@tanstack/react-query";
import { setLocationSwitchingFlag } from "@/components/layout/GlobalLocationHandler";
import { useToast } from "@/hooks/use-toast";

interface LocationSwitcherProps {
  onLocationChange?: (locationId: string | null) => void;
}

export const LocationSwitcher = ({ onLocationChange }: LocationSwitcherProps) => {
  const { 
    currentLocationId, 
    currentLocation, 
    locations, 
    loading, 
    setCurrentLocationId 
  } = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleLocationSelect = async (locationId: string | null) => {
    const location = locations.find(l => l.id === locationId);
    
    console.log('[LocationSwitcher] Switching to location:', locationId, location?.name);
    
    // Set switching flag for overlay immediately
    setLocationSwitchingFlag(location?.name || null);
    
    try {
      // Persist to database - wait for completion
      await setCurrentLocationId(locationId);
      
      console.log('[LocationSwitcher] Database save successful for location:', locationId);
      
      // Clear all React Query cache
      queryClient.clear();
      
      // Notify callback if provided
      onLocationChange?.(locationId);
      
      // Full page redirect to dashboard after successful save
      window.location.href = '/dashboard';
    } catch (error) {
      console.error('[LocationSwitcher] Failed to switch location:', error);
      // Clear the switching flag on error
      setLocationSwitchingFlag(null);
      
      toast({
        title: "Location Switch Failed",
        description: error instanceof Error ? error.message : "Could not save location change. Please try again.",
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return <div className="h-8 w-32 bg-muted animate-pulse rounded"></div>;
  }

  if (locations.length === 0) {
    return null; // Don't show switcher if user has no location access
  }

  if (locations.length === 1) {
    // If user only has access to one location, show it as a static badge
    return (
      <Badge variant="outline" className="flex items-center gap-2">
        <Building2 className="h-3 w-3" />
        {locations[0].name}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          <span className="hidden sm:inline">
            {currentLocation ? currentLocation.name : "All Locations"}
          </span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem 
          onClick={() => handleLocationSelect(null)}
          className="flex items-center gap-2"
        >
          <Building2 className="h-4 w-4" />
          <div className="flex-1">
            <div className="font-medium">All Locations</div>
            <div className="text-xs text-muted-foreground">View data from all locations</div>
          </div>
          {!currentLocationId && (
            <Badge variant="default" className="text-xs">Current</Badge>
          )}
        </DropdownMenuItem>
        {locations.map((location) => (
          <DropdownMenuItem 
            key={location.id}
            onClick={() => handleLocationSelect(location.id)}
            className="flex items-center gap-2"
          >
            <MapPin className="h-4 w-4" />
            <div className="flex-1">
              <div className="font-medium">{location.name}</div>
              {(location.address_city || location.address_state) && (
                <div className="text-xs text-muted-foreground">
                  {[location.address_city, location.address_state].filter(Boolean).join(', ')}
                </div>
              )}
            </div>
            {currentLocationId === location.id && (
              <Badge variant="default" className="text-xs">Current</Badge>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
