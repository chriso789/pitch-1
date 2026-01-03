/**
 * PropertyMarkersLayer - Displays canvassiq properties as color-coded circular markers
 * Color coding based on disposition status
 */

import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';

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

const DISPOSITION_COLORS: Record<string, string> = {
  interested: '#22c55e',      // Green
  qualified: '#22c55e',       // Green
  not_interested: '#ef4444',  // Red
  follow_up: '#eab308',       // Yellow
  not_home: '#9ca3af',        // Gray
  default: '#3b82f6',         // Blue (not contacted)
};

export default function PropertyMarkersLayer({
  map,
  userLocation,
  onPropertyClick,
}: PropertyMarkersLayerProps) {
  const { profile } = useUserProfile();
  const markersRef = useRef<mapboxgl.Marker[]>([]);

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
    // Extract street number from address
    const street = address.street || address.formatted || '';
    const match = street.match(/^(\d+)/);
    return match ? match[1] : '';
  };

  const createMarkerElement = (property: CanvassiqProperty): HTMLDivElement => {
    const el = document.createElement('div');
    const color = getDispositionColor(property.disposition);
    const streetNumber = getStreetNumber(property.address);
    
    el.className = 'property-marker';
    el.style.cssText = `
      width: 32px;
      height: 32px;
      background-color: ${color};
      border: 2px solid white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      font-size: 10px;
      font-weight: bold;
      color: white;
      transition: transform 0.2s, box-shadow 0.2s;
    `;
    
    // Show street number if available (truncate if too long)
    if (streetNumber && streetNumber.length <= 4) {
      el.textContent = streetNumber;
    }
    
    // Hover effect
    el.addEventListener('mouseenter', () => {
      el.style.transform = 'scale(1.2)';
      el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
    });
    el.addEventListener('mouseleave', () => {
      el.style.transform = 'scale(1)';
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    });
    
    return el;
  };

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
  }, []);

  const loadProperties = useCallback(async () => {
    if (!profile?.tenant_id || !map) return;
    
    clearMarkers();
    
    // Calculate bounding box (roughly 0.5 mile radius)
    const radiusInDegrees = 0.5 / 69; // ~0.5 miles in degrees
    const minLat = userLocation.lat - radiusInDegrees;
    const maxLat = userLocation.lat + radiusInDegrees;
    const minLng = userLocation.lng - radiusInDegrees;
    const maxLng = userLocation.lng + radiusInDegrees;
    
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
    
    if (!properties || properties.length === 0) return;
    
    // Create markers for each property
    properties.forEach((property: any) => {
      if (!property.lat || !property.lng) return;
      
      const el = createMarkerElement(property as CanvassiqProperty);
      
      // Click handler
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPropertyClick(property);
      });
      
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([property.lng, property.lat])
        .addTo(map);
      
      markersRef.current.push(marker);
    });
  }, [profile?.tenant_id, userLocation, map, onPropertyClick, clearMarkers]);

  // Load properties when location changes
  useEffect(() => {
    loadProperties();
    
    // Refresh every 30 seconds
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
