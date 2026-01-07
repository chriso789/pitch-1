import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Satellite, Edit3, RefreshCw, Loader2, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { useRepullMeasurement } from '@/hooks/useMeasurement';
import { toast } from 'sonner';

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

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <Satellite className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-semibold">Current Measurements</h3>
            <p className="text-xs text-muted-foreground">
              From {source}
              {timestamp && ` • ${format(timestamp, 'MMM d, yyyy')}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
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
  );
}
