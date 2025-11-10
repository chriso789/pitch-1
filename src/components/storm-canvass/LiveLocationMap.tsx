import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/integrations/supabase/client';
import NearbyPropertiesLayer from './NearbyPropertiesLayer';

interface LiveLocationMapProps {
  userLocation: { lat: number; lng: number };
  currentAddress: string;
}

export default function LiveLocationMap({ userLocation, currentAddress }: LiveLocationMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const userMarker = useRef<mapboxgl.Marker | null>(null);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);

  // Fetch Mapbox token
  useEffect(() => {
    const fetchToken = async () => {
      const { data, error } = await supabase.functions.invoke('get-mapbox-token');
      if (data?.token) {
        setMapboxToken(data.token);
      } else {
        console.error('Failed to fetch Mapbox token:', error);
      }
    };
    fetchToken();
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || !mapboxToken) return;
    if (map.current) return; // Only initialize once

    mapboxgl.accessToken = mapboxToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [userLocation.lng, userLocation.lat],
      zoom: 16,
      pitch: 45,
    });

    // Add navigation controls
    map.current.addControl(
      new mapboxgl.NavigationControl({
        visualizePitch: true,
      }),
      'top-right'
    );

    // Add scale control
    map.current.addControl(new mapboxgl.ScaleControl(), 'bottom-right');

    // Create user location marker (pulsing blue dot)
    const el = document.createElement('div');
    el.className = 'user-location-marker';
    el.style.width = '24px';
    el.style.height = '24px';
    el.style.borderRadius = '50%';
    el.style.backgroundColor = '#3b82f6';
    el.style.border = '3px solid white';
    el.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.3)';
    el.style.animation = 'pulse 2s infinite';

    userMarker.current = new mapboxgl.Marker(el)
      .setLngLat([userLocation.lng, userLocation.lat])
      .setPopup(
        new mapboxgl.Popup({ offset: 25 }).setHTML(
          `<div class="p-2"><strong>Your Location</strong><br/>${currentAddress}</div>`
        )
      )
      .addTo(map.current);

    return () => {
      map.current?.remove();
    };
  }, [mapboxToken]);

  // Update user location marker position
  useEffect(() => {
    if (userMarker.current && map.current) {
      userMarker.current.setLngLat([userLocation.lng, userLocation.lat]);
      
      // Animate map to new location (smooth follow)
      map.current.easeTo({
        center: [userLocation.lng, userLocation.lat],
        duration: 1000,
      });

      // Update popup content
      const popup = userMarker.current.getPopup();
      popup.setHTML(
        `<div class="p-2"><strong>Your Location</strong><br/>${currentAddress}</div>`
      );
    }
  }, [userLocation, currentAddress]);

  return (
    <>
      <div ref={mapContainer} className="absolute inset-0" />
      {map.current && mapboxToken && (
        <NearbyPropertiesLayer
          map={map.current}
          userLocation={userLocation}
        />
      )}
      <style>{`
        @keyframes pulse {
          0%, 100% {
            box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(59, 130, 246, 0.1);
          }
        }
      `}</style>
    </>
  );
}
