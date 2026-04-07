import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, MapPin, CheckCircle2, AlertCircle } from 'lucide-react';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPitch, setSelectedPitch] = useState(defaultPitch);
  const [satelliteUrl, setSatelliteUrl] = useState<string | null>(null);
  const [hasInvalidCoords, setHasInvalidCoords] = useState(false);

  const isValidCoordinate = (lat: number, lng: number) => {
    return Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001;
  };

  useEffect(() => {
    if (!open) return;

    if (!isValidCoordinate(initialLat, initialLng)) {
      setHasInvalidCoords(true);
      setLoading(false);
      return;
    }

    setHasInvalidCoords(false);
    setLoading(true);
    setError(null);

    const fetchToken = async () => {
      try {
        const { data, error: fnError } = await supabase.functions.invoke('get-mapbox-token');
        if (fnError || !data?.token) {
          throw new Error('Mapbox token not configured');
        }

        const token = data.token;
        const lng = initialLng.toFixed(6);
        const lat = initialLat.toFixed(6);
        
        // Mapbox Static Images API - satellite with streets, pin marker
        const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-l-building+ef4444(${lng},${lat})/${lng},${lat},19,0/800x600@2x?access_token=${token}`;
        
        setSatelliteUrl(url);
      } catch (err) {
        console.error('Failed to load satellite image:', err);
        setError(err instanceof Error ? err.message : 'Failed to load satellite image');
        setLoading(false);
      }
    };

    fetchToken();
  }, [open, initialLat, initialLng]);

  const handleConfirm = () => {
    onLocationConfirmed(initialLat, initialLng, selectedPitch);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-auto max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-3 sm:p-4 pb-2 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
            <MapPin className="h-4 w-4 sm:h-5 sm:w-5 text-red-600" />
            Confirm Property Location
          </DialogTitle>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Verify this is the correct property for AI roof measurement.
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

        <div className="flex-1 relative min-h-[300px] sm:min-h-[450px] bg-muted/20 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Loading satellite view...</span>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
              <div className="bg-background p-6 rounded-lg shadow-lg max-w-md text-center">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Image Loading Error</h3>
                <p className="text-sm text-muted-foreground mb-4">{error}</p>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
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
                  This property doesn't have valid GPS coordinates. Please verify the address first.
                </p>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              </div>
            </div>
          )}

          {satelliteUrl && !error && !hasInvalidCoords && (
            <img
              src={satelliteUrl}
              alt="Satellite view of property"
              className="w-full h-full object-cover"
              onLoad={() => setLoading(false)}
              onError={() => {
                setError('Failed to load satellite imagery. Please try again.');
                setLoading(false);
              }}
            />
          )}
        </div>

        <DialogFooter className="p-3 sm:p-4 pb-4 sm:pb-6 border-t bg-background flex flex-col gap-2 shrink-0">
          <div className="flex flex-row gap-2 w-full">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none sm:w-auto">
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              size="sm"
              className="gap-1 flex-1 sm:flex-none sm:w-auto"
              disabled={loading || !!error || hasInvalidCoords}
            >
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
