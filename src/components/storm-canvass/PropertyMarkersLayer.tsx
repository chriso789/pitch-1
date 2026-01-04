/**
 * PropertyMarkersLayer - Displays canvassiq properties as color-coded circular markers
 * Color coding based on disposition status
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { toast } from 'sonner';

interface PropertyMarkersLayerProps {
  map: mapboxgl.Map;
  userLocation: { lat: number; lng: number };
  onPropertyClick: (property: any) => void;
}

interface CanvassiqProperty {
  id: string;
  lat: number;
  lng: number;
  address: any;
  disposition: string | null;
  owner_name: string | null;
  phone_numbers: string[] | null;
  emails: string[] | null;
  homeowner: any;
}

// Updated disposition colors matching the reference design
const DISPOSITION_COLORS: Record<string, string> = {
  not_contacted: '#D4A84B',    // Yellow/gold outline
  new_roof: '#8B6914',         // Brown  
  unqualified: '#DC2626',      // Red
  old_roof_marker: '#DC2626',  // Red
  interested: '#22C55E',       // Green
  sold: '#22C55E',             // Green
  qualified: '#22C55E',        // Green
  not_interested: '#DC2626',   // Red
  not_home: '#9CA3AF',         // Gray
  follow_up: '#EAB308',        // Yellow
  default: '#D4A84B',          // Yellow outline (not contacted)
};

// Icons to show for certain dispositions
const DISPOSITION_ICONS: Record<string, string> = {
  interested: '$',
  sold: '$',
  unqualified: '✕',
  not_interested: '✕',
  old_roof_marker: '!',
};

export default function PropertyMarkersLayer({
  map,
  userLocation,
  onPropertyClick,
}: PropertyMarkersLayerProps) {
  const { profile } = useUserProfile();
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const getDispositionColor = (disposition: string | null): string => {
    if (!disposition) return DISPOSITION_COLORS.default;
    return DISPOSITION_COLORS[disposition] || DISPOSITION_COLORS.default;
  };

  const getStreetNumber = (address: any): string => {
    if (!address) return '';
    if (typeof address === 'string') {
      try {
        address = JSON.parse(address);
      } catch {
        return '';
      }
    }
    const street = address.street || address.formatted || '';
    const match = street.match(/^(\d+)/);
    return match ? match[1] : '';
  };

  const createMarkerElement = (property: CanvassiqProperty): HTMLDivElement => {
    const el = document.createElement('div');
    const color = getDispositionColor(property.disposition);
    const streetNumber = getStreetNumber(property.address);
    const icon = property.disposition ? DISPOSITION_ICONS[property.disposition] : null;
    const isNotContacted = !property.disposition || property.disposition === 'not_contacted';
    
    el.className = 'property-marker';
    
    // Style based on disposition
    if (isNotContacted) {
      // Yellow outline circle for not contacted
      el.style.cssText = `
        width: 28px;
        height: 28px;
        background-color: transparent;
        border: 3px solid ${color};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        font-size: 9px;
        font-weight: bold;
        color: ${color};
        transition: transform 0.2s, box-shadow 0.2s;
      `;
    } else {
      // Filled circle for contacted properties
      el.style.cssText = `
        width: 28px;
        height: 28px;
        background-color: ${color};
        border: 2px solid white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        font-size: 11px;
        font-weight: bold;
        color: white;
        transition: transform 0.2s, box-shadow 0.2s;
      `;
    }
    
    // Show icon or street number
    if (icon) {
      el.textContent = icon;
    } else if (streetNumber && streetNumber.length <= 4) {
      el.textContent = streetNumber;
      el.style.fontSize = '9px';
    }
    
    // Hover effect
    el.addEventListener('mouseenter', () => {
      el.style.transform = 'scale(1.2)';
      el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
    });
    el.addEventListener('mouseleave', () => {
      el.style.transform = 'scale(1)';
      el.style.boxShadow = isNotContacted ? '0 2px 6px rgba(0,0,0,0.2)' : '0 2px 6px rgba(0,0,0,0.3)';
    });
    
    return el;
  };

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
  }, []);

  const loadProperties = useCallback(async () => {
    if (!profile?.tenant_id || !map) return;
    
    setIsLoading(true);
    clearMarkers();
    
    // Calculate bounding box (roughly 0.5 mile radius)
    const radiusInDegrees = 0.5 / 69;
    const minLat = userLocation.lat - radiusInDegrees;
    const maxLat = userLocation.lat + radiusInDegrees;
    const minLng = userLocation.lng - radiusInDegrees;
    const maxLng = userLocation.lng + radiusInDegrees;
    
    try {
      const { data: properties, error } = await supabase
        .from('canvassiq_properties')
        .select('id, lat, lng, address, disposition, owner_name, phone_numbers, emails, homeowner, notes, property_data')
        .eq('tenant_id', profile.tenant_id)
        .gte('lat', minLat)
        .lte('lat', maxLat)
        .gte('lng', minLng)
        .lte('lng', maxLng)
        .limit(200);
      
      if (error) {
        console.error('Error loading properties:', error);
        return;
      }
      
      // If no properties exist, try to load parcels via edge function
      if (!properties || properties.length === 0) {
        console.log('[PropertyMarkersLayer] No properties found, attempting to load parcels...');
        await loadParcelsFromEdgeFunction();
        return;
      }
      
      // Create markers for each property
      properties.forEach((property: any) => {
        if (!property.lat || !property.lng) return;
        
        const el = createMarkerElement(property as CanvassiqProperty);
        
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onPropertyClick(property);
        });
        
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([property.lng, property.lat])
          .addTo(map);
        
        markersRef.current.push(marker);
      });
    } catch (err) {
      console.error('Error in loadProperties:', err);
    } finally {
      setIsLoading(false);
    }
  }, [profile?.tenant_id, userLocation, map, onPropertyClick, clearMarkers]);

  const loadParcelsFromEdgeFunction = async () => {
    if (!profile?.tenant_id) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('canvassiq-load-parcels', {
        body: {
          lat: userLocation.lat,
          lng: userLocation.lng,
          radius: 0.25, // 0.25 mile radius
          tenant_id: profile.tenant_id
        }
      });

      if (error) {
        console.error('[PropertyMarkersLayer] Error loading parcels:', error);
        return;
      }

      if (data?.properties?.length > 0) {
        toast.success(`Loaded ${data.properties.length} properties`);
        // Reload properties after edge function populates them
        await loadProperties();
      }
    } catch (err) {
      console.error('[PropertyMarkersLayer] Edge function error:', err);
    }
  };

  // Load properties when location changes
  useEffect(() => {
    loadProperties();
    
    const interval = setInterval(loadProperties, 30000);
    
    return () => {
      clearInterval(interval);
      clearMarkers();
    };
  }, [loadProperties, clearMarkers]);

  // Re-add markers after style change
  useEffect(() => {
    const handleStyleLoad = () => {
      loadProperties();
    };
    
    map.on('style.load', handleStyleLoad);
    
    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [map, loadProperties]);

  return null;
}
