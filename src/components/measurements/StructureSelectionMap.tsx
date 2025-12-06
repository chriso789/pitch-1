import { useState, useRef, useEffect, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, MapPin, Move, CheckCircle2, AlertCircle } from 'lucide-react';
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
  const [error, setError] = useState<string | null>(null);
  const [pinPosition, setPinPosition] = useState({ lat: initialLat, lng: initialLng });
  const [distanceMoved, setDistanceMoved] = useState(0);
  const [hasInvalidCoords, setHasInvalidCoords] = useState(false);
  
  // Check for invalid coordinates (0,0 or very close to it)
  const isValidCoordinate = (lat: number, lng: number) => {
    return Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001;
  };

  // Sync pinPosition state with props when they change
  useEffect(() => {
    if (isValidCoordinate(initialLat, initialLng)) {
      setPinPosition({ lat: initialLat, lng: initialLng });
      setHasInvalidCoords(false);
      console.log('📍 StructureSelectionMap: Updated pinPosition from props:', { initialLat, initialLng });
    }
  }, [initialLat, initialLng]);

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

  const initMap = useCallback(async () => {
    if (!mapContainer.current) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Fetch Mapbox token with detailed logging
      console.log('📍 Fetching Mapbox token...');
      const { data, error: fnError } = await supabase.functions.invoke('get-mapbox-token');
      
      if (fnError) {
        console.error('❌ Edge function error:', fnError);
        throw new Error(`Failed to fetch Mapbox token: ${fnError.message}`);
      }
      
      if (!data?.token) {
        console.error('❌ No token in response:', data);
        throw new Error('Mapbox token not configured. Please add MAPBOX_PUBLIC_TOKEN to Supabase secrets.');
      }
      
      console.log('✅ Mapbox token received');
      mapboxgl.accessToken = data.token;

      // Create map with error handling
      console.log('📍 Initializing Mapbox map at:', { initialLat, initialLng });
      
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/satellite-v9',
        center: [initialLng, initialLat],
        zoom: 19,
        pitch: 0,
      });

      // Add navigation controls
      map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

      // Add error handler for map
      map.current.on('error', (e) => {
        console.error('❌ Mapbox error:', e);
        setError('Map failed to load. Please check your internet connection and try again.');
        setLoading(false);
      });

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
        console.log('✅ Mapbox map loaded successfully');
        setLoading(false);
      });

      // Timeout fallback in case load event never fires
      setTimeout(() => {
        setLoading(prev => {
          if (prev) {
            console.warn('⚠️ Map load timeout - forcing completion');
          }
          return false;
        });
      }, 10000); // 10 second timeout

    } catch (err) {
      console.error('❌ Map initialization error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load map');
      setLoading(false);
    }
  }, [initialLat, initialLng, calculateDistance]);

  // Initialize map - wait for container to be available
  useEffect(() => {
    if (!open) return;

    // Check for invalid coordinates before initializing map
    if (!isValidCoordinate(initialLat, initialLng)) {
      console.error('❌ Invalid coordinates received:', { initialLat, initialLng });
      setHasInvalidCoords(true);
      setLoading(false);
      return;
    }
    
    setHasInvalidCoords(false);
    
    // Small delay to ensure dialog content is rendered and mapContainer.current is available
    const timer = setTimeout(() => {
      if (mapContainer.current) {
        console.log('📍 MapContainer ready, initializing map...');
        initMap();
      } else {
        console.error('❌ MapContainer still not available after delay');
        setError('Map container not available. Please try again.');
        setLoading(false);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      marker.current?.remove();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [open, initialLat, initialLng, initMap]);

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
          {loading && !hasInvalidCoords && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          
          {/* Error State */}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
              <div className="bg-background p-6 rounded-lg shadow-lg max-w-md text-center">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Map Loading Error</h3>
                <p className="text-sm text-muted-foreground mb-4">{error}</p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => { setError(null); initMap(); }}>
                    Retry
                  </Button>
                </div>
              </div>
            </div>
          )}
          
          {/* Invalid Coordinates Error */}
          {hasInvalidCoords && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
              <div className="bg-background p-6 rounded-lg shadow-lg max-w-md text-center">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                  <MapPin className="h-6 w-6 text-destructive" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No Valid Coordinates</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This property doesn't have valid GPS coordinates. Please verify the address in the contact details first, 
                  or manually enter the property address to generate coordinates.
                </p>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
          
          <div ref={mapContainer} className="absolute inset-0" />
          
          {/* Instructions Overlay */}
          {!hasInvalidCoords && (
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
          )}

          {/* Distance Indicator */}
          {distanceMoved > 0 && !hasInvalidCoords && (
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
