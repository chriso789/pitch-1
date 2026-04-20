import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, MapPin, RotateCcw } from 'lucide-react';

/**
 * Lightweight pin-confirmation dialog.
 *
 * Shows a high-resolution Google/Mapbox static satellite tile centered on the
 * incoming lat/lng. The user clicks the roof of the *correct* house to drop a
 * pin; we convert the click pixel offset back to a precise lat/lng using the
 * Web-Mercator math that matches the static-tile zoom level. The confirmed
 * coordinates are passed to the caller so the AI overlay generator crops the
 * imagery on the actual house instead of the cached parcel centroid.
 */

interface PinConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  initialLat: number;
  initialLng: number;
  address?: string;
  onConfirm: (lat: number, lng: number) => void;
  confirming?: boolean;
}

const IMG_SIZE = 640; // px (we render @2x for retina)
const ZOOM = 20;       // matches Mapbox/Google static maps "very close" parcel zoom

// Convert a pixel offset (relative to the static-tile center) into a lat/lng
// delta. At Web-Mercator zoom Z, ground resolution at latitude φ is:
//     metersPerPixel = 156543.03392 * cos(φ) / 2^Z
// We convert to degrees: 1° lat ≈ 111_320 m, 1° lng ≈ 111_320 * cos(φ) m.
function pixelOffsetToLatLng(
  centerLat: number,
  centerLng: number,
  dxPx: number,
  dyPx: number,
  zoom: number,
): { lat: number; lng: number } {
  const metersPerPixel =
    (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) / Math.pow(2, zoom);
  const dxMeters = dxPx * metersPerPixel;
  const dyMeters = dyPx * metersPerPixel;
  const dLat = -dyMeters / 111320; // y grows downward; lat grows northward
  const dLng = dxMeters / (111320 * Math.cos((centerLat * Math.PI) / 180));
  return { lat: centerLat + dLat, lng: centerLng + dLng };
}

export function PinConfirmDialog({
  open,
  onClose,
  initialLat,
  initialLng,
  address,
  onConfirm,
  confirming = false,
}: PinConfirmDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // pin position in *pixels* relative to the rendered image (not the underlying
  // 640px source — we read the rendered DOM size for accuracy).
  const [pinPx, setPinPx] = useState<{ x: number; y: number } | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [renderedSize, setRenderedSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  // Reset when reopened
  useEffect(() => {
    if (open) {
      setPinPx(null);
      setImgLoaded(false);
    }
  }, [open, initialLat, initialLng]);

  // Build the static satellite URL — Google first, Mapbox fallback (matches
  // FootprintDrawingDialog conventions).
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapboxToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN;
  const imgSrc = googleKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${initialLat},${initialLng}&zoom=${ZOOM}&size=${IMG_SIZE}x${IMG_SIZE}&scale=2&maptype=satellite&key=${googleKey}`
    : mapboxToken
    ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${initialLng},${initialLat},${ZOOM}/${IMG_SIZE}x${IMG_SIZE}@2x?access_token=${mapboxToken}`
    : '';

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.currentTarget;
    setRenderedSize({ w: target.clientWidth, h: target.clientHeight });
    setImgLoaded(true);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgLoaded || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPinPx({ x, y });
  };

  const handleConfirm = () => {
    if (!pinPx) {
      // No nudge — caller can use original coords
      onConfirm(initialLat, initialLng);
      return;
    }
    const w = renderedSize.w || 1;
    const h = renderedSize.h || 1;
    // Pixel offset from the *rendered* image center
    const dxPx = pinPx.x - w / 2;
    const dyPx = pinPx.y - h / 2;
    // Scale to the underlying static-tile pixel space (640px source)
    const scaleX = IMG_SIZE / w;
    const scaleY = IMG_SIZE / h;
    const { lat, lng } = pixelOffsetToLatLng(
      initialLat,
      initialLng,
      dxPx * scaleX,
      dyPx * scaleY,
      ZOOM,
    );
    onConfirm(lat, lng);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !confirming && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Confirm the house location
          </DialogTitle>
          <DialogDescription>
            {address ? (
              <>
                <span className="font-medium text-foreground">{address}</span> —
                click directly on the correct roof to lock the pin before the AI
                overlay runs.
              </>
            ) : (
              'Click directly on the correct roof to lock the pin before the AI overlay runs.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={containerRef}
          onClick={handleClick}
          className="relative w-full aspect-square overflow-hidden rounded-md border border-border bg-muted cursor-crosshair select-none"
        >
          {!imgSrc && (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              No map provider configured (set VITE_GOOGLE_MAPS_API_KEY or
              VITE_MAPBOX_PUBLIC_TOKEN).
            </div>
          )}
          {imgSrc && (
            <img
              src={imgSrc}
              alt="Satellite view"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              onLoad={handleImgLoad}
              draggable={false}
            />
          )}
          {!imgLoaded && imgSrc && (
            <div className="absolute inset-0 grid place-items-center bg-background/40">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {/* Original cached pin (faded) */}
          {imgLoaded && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -100%)',
              }}
              title="Original coordinates"
            >
              <MapPin className="h-7 w-7 text-muted-foreground/70 drop-shadow" />
            </div>
          )}

          {/* New confirmed pin */}
          {pinPx && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: pinPx.x,
                top: pinPx.y,
                transform: 'translate(-50%, -100%)',
              }}
            >
              <MapPin className="h-9 w-9 text-primary drop-shadow-lg fill-primary/30" />
            </div>
          )}

          {/* Hint pill */}
          {imgLoaded && !pinPx && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-background/85 backdrop-blur text-xs font-medium border border-border">
              Click on the correct roof
            </div>
          )}
        </div>

        <DialogFooter className="flex sm:justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPinPx(null)}
            disabled={!pinPx || confirming}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={confirming}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={confirming}>
              {confirming ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Running…
                </>
              ) : pinPx ? (
                'Confirm & Run AI'
              ) : (
                'Use Original & Run AI'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
