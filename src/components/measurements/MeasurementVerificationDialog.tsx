import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, Edit3, X, Satellite, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { PolygonEditor } from './PolygonEditor';
import { parseWKTPolygon, calculatePolygonAreaSqft } from '@/utils/geoCoordinates';

interface MeasurementVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measurement: any;
  tags: Record<string, any>;
  satelliteImageUrl?: string;
  centerLat: number;
  centerLng: number;
  onAccept: (adjustedMeasurement?: any) => void;
  onReject: () => void;
}

export function MeasurementVerificationDialog({
  open,
  onOpenChange,
  measurement,
  tags,
  satelliteImageUrl,
  centerLat,
  centerLng,
  onAccept,
  onReject
}: MeasurementVerificationDialogProps) {
  const [isAccepting, setIsAccepting] = useState(false);
  const [adjustedPolygon, setAdjustedPolygon] = useState<[number, number][] | null>(null);
  const [adjustedArea, setAdjustedArea] = useState<number | null>(null);

  const handleAccept = async () => {
    setIsAccepting(true);
    
    // If polygon was adjusted, create updated measurement object
    if (adjustedPolygon && adjustedArea) {
      const pitchFactor = tags['roof.pitch_factor'] || 1.0;
      const wastePercent = tags['roof.waste_percent'] || 12;
      
      const planArea = adjustedArea;
      const adjustedRoofArea = planArea * pitchFactor;
      const totalArea = adjustedRoofArea * (1 + wastePercent / 100);
      const squares = totalArea / 100;

      const updatedMeasurement = {
        ...measurement,
        adjustedPolygon,
        adjustedPlanArea: planArea,
        adjustedTotalArea: totalArea,
        adjustedSquares: squares
      };

      await onAccept(updatedMeasurement);
    } else {
      await onAccept();
    }
    
    setIsAccepting(false);
    onOpenChange(false);
  };

  const handleReject = () => {
    onReject();
    onOpenChange(false);
  };

  const getConfidenceLevel = () => {
    const confidence = measurement?.confidence || 0;
    if (confidence >= 0.8) return { label: 'High', variant: 'default' as const, dots: 5 };
    if (confidence >= 0.6) return { label: 'Medium', variant: 'secondary' as const, dots: 3 };
    return { label: 'Low', variant: 'destructive' as const, dots: 2 };
  };

  const confidence = getConfidenceLevel();

  // Extract measurements from tags (use adjusted values if available)
  const roofSquares = adjustedArea 
    ? (adjustedArea * (tags['roof.pitch_factor'] || 1.0) * (1 + (tags['roof.waste_percent'] || 12) / 100)) / 100
    : (tags['roof.squares'] || 0);
  const totalArea = adjustedArea
    ? adjustedArea * (tags['roof.pitch_factor'] || 1.0) * (1 + (tags['roof.waste_percent'] || 12) / 100)
    : (tags['roof.area'] || 0);
  const planArea = adjustedArea || tags['roof.plan_area'] || 0;
  const pitchFactor = tags['roof.pitch_factor'] || 1.0;
  const wastePercent = tags['roof.waste_percent'] || 12;
  const faceCount = tags['roof.face_count'] || 0;

  // Extract building polygon for editor
  const buildingPolygon = measurement?.faces?.[0]?.wkt 
    ? parseWKTPolygon(measurement.faces[0].wkt)
    : [];

  const handlePolygonChange = (coords: [number, number][], areaSqft: number) => {
    setAdjustedPolygon(coords);
    setAdjustedArea(areaSqft);
  };

  // Linear features
  const ridge = tags['roof.ridge'] || 0;
  const hip = tags['roof.hip'] || 0;
  const valley = tags['roof.valley'] || 0;
  const eave = tags['roof.eave'] || 0;
  const rake = tags['roof.rake'] || 0;
  const step = tags['roof.step'] || 0;

  // Material quantities
  const shingleBundles = tags['material.shingle_bundles'] || 0;
  const ridgeCapBundles = tags['material.ridge_cap_bundles'] || 0;
  const valleyRolls = tags['material.valley_rolls'] || 0;
  const dripEdgeSticks = tags['material.drip_edge_sticks'] || 0;

  const source = measurement?.source || 'Unknown';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Satellite className="h-5 w-5" />
              Verify Measurements
            </DialogTitle>
            <Badge variant={confidence.variant}>
              {confidence.label} Confidence
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Review these measurements before applying them to your estimates
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr,1fr] gap-6">
          {/* Left Panel: Visual Editor */}
          {satelliteImageUrl && buildingPolygon.length > 0 && (
            <div className="space-y-4">
              <PolygonEditor
                satelliteImageUrl={satelliteImageUrl}
                buildingPolygon={buildingPolygon}
                centerLng={centerLng}
                centerLat={centerLat}
                zoom={20}
                onPolygonChange={handlePolygonChange}
                canvasWidth={640}
                canvasHeight={480}
              />
              
              {/* Source and Confidence */}
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Satellite className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Source: {source}</span>
                </div>
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-2 w-2 rounded-full ${
                        i < confidence.dots ? 'bg-primary' : 'bg-muted'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Right Panel: Measurement Details */}
          <div className="space-y-6">

            {/* Overview Cards */}
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-3 text-center">
                <div className="text-xl font-bold text-primary">{totalArea.toFixed(0)}</div>
                <div className="text-xs text-muted-foreground mt-1">Total Area (sq ft)</div>
                {adjustedArea && (
                  <Badge variant="secondary" className="mt-1 text-xs">Adjusted</Badge>
                )}
              </Card>
              <Card className="p-3 text-center">
                <div className="text-xl font-bold text-primary">{roofSquares.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground mt-1">Roof Squares</div>
                {adjustedArea && (
                  <Badge variant="secondary" className="mt-1 text-xs">Adjusted</Badge>
                )}
              </Card>
              <Card className="p-3 text-center">
                <div className="text-xl font-bold text-primary">{faceCount}</div>
                <div className="text-xs text-muted-foreground mt-1">Roof Faces</div>
              </Card>
            </div>

            {/* Roof Geometry */}
            <div>
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                📐 Roof Geometry
              </h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Plan Area:</span>
                  <span className="font-medium">{planArea.toFixed(0)} sq ft</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Adjusted Area:</span>
                  <span className="font-medium">{totalArea.toFixed(0)} sq ft (×{pitchFactor.toFixed(3)})</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Waste Percentage:</span>
                  <span className="font-medium">{wastePercent}%</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Face Count:</span>
                  <span className="font-medium">{faceCount} planes</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Linear Features */}
            <div>
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                📏 Linear Features
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Ridge', value: ridge },
                  { label: 'Hip', value: hip },
                  { label: 'Valley', value: valley },
                  { label: 'Eave', value: eave },
                  { label: 'Rake', value: rake },
                  { label: 'Step', value: step },
                ].map(({ label, value }) => (
                  <div key={label} className="p-2 bg-muted/30 rounded-lg">
                    <div className="text-base font-bold">{value.toFixed(0)} ft</div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Material Quantities */}
            <div>
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                📦 Material Quantities
                <Badge variant="outline" className="text-xs">Auto-calc</Badge>
              </h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Shingle Bundles:</span>
                  <span className="font-medium">{shingleBundles} bundles</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Ridge Cap:</span>
                  <span className="font-medium">{ridgeCapBundles} bundles</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Valley Roll:</span>
                  <span className="font-medium">{valleyRolls} rolls</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Drip Edge:</span>
                  <span className="font-medium">{dripEdgeSticks} sticks</span>
                </div>
              </div>
            </div>

            {/* Warning for low confidence */}
            {confidence.dots < 3 && (
              <div className="flex items-start gap-2 p-2 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-destructive">Low Confidence</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Consider verifying manually or pulling again.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={isAccepting}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              // Future: Open manual edit dialog
            }}
            disabled={isAccepting}
          >
            <Edit3 className="h-4 w-4 mr-2" />
            Edit Manually
          </Button>
          <Button
            onClick={handleAccept}
            disabled={isAccepting}
            className="bg-primary"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {isAccepting ? 'Applying...' : 'Accept & Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
