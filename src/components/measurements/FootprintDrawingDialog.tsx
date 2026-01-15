import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { 
  Pencil, 
  Trash2, 
  Check, 
  X, 
  RotateCcw, 
  MapPin,
  Loader2,
  AlertTriangle,
  HelpCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface FootprintDrawingDialogProps {
  open: boolean;
  onClose: () => void;
  measurementId: string;
  lat: number;
  lng: number;
  address?: string;
  currentAreaSqft?: number;
  onSave: (data: {
    areaSqft: number;
    perimeterFt: number;
    vertexCount: number;
    source: string;
  }) => void;
}

interface Vertex {
  x: number; // percentage of image width (0-100)
  y: number; // percentage of image height (0-100)
}

export function FootprintDrawingDialog({
  open,
  onClose,
  measurementId,
  lat,
  lng,
  address,
  currentAreaSqft,
  onSave
}: FootprintDrawingDialogProps) {
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [isDrawing, setIsDrawing] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [calculatedArea, setCalculatedArea] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Load satellite image
  useEffect(() => {
    if (open && lat && lng) {
      const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
      if (googleMapsKey) {
        const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=640x640&maptype=satellite&key=${googleMapsKey}`;
        setImageUrl(url);
      } else {
        // Fallback to Mapbox
        const mapboxToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN;
        if (mapboxToken) {
          const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},20/640x640@2x?access_token=${mapboxToken}`;
          setImageUrl(url);
        }
      }
    }
  }, [open, lat, lng]);

  // Calculate area whenever vertices change
  useEffect(() => {
    if (vertices.length >= 3) {
      const area = calculateAreaFromVertices(vertices, lat, lng);
      setCalculatedArea(area);
    } else {
      setCalculatedArea(0);
    }
  }, [vertices, lat, lng]);

  // Handle canvas click
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Check if clicking near first vertex to close polygon
    if (vertices.length >= 3) {
      const first = vertices[0];
      const distance = Math.sqrt(Math.pow(x - first.x, 2) + Math.pow(y - first.y, 2));
      if (distance < 3) { // Close polygon if within 3% of first point
        setIsDrawing(false);
        toast.success(`Polygon closed with ${vertices.length} vertices`);
        return;
      }
    }

    setVertices(prev => [...prev, { x, y }]);
  }, [isDrawing, vertices]);

  // Convert percentage vertices to lat/lng
  const verticesToLatLng = useCallback((verts: Vertex[]): Array<{ lat: number; lng: number }> => {
    const imageSize = 640;
    const zoom = 20;
    const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);

    return verts.map(v => {
      const pixelX = (v.x / 100) * imageSize;
      const pixelY = (v.y / 100) * imageSize;
      
      const centerPixel = imageSize / 2;
      const deltaX = (pixelX - centerPixel) * metersPerPixel;
      const deltaY = (centerPixel - pixelY) * metersPerPixel;
      
      const vertLat = lat + (deltaY / 111320);
      const vertLng = lng + (deltaX / (111320 * Math.cos(lat * Math.PI / 180)));
      
      return { lat: vertLat, lng: vertLng };
    });
  }, [lat, lng]);

  // Calculate area from percentage vertices
  const calculateAreaFromVertices = useCallback((verts: Vertex[], centerLat: number, centerLng: number): number => {
    if (verts.length < 3) return 0;

    const geoVertices = verticesToLatLng(verts);
    
    // Shoelace formula for area
    let area = 0;
    for (let i = 0; i < geoVertices.length; i++) {
      const j = (i + 1) % geoVertices.length;
      area += geoVertices[i].lng * geoVertices[j].lat;
      area -= geoVertices[j].lng * geoVertices[i].lat;
    }
    area = Math.abs(area) / 2;

    // Convert to square feet
    const metersPerDegreeLng = 111320 * Math.cos(centerLat * Math.PI / 180);
    const metersPerDegreeLat = 110540;
    const areaSqMeters = area * metersPerDegreeLng * metersPerDegreeLat;
    
    return areaSqMeters * 10.764; // Convert to sq ft
  }, [verticesToLatLng]);

  // Save footprint
  const handleSave = async () => {
    if (vertices.length < 3) {
      toast.error('Please draw at least 3 vertices');
      return;
    }

    setIsSaving(true);

    try {
      const geoVertices = verticesToLatLng(vertices);
      
      const { data, error } = await supabase.functions.invoke('save-manual-footprint', {
        body: {
          measurementId,
          vertices: geoVertices,
          source: 'manual_drawing'
        }
      });

      if (error) throw error;

      onSave({
        areaSqft: data.areaSqft,
        perimeterFt: data.perimeterFt,
        vertexCount: geoVertices.length,
        source: 'manual_drawing'
      });

      onClose();
    } catch (error: any) {
      console.error('Save error:', error);
      toast.error(error.message || 'Failed to save footprint');
    } finally {
      setIsSaving(false);
    }
  };

  // Reset drawing
  const handleReset = () => {
    setVertices([]);
    setIsDrawing(true);
    setCalculatedArea(0);
  };

  // Undo last vertex
  const handleUndo = () => {
    if (vertices.length > 0) {
      setVertices(prev => prev.slice(0, -1));
      if (!isDrawing) setIsDrawing(true);
    }
  };

  const areaVariance = currentAreaSqft && calculatedArea > 0
    ? ((calculatedArea - currentAreaSqft) / currentAreaSqft * 100)
    : null;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Draw Building Footprint
          </DialogTitle>
          <DialogDescription>
            Click on the satellite image to trace the building's roofline perimeter.
            {address && <span className="block text-xs mt-1">{address}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Instructions Card */}
          <Card className="p-3 bg-muted/50">
            <div className="flex items-start gap-2">
              <HelpCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">Instructions:</p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-1 mt-1">
                  <li>Click around the edge of the roof to place vertices</li>
                  <li>Click near the first point (green) to close the polygon</li>
                  <li>Use Undo to remove the last point</li>
                  <li>Click Save when satisfied with the outline</li>
                </ol>
              </div>
            </div>
          </Card>

          {/* Drawing Canvas */}
          <div 
            ref={containerRef}
            className="relative aspect-square border rounded-lg overflow-hidden cursor-crosshair bg-muted"
            onClick={handleCanvasClick}
          >
            {imageUrl && (
              <img 
                ref={imageRef}
                src={imageUrl} 
                alt="Satellite view"
                className="absolute inset-0 w-full h-full object-cover"
                onLoad={() => setImageLoaded(true)}
                onError={() => toast.error('Failed to load satellite image')}
              />
            )}

            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Center marker */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <MapPin className="h-6 w-6 text-primary drop-shadow-lg" />
            </div>

            {/* Draw polygon */}
            {vertices.length > 0 && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {/* Polygon fill (when closed) */}
                {!isDrawing && vertices.length >= 3 && (
                  <polygon
                    points={vertices.map(v => `${v.x}%,${v.y}%`).join(' ')}
                    fill="rgba(59, 130, 246, 0.3)"
                    stroke="rgba(59, 130, 246, 0.8)"
                    strokeWidth="2"
                  />
                )}

                {/* Lines between vertices */}
                {vertices.map((vertex, i) => {
                  const next = vertices[(i + 1) % vertices.length];
                  if (i < vertices.length - 1 || !isDrawing) {
                    return (
                      <line
                        key={`line-${i}`}
                        x1={`${vertex.x}%`}
                        y1={`${vertex.y}%`}
                        x2={`${next.x}%`}
                        y2={`${next.y}%`}
                        stroke="rgba(59, 130, 246, 0.8)"
                        strokeWidth="2"
                        strokeDasharray={isDrawing && i === vertices.length - 1 ? "4,4" : "none"}
                      />
                    );
                  }
                  return null;
                })}

                {/* Vertex circles */}
                {vertices.map((vertex, i) => (
                  <circle
                    key={`vertex-${i}`}
                    cx={`${vertex.x}%`}
                    cy={`${vertex.y}%`}
                    r="6"
                    fill={i === 0 ? 'rgb(34, 197, 94)' : 'rgb(59, 130, 246)'}
                    stroke="white"
                    strokeWidth="2"
                  />
                ))}
              </svg>
            )}
          </div>

          {/* Stats and Controls */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Badge variant="outline">
                {vertices.length} vertices
              </Badge>
              
              {calculatedArea > 0 && (
                <Badge variant="secondary" className="text-sm">
                  {calculatedArea.toFixed(0)} sq ft
                </Badge>
              )}

              {areaVariance !== null && (
                <Badge 
                  variant={Math.abs(areaVariance) > 15 ? "destructive" : "outline"}
                  className="text-xs"
                >
                  {areaVariance > 0 ? '+' : ''}{areaVariance.toFixed(1)}% vs current
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleUndo}
                disabled={vertices.length === 0}
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Undo
              </Button>

              <Button 
                variant="outline" 
                size="sm"
                onClick={handleReset}
                disabled={vertices.length === 0}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Reset
              </Button>
            </div>
          </div>

          {/* Area variance warning */}
          {areaVariance !== null && Math.abs(areaVariance) > 20 && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Large area difference detected</p>
                <p className="text-muted-foreground text-xs">
                  The drawn footprint differs by {Math.abs(areaVariance).toFixed(0)}% from the current measurement.
                  Please verify the outline is accurate.
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <Button variant="outline" onClick={onClose}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>

            <Button 
              onClick={handleSave}
              disabled={vertices.length < 3 || isDrawing || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              Save Footprint
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
