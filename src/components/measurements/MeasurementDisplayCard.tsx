import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Satellite, Edit3, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface MeasurementDisplayCardProps {
  measurement: any;
  tags: Record<string, any>;
  onRefresh?: () => void;
  onEdit?: () => void;
}

export function MeasurementDisplayCard({
  measurement,
  tags,
  onRefresh,
  onEdit
}: MeasurementDisplayCardProps) {
  if (!measurement || !tags) {
    return null;
  }

  const roofSquares = tags['roof.squares'] || 0;
  const totalArea = tags['roof.area'] || 0;
  const ridge = tags['roof.ridge'] || 0;
  const hip = tags['roof.hip'] || 0;
  const valley = tags['roof.valley'] || 0;
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
        </div>
      </div>
    </Card>
  );
}
