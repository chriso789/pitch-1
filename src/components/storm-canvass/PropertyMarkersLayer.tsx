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
  not_contacted: '#D4A84B',
  new_roof: '#8B6914',
  unqualified: '#DC2626',
  old_roof_marker: '#DC2626',
  interested: '#22C55E',
  sold: '#22C55E',
  qualified: '#22C55E',
  not_interested: '#DC2626',
  not_home: '#9CA3AF',
  follow_up: '#EAB308',
  past_customer: '#0D9488',
  default: '#D4A84B',
};

// CRM project / pipeline status → pin color (overrides canvassiq disposition)
const CRM_STATUS_COLORS: Record<string, string> = {
  new: '#6366F1', contacted: '#6366F1',
  appointment_set: '#0EA5E9', inspection_scheduled: '#0EA5E9',
  inspection_complete: '#06B6D4',
  estimate_sent: '#F59E0B', estimate_approved: '#22C55E',
  contract_signed: '#22C55E', legal_review: '#A855F7',
  in_production: '#10B981', completed: '#0D9488',
  closed_won: '#22C55E', closed_lost: '#EF4444',
  active: '#10B981', on_hold: '#F59E0B', cancelled: '#EF4444',
};

function formatCrmStatus(s?: string | null): string {
  if (!s) return '';
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function coordKey(lat: number, lng: number): string {
  // ~10m grid so canvassiq property coords match contact coords
  return `${lat.toFixed(4)}|${lng.toFixed(4)}`;
}

interface CrmOverlay {
  status: string;
  isProject: boolean;
  ownerName: string;
}

// Get marker size based on zoom level - always show house numbers at zoom 14+
function getMarkerSize(zoom: number): { size: number; showNumber: boolean; fontSize: number } {
  if (zoom >= 18) return { size: 36, showNumber: true, fontSize: 12 };
  if (zoom >= 17) return { size: 32, showNumber: true, fontSize: 11 };
  if (zoom >= 16) return { size: 28, showNumber: true, fontSize: 10 };
  if (zoom >= 15) return { size: 24, showNumber: true, fontSize: 9 };
  if (zoom >= 14) return { size: 20, showNumber: true, fontSize: 8 };
  return { size: 10, showNumber: false, fontSize: 0 };
}

// No longer needed - we use map.getBounds() directly

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

  const createMarkerElement = useCallback((
    property: CanvassiqProperty,
    zoom: number,
    crm?: CrmOverlay,
  ): HTMLDivElement => {
    const container = document.createElement('div');
    const baseColor = getDispositionColor(property.disposition);
    const color = crm ? (CRM_STATUS_COLORS[crm.status] || baseColor) : baseColor;
    const { size, showNumber, fontSize } = getMarkerSize(zoom);
    const { number: streetNumber, streetName } = getStreetInfo(property.address);
    const isNotContacted = !crm && (!property.disposition || property.disposition === 'not_contacted');
    const borderWidth = size >= 24 ? 3 : size >= 16 ? 2 : 1;
    const showStreetLabel = zoom >= 17 && streetName;

    container.className = 'property-marker';
    container.style.cssText = `
      display: flex; flex-direction: column; align-items: center;
      pointer-events: auto; cursor: pointer; position: relative;
    `;

    const circle = document.createElement('div');
    if (isNotContacted) {
      circle.style.cssText = `
        width: ${size}px; height: ${size}px;
        background-color: #FFFFFF;
        border: ${borderWidth}px solid ${color};
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        font-size: ${fontSize}px; font-weight: 600; color: #1F2937;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
    } else {
      circle.style.cssText = `
        width: ${size}px; height: ${size}px;
        background-color: ${color};
        border: ${borderWidth}px solid white;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        font-size: ${fontSize}px; font-weight: 600; color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
    }

    if (showNumber && streetNumber) {
      circle.textContent = streetNumber;
    }

    container.appendChild(circle);

    // CRM project/lead badge (small dot in corner to flag it's in the CRM)
    if (crm) {
      const dot = document.createElement('div');
      dot.style.cssText = `
        position: absolute; top: -2px; right: -2px;
        width: ${Math.max(8, Math.round(size * 0.35))}px;
        height: ${Math.max(8, Math.round(size * 0.35))}px;
        background: white; border: 2px solid ${color};
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 1px 2px rgba(0,0,0,0.3);
      `;
      if (crm.isProject) {
        const inner = document.createElement('div');
        inner.style.cssText = `
          width: 4px; height: 4px; background: ${color}; border-radius: 50%;
        `;
        dot.appendChild(inner);
      }
      container.appendChild(dot);
    }

    // CRM status / owner label below pin at zoom 16+
    if (crm && zoom >= 16) {
      const label = document.createElement('div');
      const txt = `${crm.isProject ? 'PROJECT · ' : ''}${formatCrmStatus(crm.status).toUpperCase()}`;
      label.textContent = txt;
      label.style.cssText = `
        margin-top: 2px; font-size: 8px; font-weight: 700;
        color: #FFFFFF; background: ${color};
        padding: 1px 4px; border-radius: 3px; white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 1px 2px rgba(0,0,0,0.25);
      `;
      container.appendChild(label);

      if (crm.ownerName && zoom >= 17) {
        const owner = document.createElement('div');
        owner.textContent = crm.ownerName;
        owner.style.cssText = `
          margin-top: 1px; font-size: 8px; font-weight: 600;
          color: #1F2937; background: rgba(255,255,255,0.9);
          padding: 0 3px; border-radius: 2px; white-space: nowrap;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        container.appendChild(owner);
      }
    } else if (showStreetLabel) {
      const label = document.createElement('div');
      label.textContent = streetName;
      label.style.cssText = `
        margin-top: 1px; font-size: 8px; font-weight: 600;
        color: #1F2937; background: rgba(255,255,255,0.85);
        padding: 0px 3px; border-radius: 2px; white-space: nowrap;
        max-width: 60px; overflow: hidden; text-overflow: ellipsis;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        text-shadow: 0 0 2px white; line-height: 1.2;
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
    
    // Use actual visible map bounds instead of radius calculation
    const bounds = map.getBounds();
    const minLat = bounds.getSouth();
    const maxLat = bounds.getNorth();
    const minLng = bounds.getWest();
    const maxLng = bounds.getEast();
    
    // Create a bounds key from actual viewport corners
    const boundsKey = `${minLat.toFixed(4)}_${maxLat.toFixed(4)}_${minLng.toFixed(4)}_${maxLng.toFixed(4)}`;
    if (loadedBoundsRef.current === boundsKey) return;
    loadedBoundsRef.current = boundsKey;
    
    clearMarkers();
    
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
        const center = map.getCenter();
        const radiusKm = Math.max(
          (maxLat - minLat) * 111.32 / 2,
          (maxLng - minLng) * 111.32 * Math.cos(center.lat * Math.PI / 180) / 2
        );
        await loadParcelsFromEdgeFunction(center.lat, center.lng, radiusKm * 0.621371);
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
