/// <reference types="@types/google.maps" />
import { useEffect, useRef } from 'react';

interface GoogleRouteVisualizationProps {
  map: google.maps.Map;
  destination: { lat: number; lng: number; address: string };
  polyline: string;
}

export default function GoogleRouteVisualization({
  map,
  destination,
  polyline,
}: GoogleRouteVisualizationProps) {
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  useEffect(() => {
    if (!map || !polyline) return;

    // Decode the polyline using Google's geometry library
    let path: google.maps.LatLng[];
    try {
      path = google.maps.geometry.encoding.decodePath(polyline);
    } catch (err) {
      console.error('Failed to decode polyline:', err);
      return;
    }

    // Create route polyline
    polylineRef.current = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: '#3b82f6',
      strokeOpacity: 0.9,
      strokeWeight: 5,
      map,
      zIndex: 100,
    });

    // Create destination marker
    markerRef.current = new google.maps.Marker({
      position: destination,
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 14,
        fillColor: '#ef4444',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3,
      },
      title: destination.address,
      zIndex: 1000,
    });

    // Add info window to destination marker
    const infoWindow = new google.maps.InfoWindow({
      content: `<div style="padding: 4px 8px; font-weight: 500;">${destination.address}</div>`,
    });

    markerRef.current.addListener('click', () => {
      infoWindow.open(map, markerRef.current);
    });

    // Fit bounds to show entire route
    const bounds = new google.maps.LatLngBounds();
    path.forEach(point => bounds.extend(point));
    bounds.extend(new google.maps.LatLng(destination.lat, destination.lng));
    map.fitBounds(bounds, { top: 100, bottom: 100, left: 50, right: 50 });

    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
    };
  }, [map, destination, polyline]);

  return null;
}
