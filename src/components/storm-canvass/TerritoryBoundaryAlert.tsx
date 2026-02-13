import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TerritoryBoundaryAlertProps {
  userLocation: { lat: number; lng: number };
  areaPolygon: any; // GeoJSON Polygon
}

// Ray-casting point-in-polygon. GeoJSON coords are [lng, lat].
function pointInPolygon(lat: number, lng: number, polygon: any): boolean {
  const coords = polygon?.coordinates?.[0] || polygon?.geometry?.coordinates?.[0];
  if (!coords || coords.length < 3) return true; // fallback: assume inside

  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][1], yi = coords[i][0]; // [lng, lat] → lat=index1, lng=index0
    const xj = coords[j][1], yj = coords[j][0];
    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export default function TerritoryBoundaryAlert({ userLocation, areaPolygon }: TerritoryBoundaryAlertProps) {
  const isInside = useMemo(
    () => pointInPolygon(userLocation.lat, userLocation.lng, areaPolygon),
    [userLocation.lat, userLocation.lng, areaPolygon]
  );

  if (isInside) {
    return (
      <div className={cn(
        "absolute top-2 left-1/2 -translate-x-1/2 z-30",
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full",
        "bg-green-600/90 text-white text-xs font-medium shadow-md backdrop-blur-sm"
      )}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        In Territory
      </div>
    );
  }

  return (
    <div className={cn(
      "absolute top-2 left-1/2 -translate-x-1/2 z-30",
      "flex items-center gap-1.5 px-3 py-1.5 rounded-full",
      "bg-destructive/90 text-white text-xs font-medium shadow-md backdrop-blur-sm animate-pulse"
    )}>
      <AlertTriangle className="h-3.5 w-3.5" />
      Outside Assigned Territory
    </div>
  );
}
