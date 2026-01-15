import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Satellite, Edit3, RefreshCw, Loader2, Sparkles, Pencil, AlertTriangle, Scan } from 'lucide-react';
import { format } from 'date-fns';
import { useRepullMeasurement } from '@/hooks/useMeasurement';
import { toast } from 'sonner';
import { FootprintImportDialog } from './FootprintImportDialog';
import { FootprintDrawingDialog } from './FootprintDrawingDialog';
import { supabase } from '@/integrations/supabase/client';

interface MeasurementDisplayCardProps {
  measurement: any;
  tags: Record<string, any>;
  propertyId?: string;
  lat?: number;
  lng?: number;
  onRefresh?: () => void;
  onEdit?: () => void;
  onRepullComplete?: (data: any) => void;
}

export function MeasurementDisplayCard({
  measurement,
  tags,
  propertyId,
  lat,
  lng,
  onRefresh,
  onEdit,
  onRepullComplete
}: MeasurementDisplayCardProps) {
  const { repull, isRepulling } = useRepullMeasurement();
  const [showFootprintImport, setShowFootprintImport] = useState(false);
  const [showFootprintDrawing, setShowFootprintDrawing] = useState(false);
  const [isRedetecting, setIsRedetecting] = useState(false);
  
  const handleReanalyze = async () => {
    if (!propertyId || !lat || !lng) {
      toast.error('Missing property coordinates');
      return;
    }
    
    try {
      toast.info('Re-analyzing roof with AI segment topology...');
      const result = await repull(propertyId, lat, lng);
      toast.success('Roof re-analyzed with updated topology!');
      onRepullComplete?.(result);
      onRefresh?.();
    } catch (error: any) {
      console.error('Re-analysis failed:', error);
      toast.error(error.message || 'Failed to re-analyze roof');
    }
  };

  const handleRedetectFootprint = async () => {
    if (!lat || !lng || !measurement?.id) {
      toast.error('Missing coordinates or measurement ID');
      return;
    }
    
    setIsRedetecting(true);
    try {
      toast.info('Re-detecting building footprint with AI vision...');
      
      const { data, error } = await supabase.functions.invoke('detect-building-footprint', {
        body: {
          coordinates: { lat, lng },
          imageSize: 640,
          zoom: 20,
          measurementId: measurement.id
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('Footprint re-detected!', {
          description: `Found ${data.footprint.vertexCount} vertices with ${(data.footprint.confidence * 100).toFixed(0)}% confidence`
        });
        onRefresh?.();
      } else {
        toast.warning('Could not detect footprint', {
          description: data?.error || 'Try manual drawing instead'
        });
      }
    } catch (error: any) {
      console.error('Re-detect error:', error);
      toast.error(error.message || 'Failed to re-detect footprint');
    } finally {
      setIsRedetecting(false);
    }
  };

  const handleFootprintSaved = (data: {
    areaSqft: number;
    perimeterFt: number;
    vertexCount: number;
    source: string;
  }) => {
    toast.success('Footprint updated!', {
      description: `Area recalculated: ${data.areaSqft.toFixed(0)} sqft`
    });
    onRefresh?.();
  };
  
  if (!measurement || !tags) {
    return null;
  }

  const roofSquares = tags['roof.squares'] || 0;
  const totalArea = tags['roof.area'] || 0;
  const ridge = tags['lf.ridge'] || 0;
  const hip = tags['lf.hip'] || 0;
  const valley = tags['lf.valley'] || 0;
  const eave = tags['lf.eave'] || 0;
  const rake = tags['lf.rake'] || 0;
  const totalPenetrations = tags['pen.total'] || 0;
  const roofAge = tags['age.years'] || 0;
  const source = measurement.source || 'Unknown';
  const timestamp = measurement.created_at ? new Date(measurement.created_at) : null;
  
  // Check if using solar bbox fallback
  const footprintSource = measurement.footprint_source || '';
  const isSolarBboxFallback = footprintSource === 'solar_bbox_fallback';
  const requiresManualReview = measurement.requires_manual_review || isSolarBboxFallback;
  
  // Calculate variance if manual reference exists
  const manualReferenceArea = measurement.manual_reference_area_sqft;
  const areaVariance = manualReferenceArea && totalArea
    ? ((totalArea - manualReferenceArea) / manualReferenceArea * 100)
    : null;

  return (
    <>
      <Card className="p-4">
        {/* Warning banner for solar bbox fallback */}
        {isSolarBboxFallback && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-destructive">Rectangular Estimate - Manual Verification Required</p>
              <p className="text-muted-foreground text-xs mt-1">
                This measurement uses a Solar API bounding box fallback which typically overestimates area by 15-25%. 
                Import a verified footprint for accurate measurements.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <Satellite className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-semibold">Current Measurements</h3>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  From {source}
                  {timestamp && ` • ${format(timestamp, 'MMM d, yyyy')}`}
                </p>
                {footprintSource && (
                  <Badge 
                    variant={isSolarBboxFallback ? "destructive" : "outline"} 
                    className="text-[10px] px-1.5 py-0"
                  >
                    {footprintSource.replace(/_/g, ' ')}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {isSolarBboxFallback && lat && lng && (
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleRedetectFootprint}
                disabled={isRedetecting}
                className="text-xs bg-orange-500 hover:bg-orange-600"
              >
                {isRedetecting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Scan className="h-4 w-4 mr-1" />
                )}
                Re-detect
              </Button>
            )}
            {measurement?.id && lat && lng && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowFootprintDrawing(true)}
                className="text-xs"
              >
                <Pencil className="h-4 w-4 mr-1" />
                Draw Footprint
              </Button>
            )}
            {propertyId && lat && lng && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleReanalyze}
                disabled={isRepulling}
                className="text-xs"
              >
                {isRepulling ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-1" />
                )}
                Re-analyze
              </Button>
            )}
            {onEdit && (
              <Button variant="ghost" size="sm" onClick={onEdit}>
                <Edit3 className="h-4 w-4" />
              </Button>
            )}
            {onRefresh && (
              <Button variant="ghost" size="sm" onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-2xl font-bold text-primary">{totalArea.toFixed(0)} sq ft</div>
            <div className="text-xs text-muted-foreground">Total Roof Area</div>
            {areaVariance !== null && (
              <div className={`text-xs mt-1 ${Math.abs(areaVariance) > 10 ? 'text-destructive' : 'text-muted-foreground'}`}>
                {areaVariance > 0 ? '+' : ''}{areaVariance.toFixed(1)}% vs manual ({manualReferenceArea.toFixed(0)} sqft)
              </div>
            )}
          </div>
          <div>
            <div className="text-2xl font-bold text-primary">{roofSquares.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">Roof Squares</div>
          </div>
        </div>

        <div className="space-y-2 pt-3 border-t">
          <div className="text-xs font-medium text-muted-foreground mb-2">Linear Features</div>
          <div className="flex flex-wrap gap-2">
            {ridge > 0 && (
              <Badge variant="outline" className="text-xs">
                Ridge: {ridge.toFixed(0)} ft
              </Badge>
            )}
            {hip > 0 && (
              <Badge variant="outline" className="text-xs">
                Hip: {hip.toFixed(0)} ft
              </Badge>
            )}
            {valley > 0 && (
              <Badge variant="outline" className="text-xs">
                Valley: {valley.toFixed(0)} ft
              </Badge>
            )}
            {eave > 0 && (
              <Badge variant="outline" className="text-xs">
                Eave: {eave.toFixed(0)} ft
              </Badge>
            )}
            {rake > 0 && (
              <Badge variant="outline" className="text-xs">
                Rake: {rake.toFixed(0)} ft
              </Badge>
            )}
          </div>
        </div>

        {totalPenetrations > 0 && (
          <div className="space-y-2 pt-3 border-t">
            <div className="text-xs font-medium text-muted-foreground mb-2">Penetrations</div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Total penetrations:</span>
              <Badge variant="default">{totalPenetrations}</Badge>
            </div>
          </div>
        )}

        {roofAge > 0 && (
          <div className="space-y-2 pt-3 border-t">
            <div className="text-xs font-medium text-muted-foreground mb-2">Roof Age</div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Age:</span>
              <Badge variant="secondary">{roofAge} years</Badge>
            </div>
          </div>
        )}
      </Card>

      {/* Footprint Import Dialog */}
      {measurement?.id && (
        <FootprintImportDialog
          open={showFootprintImport}
          onClose={() => setShowFootprintImport(false)}
          measurementId={measurement.id}
          currentAreaSqft={totalArea}
          onSave={handleFootprintSaved}
        />
      )}

      {/* Footprint Drawing Dialog */}
      {measurement?.id && lat && lng && (
        <FootprintDrawingDialog
          open={showFootprintDrawing}
          onClose={() => setShowFootprintDrawing(false)}
          measurementId={measurement.id}
          lat={lat}
          lng={lng}
          address={measurement.address}
          currentAreaSqft={totalArea}
          onSave={handleFootprintSaved}
        />
      )}
    </>
  );
}
