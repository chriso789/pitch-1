import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { MapPin, ChevronDown, Building2 } from "lucide-react";

interface Location {
  id: string;
  name: string;
  address_city?: string;
  address_state?: string;
  is_active: boolean;
}

interface LocationSwitcherProps {
  onLocationChange?: (locationId: string | null) => void;
}

export const LocationSwitcher = ({ onLocationChange }: LocationSwitcherProps) => {
  const [locations, setLocations] = useState<Location[]>([]);
  const [currentLocationId, setCurrentLocationId] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserLocations();
    loadCurrentLocationSetting();
  }, []);

  const fetchUserLocations = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get user's profile to check role
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      let locationsQuery = supabase.from('locations').select('*');

      // If user is not admin/manager, only show locations they're assigned to
      if (profile?.role !== 'corporate' && profile?.role !== 'master' && profile?.role !== 'office_admin') {
        const { data: assignments } = await supabase
          .from('user_location_assignments')
          .select('location_id')
          .eq('user_id', user.id)
          .eq('is_active', true);

        if (assignments && assignments.length > 0) {
          const locationIds = assignments.map(a => a.location_id);
          locationsQuery = locationsQuery.in('id', locationIds);
        } else {
          // User has no location assignments
          setLocations([]);
          setLoading(false);
          return;
        }
      }

      const { data: locations, error } = await locationsQuery
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setLocations(locations || []);
    } catch (error) {
      console.error('Error fetching user locations:', error);
      toast({
        title: "Error",
        description: "Failed to load locations",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentLocationSetting = async () => {
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
        
        // Find the location details
        const location = locations.find(l => l.id === locationId);
        setCurrentLocation(location || null);
      }
    } catch (error) {
      console.error('Error loading current location setting:', error);
    }
  };

  const handleLocationSelect = async (locationId: string | null) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update user's current location setting
      const { error } = await supabase
        .from('app_settings')
        .upsert({
          user_id: user.id,
          setting_key: 'current_location_id',
          setting_value: locationId || 'null',
          tenant_id: (await supabase.from('profiles').select('tenant_id').eq('id', user.id).single()).data?.tenant_id
        });

      if (error) throw error;

      setCurrentLocationId(locationId);
      const location = locations.find(l => l.id === locationId);
      setCurrentLocation(location || null);
      
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

  // Re-fetch current location when locations list changes
  useEffect(() => {
    if (locations.length > 0 && currentLocationId) {
      const location = locations.find(l => l.id === currentLocationId);
      setCurrentLocation(location || null);
    }
  }, [locations, currentLocationId]);

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