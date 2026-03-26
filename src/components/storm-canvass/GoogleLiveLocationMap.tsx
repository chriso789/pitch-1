/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useGoogleMapsToken } from '@/hooks/useGoogleMapsToken';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import GooglePropertyMarkersLayer from './GooglePropertyMarkersLayer';
import GoogleRouteVisualization from './GoogleRouteVisualization';
import { MapStyle } from './MapStyleToggle';

import { type SymbolSettings } from './MapSymbolSettings';

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
  refreshKey?: number;
  areaPropertyIds?: string[];
  areaPolygon?: any;
  onMapClick?: (lat: number, lng: number) => void;
  followUser?: boolean;
  onUserInteraction?: () => void;
  symbolSettings?: SymbolSettings;
  initialZoom?: number;
}

const MAP_TYPE_IDS: Record<MapStyle, string> = {
  'satellite': 'hybrid',
  'lot-lines': 'roadmap',
};

// Suppress Google's native address/house-number labels so only our custom
// markers show street numbers — prevents the "double pin" visual effect.
function getMapStyles(style: MapStyle): google.maps.MapTypeStyle[] {
  const hideLabels: google.maps.MapTypeStyle[] = [
    // Hide road number labels (the small house-number text Google renders)
    { featureType: 'road', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
    // Hide POI labels entirely
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    // Hide transit labels
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  ];

  if (style === 'lot-lines') {
    return [
      ...hideLabels,
      // Keep road geometry visible on roadmap
      { featureType: 'road', elementType: 'geometry', stylers: [{ visibility: 'on' }] },
      // Keep road name labels for navigation context
      { featureType: 'road', elementType: 'labels.text', stylers: [{ visibility: 'on' }] },
      // But hide the small address/number labels that Google adds on buildings
      { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ visibility: 'simplified' }] },
    ];
  }

  // Satellite/hybrid: hide ALL text labels — our markers are the only numbering system
  return [
    ...hideLabels,
    { featureType: 'all', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
    // Keep major road labels so users can navigate
    { featureType: 'road.arterial', elementType: 'labels.text', stylers: [{ visibility: 'on' }] },
    { featureType: 'road.highway', elementType: 'labels.text', stylers: [{ visibility: 'on' }] },
  ];
}

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
  areaPropertyIds,
  areaPolygon,
  onMapClick,
  followUser = true,
  onUserInteraction,
  symbolSettings,
  initialZoom,
}: GoogleLiveLocationMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const userMarker = useRef<google.maps.Marker | null>(null);
  const areaOverlayRef = useRef<google.maps.Polygon | null>(null);
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
          zoom: initialZoom ?? 18,
          tilt: 0,
          heading: 0,
          mapTypeId: MAP_TYPE_IDS[mapStyle],
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: false,
          zoomControl: false,
          rotateControl: false,
          scaleControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
          keyboardShortcuts: false,
          styles: getMapStyles(mapStyle),
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

        // Prevent 3D tilt - reset immediately if user triggers it
        map.current.addListener('tilt_changed', () => {
          if (map.current && map.current.getTilt() !== 0) {
            map.current.setTilt(0);
          }
        });

        // Also prevent rotation
        map.current.addListener('heading_changed', () => {
          if (map.current && map.current.getHeading() !== 0) {
            map.current.setHeading(0);
          }
        });

        // Detect user interaction (drag/zoom) to pause auto-follow
        if (onUserInteraction) {
          map.current.addListener('dragstart', () => onUserInteraction());
        }

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

  // Map click listener for canvass mode
  useEffect(() => {
    if (!map.current || !mapReady || !onMapClick) return;

    const listener = map.current.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) {
        onMapClick(e.latLng.lat(), e.latLng.lng());
      }
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [mapReady, onMapClick]);

  // Update map style when changed
  useEffect(() => {
    if (!map.current || !mapReady) return;
    
    map.current.setMapTypeId(MAP_TYPE_IDS[mapStyle]);
    map.current.setOptions({ styles: getMapStyles(mapStyle) });
  }, [mapStyle, mapReady]);

  // Update user location marker
  useEffect(() => {
    if (!map.current || !userMarker.current || !mapReady) return;
    
    const newPos = { lat: userLocation.lat, lng: userLocation.lng };
    userMarker.current.setPosition(newPos);
    
    // Only pan to user in knock/follow mode
    if (!followUser) return;
    
    const center = map.current.getCenter();
    if (center) {
      const distance = google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(center.lat(), center.lng()),
        new google.maps.LatLng(newPos.lat, newPos.lng)
      );
      if (distance > 10) {
        map.current.panTo(newPos);
      }
    }
  }, [userLocation, mapReady, followUser]);

  // Render area polygon overlay
  useEffect(() => {
    if (!map.current || !mapReady) return;

    // Remove previous overlay
    if (areaOverlayRef.current) {
      areaOverlayRef.current.setMap(null);
      areaOverlayRef.current = null;
    }

    if (!areaPolygon) return;

    const coords = areaPolygon?.coordinates?.[0] || areaPolygon?.geometry?.coordinates?.[0];
    if (!coords || coords.length < 3) return;

    const path = coords.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
    areaOverlayRef.current = new google.maps.Polygon({
      paths: path,
      fillColor: '#3b82f6',
      fillOpacity: 0.08,
      strokeColor: '#3b82f6',
      strokeWeight: 2,
      strokeOpacity: 0.6,
      map: map.current,
      clickable: false,
    });

    return () => {
      if (areaOverlayRef.current) {
        areaOverlayRef.current.setMap(null);
        areaOverlayRef.current = null;
      }
    };
  }, [areaPolygon, mapReady]);

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
            map={map.current}
            userLocation={userLocation}
            onPropertyClick={onParcelSelect}
            onLoadingChange={onLoadingChange}
            onPropertiesLoaded={onPropertiesLoaded}
            areaPropertyIds={areaPropertyIds}
            refreshKey={refreshKey}
            symbolSettings={symbolSettings}
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
