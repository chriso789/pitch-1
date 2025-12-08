import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import NearbyPropertiesLayer from './NearbyPropertiesLayer';
import RouteVisualization from './RouteVisualization';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { Loader2 } from 'lucide-react';

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  address_street: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  latitude: number;
  longitude: number;
  qualification_status?: string;
  metadata?: any;
  phone?: string;
  email?: string;
}

interface LiveLocationMapProps {
  userLocation: { lat: number; lng: number };
  currentAddress: string;
  onContactSelect: (contact: Contact) => void;
  routeData?: {
    distance: { distance: number; unit: string };
    duration: number;
    polyline: string;
  } | null;
  destination?: { lat: number; lng: number; address: string } | null;
}

export default function LiveLocationMap({
  userLocation,
  currentAddress,
  onContactSelect,
  routeData,
  destination,
}: LiveLocationMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const userMarker = useRef<mapboxgl.Marker | null>(null);
  const mapInitialized = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const { token, loading: tokenLoading } = useMapboxToken();

  // Initialize map once token is available
  useEffect(() => {
    if (!mapContainer.current || !token) return;
    if (mapInitialized.current) return; // Only initialize once

    mapboxgl.accessToken = token;
    mapInitialized.current = true;

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

    // Wait for map to fully load before setting ready state
    map.current.on('load', () => {
      setMapReady(true);
      
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
        .addTo(map.current!);
    });

    return () => {
      map.current?.remove();
    };
  }, [token]);

  // Update user location marker position
  useEffect(() => {
    if (userMarker.current && map.current && mapReady) {
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
  }, [userLocation, currentAddress, mapReady]);

  if (tokenLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <div ref={mapContainer} className="absolute inset-0" />
      {mapReady && map.current && (
        <>
          <NearbyPropertiesLayer
            map={map.current}
            userLocation={userLocation}
            onContactSelect={onContactSelect}
          />
          {routeData && destination && (
            <RouteVisualization
              map={map.current}
              userLocation={userLocation}
              destination={destination}
              polyline={routeData.polyline}
            />
          )}
        </>
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
