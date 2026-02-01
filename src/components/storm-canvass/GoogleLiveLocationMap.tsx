/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useGoogleMapsToken } from '@/hooks/useGoogleMapsToken';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import GooglePropertyMarkersLayer from './GooglePropertyMarkersLayer';
import GoogleRouteVisualization from './GoogleRouteVisualization';
import { MapStyle } from './MapStyleToggle';

interface GoogleLiveLocationMapProps {
  userLocation: { lat: number; lng: number };
  currentAddress: string;
  onContactSelect: (contact: any) => void;
  onParcelSelect: (property: any) => void;
  routeData?: { polyline: string; distance?: any; duration?: number } | null;
  destination?: { lat: number; lng: number; address: string } | null;
  mapStyle: MapStyle;
  onLoadingChange?: (isLoading: boolean) => void;
  onPropertiesLoaded?: (count: number) => void;
  refreshKey?: number; // Incremented to force marker refresh
}

const MAP_TYPE_IDS: Record<MapStyle, string> = {
  'satellite': 'hybrid',
  'lot-lines': 'roadmap',
};

export default function GoogleLiveLocationMap({
  userLocation,
  currentAddress,
  onContactSelect,
  onParcelSelect,
  routeData,
  destination,
  mapStyle,
  onLoadingChange,
  onPropertiesLoaded,
  refreshKey,
}: GoogleLiveLocationMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const userMarker = useRef<google.maps.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const { apiKey, loading: tokenLoading, error: tokenError } = useGoogleMapsToken();

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || !apiKey) return;

    let mounted = true;

    const initMap = async () => {
      try {
        await loadGoogleMaps(apiKey);
        
        if (!mounted || !mapContainer.current) return;

        map.current = new google.maps.Map(mapContainer.current, {
          center: { lat: userLocation.lat, lng: userLocation.lng },
          zoom: 18,
          mapTypeId: MAP_TYPE_IDS[mapStyle],
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: false,
          zoomControl: true,
          zoomControlOptions: {
            position: google.maps.ControlPosition.RIGHT_CENTER,
          },
          styles: mapStyle === 'lot-lines' ? [
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'off' }] },
          ] : [],
        });

        // User location marker (pulsing blue dot)
        userMarker.current = new google.maps.Marker({
          position: { lat: userLocation.lat, lng: userLocation.lng },
          map: map.current,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: '#3b82f6',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3,
          },
          title: 'Your Location',
          zIndex: 9999,
        });

        setMapReady(true);
      } catch (err) {
        console.error('Failed to initialize Google Maps:', err);
      }
    };

    initMap();

    return () => {
      mounted = false;
      if (userMarker.current) {
        userMarker.current.setMap(null);
        userMarker.current = null;
      }
      map.current = null;
      setMapReady(false);
    };
  }, [apiKey]);

  // Update map style when changed
  useEffect(() => {
    if (!map.current || !mapReady) return;
    
    map.current.setMapTypeId(MAP_TYPE_IDS[mapStyle]);
    
    if (mapStyle === 'lot-lines') {
      map.current.setOptions({
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        ],
      });
    } else {
      map.current.setOptions({ styles: [] });
    }
  }, [mapStyle, mapReady]);

  // Update user location marker
  useEffect(() => {
    if (!map.current || !userMarker.current || !mapReady) return;
    
    const newPos = { lat: userLocation.lat, lng: userLocation.lng };
    userMarker.current.setPosition(newPos);
    
    // Only pan if user is far from center
    const center = map.current.getCenter();
    if (center) {
      const distance = google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(center.lat(), center.lng()),
        new google.maps.LatLng(newPos.lat, newPos.lng)
      );
      // If more than 50 meters away, pan to user
      if (distance > 50) {
        map.current.panTo(newPos);
      }
    }
  }, [userLocation, mapReady]);

  if (tokenLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading map...</span>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background">
        <div className="text-center text-destructive">
          <p className="font-medium">Failed to load map</p>
          <p className="text-sm text-muted-foreground">{tokenError}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={mapContainer} className="absolute inset-0" />
      {mapReady && map.current && (
        <>
          <GooglePropertyMarkersLayer
            key={`markers-${refreshKey || 0}`}
            map={map.current}
            userLocation={userLocation}
            onPropertyClick={onParcelSelect}
            onLoadingChange={onLoadingChange}
            onPropertiesLoaded={onPropertiesLoaded}
          />
          {routeData?.polyline && destination && (
            <GoogleRouteVisualization
              map={map.current}
              destination={destination}
              polyline={routeData.polyline}
            />
          )}
        </>
      )}
    </>
  );
}
