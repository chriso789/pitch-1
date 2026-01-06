import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from './UserProfileContext';

interface Location {
  id: string;
  name: string;
  address_city?: string;
  address_state?: string;
}

interface LocationContextType {
  currentLocationId: string | null;
  currentLocation: Location | null;
  locations: Location[];
  loading: boolean;
  setCurrentLocationId: (locationId: string | null) => Promise<void>;
  refreshLocations: () => Promise<void>;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

// Helper to get tenant-scoped storage key
const getStorageKey = (tenantId: string | null) => 
  tenantId ? `pitch_current_location:${tenantId}` : 'pitch_current_location';

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const [currentLocationId, setCurrentLocationIdState] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useUserProfile();

  const activeTenantId = profile?.active_tenant_id || profile?.tenant_id;

  // Fetch user's available locations
  const fetchUserLocations = useCallback(async () => {
    if (!activeTenantId) {
      setLocations([]);
      setLoading(false);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      let locationsQuery = supabase
        .from('locations')
        .select('id, name, address_city, address_state')
        .eq('tenant_id', activeTenantId);

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

  // Load current location from app_settings - TENANT SCOPED
  const loadCurrentLocationSetting = useCallback(async () => {
    if (!activeTenantId) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const storageKey = getStorageKey(activeTenantId);
      
      const { data: setting } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('user_id', user.id)
        .eq('tenant_id', activeTenantId)
        .eq('setting_key', 'current_location_id')
        .maybeSingle();

      if (setting?.setting_value && setting.setting_value !== 'null') {
        const locationId = setting.setting_value as string;
        setCurrentLocationIdState(locationId);
        // Store in tenant-scoped localStorage key
        localStorage.setItem(storageKey, locationId);
      } else {
        setCurrentLocationIdState(null);
        localStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.error('Error loading current location setting:', error);
    }
  }, [activeTenantId]);

  // Set current location - AWAIT database write for reliable switching
  const setCurrentLocationId = useCallback(async (locationId: string | null): Promise<void> => {
    const storageKey = getStorageKey(activeTenantId);
    
    // 1. Update local state IMMEDIATELY (optimistic)
    setCurrentLocationIdState(locationId);
    
    // 2. Store in tenant-scoped localStorage for cross-tab sync
    if (locationId) {
      localStorage.setItem(storageKey, locationId);
    } else {
      localStorage.removeItem(storageKey);
    }

    // 3. Dispatch event immediately for listeners
    window.dispatchEvent(new CustomEvent('location-changed', { detail: { locationId } }));

    // 4. Persist to database - AWAIT completion for reliable switching
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !activeTenantId) return;
    
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
    
    if (error) {
      console.error('Error saving location setting:', error);
      throw error; // Propagate error so caller can handle
    }
  }, [activeTenantId]);

  // Update current location object when ID or locations list changes
  useEffect(() => {
    const storageKey = getStorageKey(activeTenantId);
    
    if (locations.length > 0 && currentLocationId) {
      const location = locations.find(l => l.id === currentLocationId);
      if (location) {
        setCurrentLocation(location);
      } else {
        // Location doesn't exist in current tenant - reset to "All Locations"
        setCurrentLocationIdState(null);
        setCurrentLocation(null);
        localStorage.removeItem(storageKey);
      }
    } else {
      setCurrentLocation(null);
    }
  }, [locations, currentLocationId, activeTenantId]);

  // Initialize on mount and when tenant changes - RESET location when tenant changes
  useEffect(() => {
    if (activeTenantId) {
      // Reset location to null immediately when tenant changes to prevent stale data
      setCurrentLocationIdState(null);
      setCurrentLocation(null);
      setLoading(true);
      fetchUserLocations();
      loadCurrentLocationSetting();
    }
  }, [activeTenantId, fetchUserLocations, loadCurrentLocationSetting]);

  // Listen for localStorage changes (cross-tab sync) - use tenant-scoped key
  useEffect(() => {
    const storageKey = getStorageKey(activeTenantId);
    
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey) {
        const newLocationId = e.newValue;
        setCurrentLocationIdState(newLocationId || null);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [activeTenantId]);

  // Listen for custom location-changed event (same-tab)
  useEffect(() => {
    const handleLocationChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ locationId: string | null }>;
      setCurrentLocationIdState(customEvent.detail.locationId);
    };

    window.addEventListener('location-changed', handleLocationChange);
    return () => window.removeEventListener('location-changed', handleLocationChange);
  }, []);

  const refreshLocations = useCallback(async () => {
    await fetchUserLocations();
  }, [fetchUserLocations]);

  return (
    <LocationContext.Provider value={{
      currentLocationId,
      currentLocation,
      locations,
      loading,
      setCurrentLocationId,
      refreshLocations
    }}>
      {children}
    </LocationContext.Provider>
  );
};

export const useLocation = () => {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return context;
};
