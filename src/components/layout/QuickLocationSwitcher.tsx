import React from "react";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MapPin, ChevronDown, Building2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@/contexts/LocationContext";
import { setLocationSwitchingFlag } from "./GlobalLocationHandler";

interface QuickLocationSwitcherProps {
  isCollapsed?: boolean;
  onLocationChange?: (locationId: string | null) => void;
}

export const QuickLocationSwitcher = ({ isCollapsed = false, onLocationChange }: QuickLocationSwitcherProps) => {
  const queryClient = useQueryClient();
  const { 
    currentLocationId, 
    currentLocation, 
    locations, 
    loading, 
    setCurrentLocationId 
  } = useLocation();

  const handleLocationSelect = async (locationId: string | null) => {
    const location = locations.find(l => l.id === locationId);
    
    // Set switching flag for overlay immediately
    setLocationSwitchingFlag(location?.name || null);
    
    // Persist to database in background
    await setCurrentLocationId(locationId);
    
    // Clear all React Query cache
    queryClient.clear();
    
    // Notify callback if provided
    onLocationChange?.(locationId);
    
    // Full page redirect to dashboard
    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 150);
  };

  if (loading) {
    return (
      <div className={cn(
        "animate-pulse rounded-md bg-muted",
        isCollapsed ? "h-8 w-8" : "h-8 w-full"
      )} />
    );
  }

  // Don't show if no locations or only one location
  if (locations.length <= 1) {
    return null;
  }

  const displayName = currentLocation?.name || "All";
  const truncatedName = displayName.length > 12 ? displayName.slice(0, 10) + "…" : displayName;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm"
          className={cn(
            "w-full justify-start gap-2 text-muted-foreground hover:text-foreground hover:bg-accent",
            isCollapsed && "justify-center px-2"
          )}
        >
          <MapPin className="h-4 w-4 flex-shrink-0" />
          {!isCollapsed && (
            <>
              <span className="text-sm truncate flex-1 text-left">{truncatedName}</span>
              <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-50" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="start" 
        side={isCollapsed ? "right" : "bottom"}
        className="w-56 bg-popover border border-border shadow-lg z-50"
      >
        <DropdownMenuItem 
          onClick={() => handleLocationSelect(null)}
          className="flex items-center gap-2 cursor-pointer"
        >
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">All Locations</span>
          {!currentLocationId && (
            <Check className="h-4 w-4 text-primary" />
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {locations.map((location) => (
          <DropdownMenuItem 
            key={location.id}
            onClick={() => handleLocationSelect(location.id)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{location.name}</div>
              {(location.address_city || location.address_state) && (
                <div className="text-xs text-muted-foreground truncate">
                  {[location.address_city, location.address_state].filter(Boolean).join(', ')}
                </div>
              )}
            </div>
            {currentLocationId === location.id && (
              <Check className="h-4 w-4 text-primary flex-shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
