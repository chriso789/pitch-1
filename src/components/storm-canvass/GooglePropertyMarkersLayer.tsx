/// <reference types="@types/google.maps" />
import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';

interface GooglePropertyMarkersLayerProps {
  map: google.maps.Map;
  userLocation: { lat: number; lng: number };
  onPropertyClick: (property: any) => void;
}

interface CanvassiqProperty {
  id: string;
  lat: number;
  lng: number;
  disposition: string | null;
  address: any;
  owner_name: string | null;
  tenant_id: string;
  created_at: string;
}

// Disposition colors matching the original design
const DISPOSITION_COLORS: Record<string, string> = {
  not_contacted: '#D4A84B',
  interested: '#22C55E',
  not_interested: '#DC2626',
  follow_up: '#EAB308',
  not_home: '#6B7280',
  callback: '#8B5CF6',
  converted: '#10B981',
};

const DEFAULT_COLOR = '#D4A84B';

function getStreetNumber(address: any): string {
  if (!address) return '';
  
  let parsed = address;
  if (typeof address === 'string') {
    try {
      parsed = JSON.parse(address);
    } catch {
      // Try to extract number from string directly
      const match = address.match(/^(\d+)/);
      return match ? match[1] : '';
    }
  }
  
  // First check for explicit street_number field (from Google Geocoding)
  if (parsed?.street_number) {
    return parsed.street_number;
  }
  
  // Fall back to extracting from street or formatted address
  const street = parsed?.street || parsed?.formatted || parsed?.address_line1 || '';
  const match = street.match(/^(\d+)/);
  return match ? match[1] : '';
}

export default function GooglePropertyMarkersLayer({
  map,
  userLocation,
  onPropertyClick,
}: GooglePropertyMarkersLayerProps) {
  const { profile } = useUserProfile();
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [currentZoom, setCurrentZoom] = useState(18);
  const loadingRef = useRef(false);

  const getDispositionColor = (disposition: string | null): string => {
    if (!disposition) return DEFAULT_COLOR;
    return DISPOSITION_COLORS[disposition] || DEFAULT_COLOR;
  };

  const createMarkerIcon = useCallback((property: CanvassiqProperty, zoom: number): google.maps.Icon => {
    const disposition = property.disposition || 'not_contacted';
    const color = getDispositionColor(disposition);
    const isNotContacted = disposition === 'not_contacted' || !property.disposition;
    
    // Size based on zoom level
    let size = 16;
    let showNumber = false;
    let fontSize = 8;
    
    if (zoom >= 19) {
      size = 32;
      showNumber = true;
      fontSize = 11;
    } else if (zoom >= 17) {
      size = 26;
      showNumber = true;
      fontSize = 9;
    } else if (zoom >= 15) {
      size = 20;
      showNumber = false;
    }
    
    const streetNumber = showNumber ? getStreetNumber(property.address) : '';
    const fillColor = isNotContacted ? '#FFFFFF' : color;
    const strokeColor = isNotContacted ? color : '#FFFFFF';
    const textColor = isNotContacted ? '#1F2937' : '#FFFFFF';
    
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2"/>
        ${streetNumber ? `<text x="${size/2}" y="${size/2 + fontSize/3}" text-anchor="middle" font-size="${fontSize}" fill="${textColor}" font-weight="600" font-family="system-ui, -apple-system, sans-serif">${streetNumber}</text>` : ''}
      </svg>
    `;
    
    return {
      url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(size / 2, size / 2),
    };
  }, []);

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];
  }, []);

  const loadProperties = useCallback(async () => {
    if (!profile?.tenant_id || !map || loadingRef.current) return;
    
    loadingRef.current = true;
    
    try {
      const bounds = map.getBounds();
      if (!bounds) {
        loadingRef.current = false;
        return;
      }
      
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const zoom = map.getZoom() || 18;
      
      // Calculate limit based on zoom
      const limit = zoom >= 17 ? 500 : zoom >= 15 ? 300 : 100;
      
      const { data: properties, error } = await supabase
        .from('canvassiq_properties')
        .select('id, lat, lng, disposition, address, owner_name, tenant_id, created_at')
        .eq('tenant_id', profile.tenant_id)
        .gte('lat', sw.lat())
        .lte('lat', ne.lat())
        .gte('lng', sw.lng())
        .lte('lng', ne.lng())
        .limit(limit);
      
      if (error) {
        console.error('Error loading properties:', error);
        loadingRef.current = false;
        return;
      }
      
      // Clear existing markers
      clearMarkers();
      
      // Create new markers
      (properties || []).forEach((property: CanvassiqProperty) => {
        if (!property.lat || !property.lng) return;
        
        const marker = new google.maps.Marker({
          position: { lat: property.lat, lng: property.lng },
          map,
          icon: createMarkerIcon(property, zoom),
          optimized: true,
        });
        
        marker.addListener('click', () => {
          onPropertyClick(property);
        });
        
        markersRef.current.push(marker);
      });
      
      setCurrentZoom(zoom);
    } catch (err) {
      console.error('Error in loadProperties:', err);
    } finally {
      loadingRef.current = false;
    }
  }, [profile?.tenant_id, map, createMarkerIcon, clearMarkers, onPropertyClick]);

  // Update marker sizes when zoom changes
  const updateMarkerSizes = useCallback(() => {
    if (!map) return;
    
    const zoom = map.getZoom() || 18;
    if (Math.abs(zoom - currentZoom) >= 1) {
      // Reload properties when zoom changes significantly
      loadProperties();
    }
  }, [map, currentZoom, loadProperties]);

  // Set up map event listeners
  useEffect(() => {
    if (!map) return;
    
    const idleListener = map.addListener('idle', loadProperties);
    const zoomListener = map.addListener('zoom_changed', updateMarkerSizes);
    
    // Initial load
    loadProperties();
    
    return () => {
      google.maps.event.removeListener(idleListener);
      google.maps.event.removeListener(zoomListener);
      clearMarkers();
    };
  }, [map, loadProperties, updateMarkerSizes, clearMarkers]);

  return null;
}
