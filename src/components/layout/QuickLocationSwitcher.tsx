import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { MapPin, ChevronDown, Building2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useUserProfile } from "@/contexts/UserProfileContext";

interface Location {
  id: string;
  name: string;
  address_city?: string;
  address_state?: string;
}

interface QuickLocationSwitcherProps {
  isCollapsed?: boolean;
  onLocationChange?: (locationId: string | null) => void;
}

export const QuickLocationSwitcher = ({ isCollapsed = false, onLocationChange }: QuickLocationSwitcherProps) => {
  const [locations, setLocations] = useState<Location[]>([]);
  const [currentLocationId, setCurrentLocationId] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const { profile } = useUserProfile();
  
  // Get active tenant ID - prefer active_tenant_id, fallback to tenant_id
  const activeTenantId = profile?.active_tenant_id || profile?.tenant_id;

  const fetchUserLocations = useCallback(async () => {
    // Don't fetch if no active tenant
    if (!activeTenantId) {
      setLocations([]);
      setLoading(false);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get user's profile to check role
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      let locationsQuery = supabase
        .from('locations')
        .select('id, name, address_city, address_state')
        .eq('tenant_id', activeTenantId); // Filter by active tenant

      // If user is not admin/manager, only show locations they're assigned to
      if (userProfile?.role !== 'corporate' && userProfile?.role !== 'master' && userProfile?.role !== 'office_admin') {
        const { data: assignments } = await supabase
          .from('user_location_assignments')
          .select('location_id')
          .eq('user_id', user.id)
          .eq('is_active', true);

        if (assignments && assignments.length > 0) {
          const locationIds = assignments.map(a => a.location_id);
          locationsQuery = locationsQuery.in('id', locationIds);
        } else {
          setLocations([]);
          setLoading(false);
          return;
        }
      }

      const { data: fetchedLocations, error } = await locationsQuery
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setLocations(fetchedLocations || []);
    } catch (error) {
      console.error('Error fetching user locations:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  const loadCurrentLocationSetting = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: setting } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('user_id', user.id)
        .eq('setting_key', 'current_location_id')
        .maybeSingle();

      if (setting?.setting_value && setting.setting_value !== 'null') {
        const locationId = setting.setting_value as string;
        setCurrentLocationId(locationId);
      } else {
        setCurrentLocationId(null);
      }
    } catch (error) {
      console.error('Error loading current location setting:', error);
    }
  }, []);

  // Refetch locations when active tenant changes
  useEffect(() => {
    if (activeTenantId) {
      setLoading(true);
      fetchUserLocations();
      loadCurrentLocationSetting();
    }
  }, [activeTenantId, fetchUserLocations, loadCurrentLocationSetting]);

  const handleLocationSelect = async (locationId: string | null) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('app_settings')
        .upsert({
          user_id: user.id,
          setting_key: 'current_location_id',
          setting_value: locationId || 'null',
          tenant_id: activeTenantId
        }, {
          onConflict: 'user_id,tenant_id,setting_key'
        });

      if (error) throw error;

      setCurrentLocationId(locationId);
      const location = locations.find(l => l.id === locationId);
      setCurrentLocation(location || null);
      
      // Broadcast location change to other components (like EnhancedClientList)
      await supabase.channel('location-changes').send({
        type: 'broadcast',
        event: 'location_changed',
        payload: { locationId }
      });
      
      // Invalidate queries to refresh data with new location filter
      queryClient.invalidateQueries();
      
      onLocationChange?.(locationId);

      toast({
        title: "Location Changed",
        description: locationId 
          ? `Switched to ${location?.name}` 
          : "Viewing all locations",
      });
    } catch (error) {
      console.error('Error updating location:', error);
      toast({
        title: "Error",
        description: "Failed to change location",
        variant: "destructive",
      });
    }
  };

  // Update current location display when locations list changes
  useEffect(() => {
    if (locations.length > 0 && currentLocationId) {
      const location = locations.find(l => l.id === currentLocationId);
      if (location) {
        setCurrentLocation(location);
      } else {
        // Location doesn't exist in current tenant - reset to "All Locations"
        setCurrentLocationId(null);
        setCurrentLocation(null);
        // Clear the saved setting since it's no longer valid for this tenant
        handleLocationSelect(null);
      }
    } else if (!currentLocationId) {
      setCurrentLocation(null);
    }
  }, [locations, currentLocationId]);

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
