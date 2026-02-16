/**
 * PropertyMarkersLayer - Displays canvassiq properties as color-coded circular markers
 * - Dynamic sizing based on zoom level
 * - No hover animation (fixes click issues)
 * - Loads properties based on visible map bounds
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

// Disposition colors matching the reference design
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

// Get marker size based on zoom level - always show house numbers at zoom 14+
function getMarkerSize(zoom: number): { size: number; showNumber: boolean; fontSize: number } {
  if (zoom >= 18) return { size: 36, showNumber: true, fontSize: 12 };
  if (zoom >= 17) return { size: 32, showNumber: true, fontSize: 11 };
  if (zoom >= 16) return { size: 28, showNumber: true, fontSize: 10 };
  if (zoom >= 15) return { size: 24, showNumber: true, fontSize: 9 };
  if (zoom >= 14) return { size: 20, showNumber: true, fontSize: 8 };
  return { size: 10, showNumber: false, fontSize: 0 };
}

// Get radius based on zoom level (in miles)
function getLoadRadius(zoom: number): number {
  if (zoom >= 18) return 0.25;
  if (zoom >= 16) return 0.5;
  if (zoom >= 14) return 1;
  if (zoom >= 12) return 2;
  return 3;
}

export default function PropertyMarkersLayer({
  map,
  userLocation,
  onPropertyClick,
}: PropertyMarkersLayerProps) {
  const { profile } = useUserProfile();
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [currentZoom, setCurrentZoom] = useState(map.getZoom());
  const loadedBoundsRef = useRef<string | null>(null);

  const getDispositionColor = (disposition: string | null): string => {
    if (!disposition) return DISPOSITION_COLORS.default;
    return DISPOSITION_COLORS[disposition] || DISPOSITION_COLORS.default;
  };

  const getStreetInfo = (address: any): { number: string; streetName: string } => {
    if (!address) return { number: '', streetName: '' };
    
    let parsed = address;
    if (typeof address === 'string') {
      try {
        parsed = JSON.parse(address);
      } catch {
        const match = address.match(/^(\d+)\s+(.*)/);
        if (match) {
          return { number: match[1], streetName: extractShortStreet(match[2]) };
        }
        const numMatch = address.match(/^(\d+)/);
        return { number: numMatch ? numMatch[1] : '', streetName: '' };
      }
    }
    
    let streetNumber = '';
    let streetName = '';
    
    if (parsed.street_number) {
      streetNumber = parsed.street_number;
    }
    
    // Extract street name from street_name or street field
    const rawStreet = parsed.street_name || parsed.street || parsed.formatted || parsed.address_line1 || '';
    
    if (!streetNumber) {
      const match = rawStreet.match(/^(\d+)\s+(.*)/);
      if (match) {
        streetNumber = match[1];
        streetName = extractShortStreet(match[2]);
      } else {
        const numMatch = rawStreet.match(/^(\d+)/);
        streetNumber = numMatch ? numMatch[1] : '';
      }
    } else {
      streetName = extractShortStreet(rawStreet);
    }
    
    return { number: streetNumber, streetName };
  };

  // Strip suffixes like Street, Ave, Dr, Blvd etc. to get short name
  const extractShortStreet = (street: string): string => {
    if (!street) return '';
    return street
      .replace(/^\d+\s+/, '') // remove leading number
      .replace(/\b(Street|St|Avenue|Ave|Drive|Dr|Boulevard|Blvd|Road|Rd|Lane|Ln|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter)\b\.?$/i, '')
      .trim();
  };

  // Detect nearby same-number properties and compute pixel offsets
  const computeOffsets = useCallback((properties: any[]): Map<string, { x: number; y: number }> => {
    const offsets = new Map<string, { x: number; y: number }>();
    const DISTANCE_THRESHOLD = 0.00015; // ~15 meters in degrees

    for (let i = 0; i < properties.length; i++) {
      const a = properties[i];
      if (!a.lat || !a.lng) continue;
      const infoA = getStreetInfo(a.address);
      if (!infoA.number) continue;

      for (let j = i + 1; j < properties.length; j++) {
        const b = properties[j];
        if (!b.lat || !b.lng) continue;
        const infoB = getStreetInfo(b.address);
        if (infoA.number !== infoB.number) continue;

        const dLat = Math.abs(a.lat - b.lat);
        const dLng = Math.abs(a.lng - b.lng);
        if (dLat < DISTANCE_THRESHOLD && dLng < DISTANCE_THRESHOLD) {
          if (!offsets.has(a.id)) offsets.set(a.id, { x: -10, y: 0 });
          if (!offsets.has(b.id)) offsets.set(b.id, { x: 10, y: 0 });
        }
      }
    }
    return offsets;
  }, []);

  const createMarkerElement = useCallback((property: CanvassiqProperty, zoom: number): HTMLDivElement => {
    const container = document.createElement('div');
    const color = getDispositionColor(property.disposition);
    const { size, showNumber, fontSize } = getMarkerSize(zoom);
    const { number: streetNumber, streetName } = getStreetInfo(property.address);
    const isNotContacted = !property.disposition || property.disposition === 'not_contacted';
    const borderWidth = size >= 24 ? 3 : size >= 16 ? 2 : 1;
    const showStreetLabel = zoom >= 17 && streetName;

    container.className = 'property-marker';
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: auto;
      cursor: pointer;
    `;

    // Circle element
    const circle = document.createElement('div');
    if (isNotContacted) {
      circle.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        background-color: #FFFFFF;
        border: ${borderWidth}px solid ${color};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        font-size: ${fontSize}px;
        font-weight: 600;
        color: #1F2937;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
    } else {
      circle.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        background-color: ${color};
        border: ${borderWidth}px solid white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        font-size: ${fontSize}px;
        font-weight: 600;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
    }

    if (showNumber && streetNumber) {
      circle.textContent = streetNumber;
    }

    container.appendChild(circle);

    // Street name label below the circle at zoom 17+
    if (showStreetLabel) {
      const label = document.createElement('div');
      label.textContent = streetName;
      label.style.cssText = `
        margin-top: 1px;
        font-size: 8px;
        font-weight: 600;
        color: #1F2937;
        background: rgba(255,255,255,0.85);
        padding: 0px 3px;
        border-radius: 2px;
        white-space: nowrap;
        max-width: 60px;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        text-shadow: 0 0 2px white;
        line-height: 1.2;
      `;
      container.appendChild(label);
    }

    return container;
  }, []);

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
  }, []);

  const loadProperties = useCallback(async () => {
    if (!profile?.tenant_id || !map) return;
    
    const zoom = map.getZoom();
    const center = map.getCenter();
    const radius = getLoadRadius(zoom);
    
    // Create a bounds key to avoid reloading same area
    const boundsKey = `${center.lat.toFixed(3)}_${center.lng.toFixed(3)}_${zoom.toFixed(0)}`;
    if (loadedBoundsRef.current === boundsKey) return;
    loadedBoundsRef.current = boundsKey;
    
    clearMarkers();
    
    // Calculate bounding box based on dynamic radius
    const radiusInDegrees = radius / 69;
    const minLat = center.lat - radiusInDegrees;
    const maxLat = center.lat + radiusInDegrees;
    const minLng = center.lng - radiusInDegrees;
    const maxLng = center.lng + radiusInDegrees;
    
    // Limit properties based on zoom
    const limit = zoom >= 16 ? 200 : zoom >= 14 ? 300 : 500;
    
    try {
      const { data: properties, error } = await supabase
        .from('canvassiq_properties')
        .select('id, lat, lng, address, disposition, owner_name, phone_numbers, emails, homeowner, notes, property_data')
        .eq('tenant_id', profile.tenant_id)
        .gte('lat', minLat)
        .lte('lat', maxLat)
        .gte('lng', minLng)
        .lte('lng', maxLng)
        .limit(limit);
      
      if (error) {
        console.error('Error loading properties:', error);
        return;
      }
      
      // If no properties exist around user location, try to load parcels
      if ((!properties || properties.length === 0) && zoom >= 14) {
        console.log('[PropertyMarkersLayer] No properties found, loading parcels...');
        await loadParcelsFromEdgeFunction(center.lat, center.lng, radius);
        return;
      }
      
      // Compute offsets for nearby same-number pins
      const validProperties = (properties || []).filter((p: any) => p.lat && p.lng);
      const offsets = computeOffsets(validProperties);

      // Create markers for each property
      validProperties.forEach((property: any) => {
        const el = createMarkerElement(property as CanvassiqProperty, zoom);
        
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onPropertyClick(property);
        });

        const offset = offsets.get(property.id);
        const marker = new mapboxgl.Marker({ element: el, offset: offset ? [offset.x, offset.y] : undefined })
          .setLngLat([property.lng, property.lat])
          .addTo(map);
        
        markersRef.current.push(marker);
      });
    } catch (err) {
      console.error('Error in loadProperties:', err);
    }
  }, [profile?.tenant_id, map, onPropertyClick, clearMarkers, createMarkerElement, computeOffsets]);

  const loadParcelsFromEdgeFunction = async (lat: number, lng: number, radius: number) => {
    if (!profile?.tenant_id) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('canvassiq-load-parcels', {
        body: { lat, lng, radius, tenant_id: profile.tenant_id }
      });

      if (error) {
        console.error('[PropertyMarkersLayer] Error loading parcels:', error);
        return;
      }

      if (data?.properties?.length > 0) {
        toast.success(`Loaded ${data.properties.length} properties`);
        loadedBoundsRef.current = null; // Reset to force reload
        await loadProperties();
      }
    } catch (err) {
      console.error('[PropertyMarkersLayer] Edge function error:', err);
    }
  };

  // Update marker sizes when zoom changes
  const updateMarkerSizes = useCallback(() => {
    const zoom = map.getZoom();
    setCurrentZoom(zoom);
    
    // Force reload when zoom changes significantly
    loadedBoundsRef.current = null;
    loadProperties();
  }, [map, loadProperties]);

  // Listen for zoom and move events
  useEffect(() => {
    const handleZoomEnd = () => updateMarkerSizes();
    const handleMoveEnd = () => loadProperties();
    
    map.on('zoomend', handleZoomEnd);
    map.on('moveend', handleMoveEnd);
    
    // Initial load
    loadProperties();
    
    return () => {
      map.off('zoomend', handleZoomEnd);
      map.off('moveend', handleMoveEnd);
      clearMarkers();
    };
  }, [map, loadProperties, updateMarkerSizes, clearMarkers]);

  // Re-add markers after style change
  useEffect(() => {
    const handleStyleLoad = () => {
      loadedBoundsRef.current = null;
      loadProperties();
    };
    
    map.on('style.load', handleStyleLoad);
    
    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [map, loadProperties]);

  return null;
}
