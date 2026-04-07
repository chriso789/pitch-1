import { useState, useRef, useEffect, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, MapPin, Move, CheckCircle2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PITCH_OPTIONS = [
  '0/12', '1/12', '2/12', '3/12', '4/12', '5/12', '6/12',
  '7/12', '8/12', '9/12', '10/12', '11/12', '12/12',
  '14/12', '16/12', '18/12'
];

interface StructureSelectionMapProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLat: number;
  initialLng: number;
  address?: string;
  onLocationConfirmed: (lat: number, lng: number, pitchOverride?: string) => void;
  defaultPitch?: string;
}

export function StructureSelectionMap({
  open,
  onOpenChange,
  initialLat,
  initialLng,
  address,
  onLocationConfirmed,
  defaultPitch = '6/12'
}: StructureSelectionMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinPosition, setPinPosition] = useState({ lat: initialLat, lng: initialLng });
  const [distanceMoved, setDistanceMoved] = useState(0);
  const [hasInvalidCoords, setHasInvalidCoords] = useState(false);
  const [selectedPitch, setSelectedPitch] = useState(defaultPitch);

  const isValidCoordinate = (lat: number, lng: number) => {
    return Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001;
  };

  useEffect(() => {
    if (isValidCoordinate(initialLat, initialLng)) {
      setPinPosition({ lat: initialLat, lng: initialLng });
      setHasInvalidCoords(false);
      console.log('📍 StructureSelectionMap: Updated pinPosition from props:', { initialLat, initialLng });
    }
  }, [initialLat, initialLng]);

  useEffect(() => {
    if (map.current && marker.current && isValidCoordinate(initialLat, initialLng)) {
      console.log('📍 Recentering map to updated coordinates:', { initialLat, initialLng });
      marker.current.setLngLat([initialLng, initialLat]);
      map.current.flyTo({
        center: [initialLng, initialLat],
        zoom: 19,
        duration: 1000
      });
      map.current.resize();
      map.current.triggerRepaint();
      setDistanceMoved(0);
    }
  }, [initialLat, initialLng]);

  const calculateDistance = useCallback((lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371e3;
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

    if (map.current) {
      map.current.resize();
      map.current.triggerRepaint();
      return;
    }

    setLoading(true);
    setError(null);

    try {
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

      const lat = initialLat;
      const lng = initialLng;

      console.log('📍 Initializing Mapbox map at:', { lat, lng });

      const newMap = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [lng, lat],
        zoom: 19,
        pitch: 0,
        maxPitch: 0,
        fadeDuration: 0,
      });

      map.current = newMap;

      newMap.addControl(
        new mapboxgl.NavigationControl({
          visualizePitch: false,
        }),
        'top-right'
      );

      newMap.on('error', (e) => {
        console.error('❌ Mapbox error:', e);
        setError('Map failed to load. Please check your internet connection and try again.');
        setLoading(false);
      });

      const pinElement = document.createElement('div');
      pinElement.innerHTML = `
        <div class="relative cursor-grab active:cursor-grabbing">
          <div class="absolute -top-1 -left-1 h-10 w-10 rounded-full bg-red-500/30 animate-ping"></div>
          <div class="relative flex h-8 w-8 items-center justify-center rounded-full bg-red-600 border-4 border-white shadow-lg">
            <svg class="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
            </svg>
          </div>
          <div class="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-2 py-1 text-xs text-white">
            Drag to roof
          </div>
        </div>
      `;

      marker.current = new mapboxgl.Marker({
        element: pinElement,
        draggable: true,
        anchor: 'bottom'
      })
        .setLngLat([lng, lat])
        .addTo(newMap);

      marker.current.on('dragend', () => {
        const lngLat = marker.current?.getLngLat();
        if (lngLat) {
          setPinPosition({ lat: lngLat.lat, lng: lngLat.lng });
          const distance = calculateDistance(lat, lng, lngLat.lat, lngLat.lng);
          setDistanceMoved(distance);
        }
      });

      let finalized = false;
      const finalizeMapReady = () => {
        if (finalized) return;
        finalized = true;
        console.log('✅ Mapbox map rendered successfully');
        setLoading(false);

        [0, 100, 300, 700, 1200].forEach((delay) => {
          window.setTimeout(() => {
            newMap.resize();
            newMap.triggerRepaint();
          }, delay);
        });
      };

      newMap.once('load', () => {
        console.log('✅ Mapbox style loaded successfully');
        [0, 100, 250].forEach((delay) => {
          window.setTimeout(() => {
            newMap.resize();
            newMap.triggerRepaint();
          }, delay);
        });
      });

      newMap.once('idle', () => {
        finalizeMapReady();
      });

      window.setTimeout(() => {
        if (!finalized) {
          console.warn('⚠️ Map idle timeout - forcing repaint');
          newMap.resize();
          newMap.triggerRepaint();
          finalizeMapReady();
        }
      }, 5000);
    } catch (err) {
      console.error('❌ Map initialization error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load map');
      setLoading(false);
    }
  }, [initialLat, initialLng, calculateDistance]);

  useEffect(() => {
    if (!open) return;

    if (!isValidCoordinate(initialLat, initialLng)) {
      console.error('❌ Invalid coordinates received:', { initialLat, initialLng });
      setHasInvalidCoords(true);
      setLoading(false);
      return;
    }

    setHasInvalidCoords(false);

    let observer: ResizeObserver | null = null;
    let initialized = false;
    let initTimer: number | null = null;
    let rafOne: number | null = null;
    let rafTwo: number | null = null;

    const scheduleInit = () => {
      if (initialized) return;
      const el = mapContainer.current;
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        initialized = true;
        console.log('📍 MapContainer has dimensions:', el.offsetWidth, 'x', el.offsetHeight);

        rafOne = window.requestAnimationFrame(() => {
          rafTwo = window.requestAnimationFrame(() => {
            initTimer = window.setTimeout(() => {
              initMap();
            }, 180);
          });
        });

        observer?.disconnect();
      }
    };

    initTimer = window.setTimeout(scheduleInit, 120);

    if (mapContainer.current) {
      observer = new ResizeObserver(scheduleInit);
      observer.observe(mapContainer.current);
    }

    return () => {
      if (rafOne !== null) window.cancelAnimationFrame(rafOne);
      if (rafTwo !== null) window.cancelAnimationFrame(rafTwo);
      if (initTimer !== null) window.clearTimeout(initTimer);
      observer?.disconnect();
      marker.current?.remove();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [open, initialLat, initialLng, initMap]);

  const handleConfirm = () => {
    onLocationConfirmed(pinPosition.lat, pinPosition.lng, selectedPitch);
    onOpenChange(false);
  };

  const handleReset = () => {
    if (marker.current && map.current) {
      marker.current.setLngLat([initialLng, initialLat]);
      map.current.flyTo({ center: [initialLng, initialLat], zoom: 19 });
      map.current.resize();
      map.current.triggerRepaint();
      setPinPosition({ lat: initialLat, lng: initialLng });
      setDistanceMoved(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] sm:h-[80vh] max-h-[90vh] !flex flex-col p-0 gap-0 overflow-hidden data-[state=open]:animate-none data-[state=closed]:animate-none">
        <DialogHeader className="p-3 sm:p-4 pb-2 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
            <MapPin className="h-4 w-4 sm:h-5 sm:w-5 text-red-600" />
            Select Main Dwelling Structure
          </DialogTitle>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Drag the red PIN to the center of the <strong>main house roof</strong>.
          </p>
          {address && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              📍 {address}
            </p>
          )}

          <div className="flex items-center gap-2 mt-2 pt-2 border-t">
            <Label className="text-xs whitespace-nowrap">Roof Pitch:</Label>
            <Select value={selectedPitch} onValueChange={setSelectedPitch}>
              <SelectTrigger className="w-24 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background z-[300]">
                {PITCH_OPTIONS.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">(affects area calculation)</span>
          </div>
        </DialogHeader>

        <div className="flex-1 relative min-h-0 overflow-hidden bg-muted/20">
          {loading && !hasInvalidCoords && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

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

          {distanceMoved > 0 && !hasInvalidCoords && (
            <div className="absolute bottom-4 left-4 z-10">
              <Badge
                variant={distanceMoved > 10 ? 'default' : 'secondary'}
                className="text-sm px-3 py-1"
              >
                Moved: {distanceMoved < 1 ? `${Math.round(distanceMoved * 100)}cm` : `${distanceMoved.toFixed(1)}m`}
              </Badge>
            </div>
          )}
        </div>

        <DialogFooter className="p-3 sm:p-4 pb-4 sm:pb-6 border-t bg-background flex flex-col gap-2 shrink-0">
          <div className="flex flex-row gap-2 w-full">
            <Button variant="outline" size="sm" onClick={handleReset} className="flex-1 sm:flex-none sm:w-auto">
              Reset
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none sm:w-auto">
              Cancel
            </Button>
            <Button onClick={handleConfirm} size="sm" className="gap-1 flex-1 sm:flex-none sm:w-auto">
              <CheckCircle2 className="h-4 w-4" />
              <span className="hidden sm:inline">Confirm & Measure</span>
              <span className="sm:hidden">Confirm</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
