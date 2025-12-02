import React, { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Satellite, Save, Trash2, Undo2, RotateCcw, Loader2, 
  Home, Ruler, Calculator
} from 'lucide-react';
import { RoofDrawingCanvas } from './RoofDrawingCanvas';
import { MeasurementToolbar, DrawingTool } from './MeasurementToolbar';
import { MeasurementResults } from './MeasurementResults';

export interface RoofMeasurements {
  roofArea: number;        // sq ft
  planArea: number;        // sq ft (flat)
  squares: number;         // roofArea / 100
  perimeter: number;       // linear ft
  ridge: number;           // linear ft
  hip: number;             // linear ft
  valley: number;          // linear ft
  eave: number;            // linear ft
  rake: number;            // linear ft
  pitch: string;           // e.g. "6/12"
  pitchFactor: number;     // multiplier
  wasteFactor: number;     // percentage
  faceCount: number;
}

interface RoofMeasurementToolProps {
  propertyId: string;
  lat: number;
  lng: number;
  address?: string;
  onSave?: (measurements: RoofMeasurements) => void;
  onCancel?: () => void;
}

const DEFAULT_MEASUREMENTS: RoofMeasurements = {
  roofArea: 0,
  planArea: 0,
  squares: 0,
  perimeter: 0,
  ridge: 0,
  hip: 0,
  valley: 0,
  eave: 0,
  rake: 0,
  pitch: '6/12',
  pitchFactor: 1.118,
  wasteFactor: 10,
  faceCount: 0,
};

const PITCH_FACTORS: Record<string, number> = {
  'flat': 1.0,
  '2/12': 1.014,
  '3/12': 1.031,
  '4/12': 1.054,
  '5/12': 1.083,
  '6/12': 1.118,
  '7/12': 1.158,
  '8/12': 1.202,
  '9/12': 1.250,
  '10/12': 1.302,
  '12/12': 1.414,
};

export function RoofMeasurementTool({
  propertyId,
  lat,
  lng,
  address,
  onSave,
  onCancel,
}: RoofMeasurementToolProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [satelliteImageUrl, setSatelliteImageUrl] = useState<string>('');
  const [activeTool, setActiveTool] = useState<DrawingTool>('roof');
  const [measurements, setMeasurements] = useState<RoofMeasurements>(DEFAULT_MEASUREMENTS);
  const [canUndo, setCanUndo] = useState(false);

  // Load satellite image on mount
  useEffect(() => {
    loadSatelliteImage();
  }, [lat, lng]);

  const loadSatelliteImage = async () => {
    if (!lat || !lng) {
      toast({
        title: "Missing Coordinates",
        description: "Cannot load satellite image without coordinates",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'satellite',
          params: {
            center: `${lat},${lng}`,
            zoom: '20',
            size: '800x800',
            maptype: 'satellite',
            scale: '2',
          },
        },
      });

      if (error) throw error;

      if (data?.image_url) {
        setSatelliteImageUrl(data.image_url);
      } else if (data?.image) {
        setSatelliteImageUrl(`data:image/png;base64,${data.image}`);
      } else {
        throw new Error('No image data received');
      }
    } catch (err: any) {
      console.error('Failed to load satellite image:', err);
      toast({
        title: "Failed to Load Image",
        description: err.message || "Could not load satellite imagery",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMeasurementsUpdate = useCallback((newMeasurements: Partial<RoofMeasurements>) => {
    setMeasurements(prev => {
      const updated = { ...prev, ...newMeasurements };
      // Recalculate derived values
      updated.roofArea = updated.planArea * updated.pitchFactor;
      updated.squares = updated.roofArea / 100;
      updated.perimeter = updated.eave + updated.rake;
      return updated;
    });
  }, []);

  const handlePitchChange = useCallback((pitch: string) => {
    const pitchFactor = PITCH_FACTORS[pitch] || 1.118;
    handleMeasurementsUpdate({ pitch, pitchFactor });
  }, [handleMeasurementsUpdate]);

  const handleWasteChange = useCallback((wasteFactor: number) => {
    handleMeasurementsUpdate({ wasteFactor });
  }, [handleMeasurementsUpdate]);

  const handleClear = useCallback(() => {
    setMeasurements(DEFAULT_MEASUREMENTS);
    setCanUndo(false);
  }, []);

  const handleSave = async () => {
    if (measurements.planArea === 0) {
      toast({
        title: "No Measurements",
        description: "Draw the roof outline first",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // Save to pipeline_entries metadata
      const adjustedArea = measurements.roofArea * (1 + measurements.wasteFactor / 100);
      
      const { error } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            comprehensive_measurements: {
              ...measurements,
              adjustedArea,
              adjustedSquares: adjustedArea / 100,
              savedAt: new Date().toISOString(),
            },
            roof_area_sq_ft: adjustedArea,
            roof_pitch: measurements.pitch,
          },
        })
        .eq('id', propertyId);

      if (error) throw error;

      toast({
        title: "Measurements Saved",
        description: `${measurements.squares.toFixed(1)} squares (${measurements.roofArea.toLocaleString()} sq ft)`,
      });

      onSave?.(measurements);
    } catch (err: any) {
      console.error('Failed to save measurements:', err);
      toast({
        title: "Save Failed",
        description: err.message || "Could not save measurements",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* Left: Drawing Area */}
      <div className="flex-1 min-w-0">
        <Card className="h-full">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Home className="h-5 w-5" />
                Roof Measurement
              </CardTitle>
              <div className="flex items-center gap-2">
                {address && (
                  <Badge variant="secondary" className="text-xs truncate max-w-[200px]">
                    {address}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {lat.toFixed(4)}, {lng.toFixed(4)}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Toolbar */}
            <MeasurementToolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              onClear={handleClear}
              onUndo={() => {}}
              canUndo={canUndo}
            />

            {/* Canvas */}
            <div className="mt-3 border rounded-lg overflow-hidden bg-muted/20">
              {loading ? (
                <div className="flex items-center justify-center h-[500px]">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">Loading satellite image...</span>
                </div>
              ) : satelliteImageUrl ? (
                <RoofDrawingCanvas
                  imageUrl={satelliteImageUrl}
                  activeTool={activeTool}
                  lat={lat}
                  lng={lng}
                  onMeasurementsChange={handleMeasurementsUpdate}
                  onCanUndoChange={setCanUndo}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-[500px] gap-4">
                  <Satellite className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">Failed to load satellite image</p>
                  <Button variant="outline" onClick={loadSatelliteImage}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </div>
              )}
            </div>

            {/* Instructions */}
            <div className="mt-3 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
              <p className="font-medium mb-1">How to measure:</p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Roof Outline:</strong> Click corners to trace the roof perimeter. Double-click to close.</li>
                <li><strong>Ridge/Hip/Valley:</strong> Click start and end points of each feature.</li>
                <li>Area and linear feet calculate automatically as you draw.</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right: Results Panel */}
      <div className="w-full lg:w-80 flex-shrink-0">
        <Card className="h-full">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calculator className="h-5 w-5" />
              Measurements
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <MeasurementResults
              measurements={measurements}
              onPitchChange={handlePitchChange}
              onWasteChange={handleWasteChange}
            />

            <Separator />

            {/* Actions */}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={saving || measurements.planArea === 0}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Measurements
                  </>
                )}
              </Button>
              {onCancel && (
                <Button variant="outline" className="w-full" onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default RoofMeasurementTool;
