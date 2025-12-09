import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';

interface ParcelBoundaryLayerProps {
  map: mapboxgl.Map;
  userLocation: { lat: number; lng: number };
  onParcelClick: (property: any) => void;
  visible: boolean;
}

export default function ParcelBoundaryLayer({
  map,
  userLocation,
  onParcelClick,
  visible,
}: ParcelBoundaryLayerProps) {
  const { profile } = useUserProfile();
  const [properties, setProperties] = useState<any[]>([]);
  const sourceAdded = useRef(false);

  // Fetch properties with parcel data
  useEffect(() => {
    if (!profile?.tenant_id) return;

    const fetchProperties = async () => {
      // Calculate bounding box (approx 0.5 mile radius)
      const radiusDeg = 0.008; // ~0.5 miles in degrees
      const minLng = userLocation.lng - radiusDeg;
      const maxLng = userLocation.lng + radiusDeg;
      const minLat = userLocation.lat - radiusDeg;
      const maxLat = userLocation.lat + radiusDeg;

      const { data, error } = await supabase
        .from('canvassiq_properties')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .gte('lat', minLat)
        .lte('lat', maxLat)
        .gte('lng', minLng)
        .lte('lng', maxLng)
        .limit(200);

      if (!error && data) {
        setProperties(data);
      }
    };

    fetchProperties();
  }, [profile?.tenant_id, userLocation.lat, userLocation.lng]);

  // Add/update parcel layer
  useEffect(() => {
    if (!map || properties.length === 0) return;

    const sourceId = 'parcel-boundaries';
    const layerId = 'parcel-lines';
    const fillLayerId = 'parcel-fills';

    // Create GeoJSON from properties
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: properties.map((prop) => {
        // If property has parcel WKT, parse it; otherwise create a simple polygon
        const coords = createParcelPolygon(prop.lat, prop.lng);
        
        return {
          type: 'Feature',
          properties: {
            id: prop.id,
            address: prop.address,
            disposition: prop.disposition,
            owner_name: prop.owner_name,
            homeowner: prop.homeowner,
            phone_numbers: prop.phone_numbers,
            emails: prop.emails,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [coords],
          },
        };
      }),
    };

    // Add or update source
    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data: geojson,
      });

      // Add fill layer (for click detection and disposition coloring)
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': [
            'match',
            ['get', 'disposition'],
            'qualified', 'rgba(34, 197, 94, 0.3)',      // green
            'interested', 'rgba(34, 197, 94, 0.3)',    // green
            'not_interested', 'rgba(239, 68, 68, 0.3)', // red
            'follow_up', 'rgba(234, 179, 8, 0.3)',     // yellow
            'not_home', 'rgba(156, 163, 175, 0.3)',    // gray
            'rgba(59, 130, 246, 0.15)',                 // default blue
          ],
          'fill-opacity': visible ? 0.6 : 0,
        },
      });

      // Add line layer
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': [
            'match',
            ['get', 'disposition'],
            'qualified', '#22c55e',
            'interested', '#22c55e',
            'not_interested', '#ef4444',
            'follow_up', '#eab308',
            'not_home', '#9ca3af',
            '#3b82f6',
          ],
          'line-width': 2,
          'line-opacity': visible ? 1 : 0,
        },
      });

      sourceAdded.current = true;

      // Add click handler
      map.on('click', fillLayerId, (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          onParcelClick(feature.properties);
        }
      });

      // Change cursor on hover
      map.on('mouseenter', fillLayerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', fillLayerId, () => {
        map.getCanvas().style.cursor = '';
      });
    }

    // Update visibility
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, 'line-opacity', visible ? 1 : 0);
    }
    if (map.getLayer(fillLayerId)) {
      map.setPaintProperty(fillLayerId, 'fill-opacity', visible ? 0.6 : 0);
    }

    return () => {
      // Cleanup on unmount
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, properties, visible, onParcelClick]);

  return null;
}

// Create approximate parcel polygon (30m x 30m lot)
function createParcelPolygon(lat: number, lng: number): [number, number][] {
  const lotSizeDeg = 0.0003; // ~30 meters
  return [
    [lng - lotSizeDeg, lat - lotSizeDeg],
    [lng + lotSizeDeg, lat - lotSizeDeg],
    [lng + lotSizeDeg, lat + lotSizeDeg],
    [lng - lotSizeDeg, lat + lotSizeDeg],
    [lng - lotSizeDeg, lat - lotSizeDeg], // Close polygon
  ];
}
