import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

interface RouteVisualizationProps {
  map: mapboxgl.Map;
  userLocation: { lat: number; lng: number };
  destination: { lat: number; lng: number; address: string };
  polyline: string;
}

export default function RouteVisualization({
  map,
  userLocation,
  destination,
  polyline,
}: RouteVisualizationProps) {
  const destinationMarkerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    if (!map || !polyline) return;

    // Decode polyline to coordinates
    const coordinates = decodePolyline(polyline);

    // Add or update route source
    if (map.getSource('route')) {
      const source = map.getSource('route') as mapboxgl.GeoJSONSource;
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates,
        },
      });
    } else {
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates,
          },
        },
      });

      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': 'hsl(var(--primary))',
          'line-width': 5,
          'line-opacity': 0.8,
        },
      });
    }

    // Add destination marker with pulse animation
    if (destinationMarkerRef.current) {
      destinationMarkerRef.current.setLngLat([destination.lng, destination.lat]);
    } else {
      const el = document.createElement('div');
      el.className = 'destination-marker';
      el.style.width = '32px';
      el.style.height = '32px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = '#ef4444';
      el.style.border = '3px solid white';
      el.style.boxShadow = '0 0 0 4px rgba(239, 68, 68, 0.3)';
      el.style.animation = 'pulse 2s infinite';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.fontSize = '16px';
      el.textContent = '📍';

      destinationMarkerRef.current = new mapboxgl.Marker(el)
        .setLngLat([destination.lng, destination.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(
            `<div class="p-2"><strong>Destination</strong><br/>${destination.address}</div>`
          )
        )
        .addTo(map);
    }

    // Fit map bounds to show entire route
    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend([userLocation.lng, userLocation.lat]);
    bounds.extend([destination.lng, destination.lat]);

    map.fitBounds(bounds, {
      padding: { top: 120, bottom: 240, left: 60, right: 60 },
      duration: 1000,
    });

    return () => {
      // Cleanup on unmount
      if (map.getLayer('route')) {
        map.removeLayer('route');
      }
      if (map.getSource('route')) {
        map.removeSource('route');
      }
      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.remove();
        destinationMarkerRef.current = null;
      }
    };
  }, [map, userLocation, destination, polyline]);

  return null;
}

// Decode Google's encoded polyline format to coordinates [lng, lat]
function decodePolyline(encoded: string): Array<[number, number]> {
  const poly: Array<[number, number]> = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    poly.push([lng * 1e-5, lat * 1e-5]); // [lng, lat] for Mapbox
  }

  return poly;
}
