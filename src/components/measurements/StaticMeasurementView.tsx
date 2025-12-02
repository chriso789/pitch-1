import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Ruler, Square, ArrowUpDown, Triangle, Layers } from 'lucide-react';

interface StaticMeasurementViewProps {
  satelliteImageUrl?: string;
  measurement: any;
  tags: Record<string, any>;
  address?: string;
  className?: string;
}

/**
 * Read-only measurement display component
 * Shows satellite image with measurement summary - no interactive editing
 */
export function StaticMeasurementView({
  satelliteImageUrl,
  measurement,
  tags,
  address,
  className = ''
}: StaticMeasurementViewProps) {
  // Extract measurements from tags or measurement object
  const totalArea = tags['roof.total_area'] || measurement?.summary?.total_area_sqft || 0;
  const squares = tags['roof.squares'] || measurement?.summary?.total_squares || 0;
  const pitch = measurement?.predominant_pitch || measurement?.summary?.pitch || '6/12';
  const ridgeFt = tags['lf.ridge'] || tags['roof.ridge'] || measurement?.linear_features?.ridge || 0;
  const hipFt = tags['lf.hip'] || tags['roof.hip'] || measurement?.linear_features?.hip || 0;
  const valleyFt = tags['lf.valley'] || tags['roof.valley'] || measurement?.linear_features?.valley || 0;
  const eaveFt = tags['lf.eave'] || tags['roof.eave'] || measurement?.linear_features?.eave || 0;
  const rakeFt = tags['lf.rake'] || tags['roof.rake'] || measurement?.linear_features?.rake || 0;
  const facetCount = tags['roof.faces_count'] || measurement?.faces?.length || 0;
  const confidence = tags['ai.confidence'] || measurement?.confidence_score || 0;
  const roofType = tags['ai.roof_type'] || measurement?.roof_type || 'Unknown';

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Address Display */}
      {address && (
        <div className="text-sm font-medium text-foreground">
          📍 {address}
        </div>
      )}

      {/* Satellite Image - Static Display */}
      <Card className="relative overflow-hidden bg-muted">
        {satelliteImageUrl ? (
          <div className="relative">
            <img
              src={satelliteImageUrl}
              alt="Satellite view of property"
              className="w-full h-auto object-cover"
              style={{ maxHeight: '400px' }}
            />
            {/* AI Confidence Badge */}
            {confidence > 0 && (
              <Badge 
                variant={confidence >= 80 ? 'default' : confidence >= 60 ? 'secondary' : 'destructive'}
                className="absolute top-2 right-2"
              >
                AI Confidence: {confidence}%
              </Badge>
            )}
            {/* Roof Type Badge */}
            {roofType && roofType !== 'Unknown' && (
              <Badge variant="outline" className="absolute top-2 left-2 bg-background/80">
                {roofType}
              </Badge>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            No satellite image available
          </div>
        )}
      </Card>

      {/* Measurement Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {/* Total Area */}
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Square className="h-3 w-3" />
            Total Area
          </div>
          <div className="text-lg font-bold">
            {totalArea.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft
          </div>
        </Card>

        {/* Squares */}
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Layers className="h-3 w-3" />
            Squares
          </div>
          <div className="text-lg font-bold text-primary">
            {squares.toFixed(1)}
          </div>
        </Card>

        {/* Pitch */}
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Triangle className="h-3 w-3" />
            Pitch
          </div>
          <div className="text-lg font-bold">
            {pitch}
          </div>
        </Card>

        {/* Ridge */}
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Ruler className="h-3 w-3 text-green-500" />
            Ridge
          </div>
          <div className="text-lg font-bold">
            {ridgeFt.toFixed(0)} ft
          </div>
        </Card>

        {/* Hip */}
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Ruler className="h-3 w-3 text-blue-500" />
            Hip
          </div>
          <div className="text-lg font-bold">
            {hipFt.toFixed(0)} ft
          </div>
        </Card>

        {/* Valley */}
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Ruler className="h-3 w-3 text-red-500" />
            Valley
          </div>
          <div className="text-lg font-bold">
            {valleyFt.toFixed(0)} ft
          </div>
        </Card>

        {/* Eave */}
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <ArrowUpDown className="h-3 w-3" />
            Eave
          </div>
          <div className="text-lg font-bold">
            {eaveFt.toFixed(0)} ft
          </div>
        </Card>

        {/* Rake */}
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <ArrowUpDown className="h-3 w-3" />
            Rake
          </div>
          <div className="text-lg font-bold">
            {rakeFt.toFixed(0)} ft
          </div>
        </Card>

        {/* Facets */}
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Layers className="h-3 w-3" />
            Facets
          </div>
          <div className="text-lg font-bold">
            {facetCount}
          </div>
        </Card>
      </div>
    </div>
  );
}
