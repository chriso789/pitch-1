import { useState, useRef, useEffect, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, MapPin, Move, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface StructureSelectionMapProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLat: number;
  initialLng: number;
  address?: string;
  onLocationConfirmed: (lat: number, lng: number) => void;
}

export function StructureSelectionMap({
  open,
  onOpenChange,
  initialLat,
  initialLng,
  address,
  onLocationConfirmed
}: StructureSelectionMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [pinPosition, setPinPosition] = useState({ lat: initialLat, lng: initialLng });
  const [distanceMoved, setDistanceMoved] = useState(0);

  // Calculate distance between two points in meters
  const calculateDistance = useCallback((lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }, []);

  // Initialize map
  useEffect(() => {
    if (!open || !mapContainer.current) return;

    const initMap = async () => {
      setLoading(true);
      
      try {
        // Fetch Mapbox token
        const { data } = await supabase.functions.invoke('get-mapbox-token');
        if (!data?.token) throw new Error('No Mapbox token');
        
        mapboxgl.accessToken = data.token;

        // Create map
        map.current = new mapboxgl.Map({
          container: mapContainer.current!,
          style: 'mapbox://styles/mapbox/satellite-v9',
          center: [initialLng, initialLat],
          zoom: 19,
          pitch: 0,
        });

        // Add navigation controls
        map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

        // Create custom PIN element
        const pinElement = document.createElement('div');
        pinElement.innerHTML = `
          <div class="relative cursor-grab active:cursor-grabbing">
            <div class="absolute -top-1 -left-1 w-10 h-10 bg-red-500/30 rounded-full animate-ping"></div>
            <div class="relative flex items-center justify-center w-8 h-8 bg-red-600 rounded-full border-4 border-white shadow-lg">
              <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
              </svg>
            </div>
            <div class="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/80 text-white text-xs px-2 py-1 rounded">
              Drag to roof
            </div>
          </div>
        `;

        // Create draggable marker
        marker.current = new mapboxgl.Marker({
          element: pinElement,
          draggable: true,
          anchor: 'bottom'
        })
          .setLngLat([initialLng, initialLat])
          .addTo(map.current);

        // Handle marker drag
        marker.current.on('dragend', () => {
          const lngLat = marker.current?.getLngLat();
          if (lngLat) {
            setPinPosition({ lat: lngLat.lat, lng: lngLat.lng });
            const distance = calculateDistance(initialLat, initialLng, lngLat.lat, lngLat.lng);
            setDistanceMoved(distance);
          }
        });

        map.current.on('load', () => {
          setLoading(false);
        });

      } catch (error) {
        console.error('Map initialization error:', error);
        setLoading(false);
      }
    };

    initMap();

    return () => {
      marker.current?.remove();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [open, initialLat, initialLng, calculateDistance]);

  const handleConfirm = () => {
    onLocationConfirmed(pinPosition.lat, pinPosition.lng);
    onOpenChange(false);
  };

  const handleReset = () => {
    if (marker.current && map.current) {
      marker.current.setLngLat([initialLng, initialLat]);
      map.current.flyTo({ center: [initialLng, initialLat], zoom: 19 });
      setPinPosition({ lat: initialLat, lng: initialLng });
      setDistanceMoved(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-red-600" />
            Select Main Dwelling Structure
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Drag the red PIN to the center of the <strong>main house roof</strong> you want to measure.
          </p>
          {address && (
            <p className="text-xs text-muted-foreground mt-1">
              📍 {address}
            </p>
          )}
        </DialogHeader>

        {/* Map Container */}
        <div className="flex-1 relative min-h-[400px]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          <div ref={mapContainer} className="absolute inset-0" />
          
          {/* Instructions Overlay */}
          <div className="absolute top-4 left-4 bg-background/95 backdrop-blur p-3 rounded-lg shadow-lg max-w-xs z-10">
            <div className="flex items-start gap-2">
              <Move className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Drag the PIN</p>
                <p className="text-xs text-muted-foreground">
                  Position it on the <strong>main dwelling roof</strong>, not sheds, garages, or other structures.
                </p>
              </div>
            </div>
          </div>

          {/* Distance Indicator */}
          {distanceMoved > 0 && (
            <div className="absolute bottom-4 left-4 z-10">
              <Badge 
                variant={distanceMoved > 10 ? "default" : "secondary"} 
                className="text-sm px-3 py-1"
              >
                Moved: {distanceMoved < 1 ? `${Math.round(distanceMoved * 100)}cm` : `${distanceMoved.toFixed(1)}m`}
              </Badge>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t bg-muted/30 flex-row justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              Reset Position
            </Button>
            <span className="text-xs text-muted-foreground">
              Lat: {pinPosition.lat.toFixed(6)}, Lng: {pinPosition.lng.toFixed(6)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Confirm & Measure
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
