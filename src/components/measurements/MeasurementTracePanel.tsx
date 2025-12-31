import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Info, MapPin, Ruler, Layers } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

// Roofr color palette for consistency
const FEATURE_COLORS = {
  eave: '#006400',
  ridge: '#90EE90',
  hip: '#9B59B6',
  valley: '#DC3545',
  rake: '#17A2B8',
  step: '#6C757D',
};

interface LinearFeatureTrace {
  id: string;
  type: string;
  length_ft: number;
  wkt?: string;
  filtered?: boolean;
  filterReason?: string;
}

interface MeasurementTracePanelProps {
  measurement: any;
  tags: Record<string, any>;
  onFixOutline?: () => void;
}

export function MeasurementTracePanel({ measurement, tags, onFixOutline }: MeasurementTracePanelProps) {
  const [showAllFeatures, setShowAllFeatures] = useState(false);

  // Extract source info
  const source = measurement?.source || 'unknown';
  const footprintSource = measurement?.footprint_source || source;
  
  // Extract plan area from measurement
  const planAreaSqft = measurement?.summary?.plan_area_sqft || 
                       measurement?.faces?.[0]?.plan_area_sqft || 
                       0;
  
  // Extract facet info
  const facetCount = measurement?.facet_count || measurement?.faces?.length || 0;
  const splitQuality = measurement?.split_quality || measurement?.overlay_schema?.splitQuality;
  const manualReviewRecommended = measurement?.manual_review_recommended || 
                                   measurement?.overlay_schema?.manualReviewRecommended ||
                                   false;

  // Extract linear features
  const linearFeatures: LinearFeatureTrace[] = [];
  const rawFeatures = measurement?.linear_features || [];
  
  if (Array.isArray(rawFeatures)) {
    rawFeatures.forEach((f: any, i: number) => {
      linearFeatures.push({
        id: f.id || `LF${i + 1}`,
        type: f.type || 'unknown',
        length_ft: f.length_ft || f.length || 0,
        wkt: f.wkt,
        filtered: false,
      });
    });
  } else if (typeof rawFeatures === 'object') {
    // Object format: {ridge: 45, hip: 120, ...}
    Object.entries(rawFeatures).forEach(([type, length], i) => {
      if (typeof length === 'number' && length > 0) {
        linearFeatures.push({
          id: `LF${i + 1}`,
          type,
          length_ft: length,
          filtered: false,
        });
      }
    });
  }

  // Group features by type
  const featuresByType: Record<string, LinearFeatureTrace[]> = {};
  linearFeatures.forEach(f => {
    const type = f.type.toLowerCase();
    if (!featuresByType[type]) featuresByType[type] = [];
    featuresByType[type].push(f);
  });

  // Calculate totals from features
  const calculatedTotals: Record<string, number> = {};
  Object.entries(featuresByType).forEach(([type, features]) => {
    calculatedTotals[type] = features.reduce((sum, f) => sum + f.length_ft, 0);
  });

  // Get displayed totals from tags
  const displayedTotals = {
    ridge: tags['lf.ridge'] || measurement?.summary?.ridge_ft || 0,
    hip: tags['lf.hip'] || measurement?.summary?.hip_ft || 0,
    valley: tags['lf.valley'] || measurement?.summary?.valley_ft || 0,
    eave: tags['lf.eave'] || measurement?.summary?.eave_ft || 0,
    rake: tags['lf.rake'] || measurement?.summary?.rake_ft || 0,
    step: tags['lf.step'] || measurement?.summary?.step_ft || 0,
  };

  // Determine status
  const hasFootprint = planAreaSqft > 0;
  const hasLinearFeatures = linearFeatures.length > 0;
  const isLowQuality = splitQuality !== undefined && splitQuality < 0.6;
  const hasMismatch = Object.entries(displayedTotals).some(([type, displayed]) => {
    const calculated = calculatedTotals[type] || 0;
    return Math.abs(displayed - calculated) > 5;
  });

  const overallStatus = manualReviewRecommended || isLowQuality || !hasFootprint 
    ? 'warning' 
    : 'ok';

  return (
    <Card className="border-muted">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Info className="h-4 w-4" />
          Measurement Trace
          {overallStatus === 'warning' && (
            <Badge variant="outline" className="ml-auto text-amber-600 border-amber-300">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Needs Review
            </Badge>
          )}
          {overallStatus === 'ok' && (
            <Badge variant="outline" className="ml-auto text-green-600 border-green-300">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Verified
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {/* Source Info */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Footprint:</span>
            <span className="font-medium capitalize">{footprintSource}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Ruler className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Plan Area:</span>
            <span className="font-medium">{Math.round(planAreaSqft).toLocaleString()} sqft</span>
          </div>
        </div>

        {/* Facet Info */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Facets:</span>
            <span className="font-medium">{facetCount}</span>
            {splitQuality !== undefined && (
              <span className="text-muted-foreground">
                (Q: {Math.round(splitQuality * 100)}%)
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Features:</span>
            <span className="font-medium">{linearFeatures.length}</span>
          </div>
        </div>

        {/* Linear Features Summary */}
        <div className="border-t pt-2">
          <div className="text-muted-foreground mb-1.5 font-medium">Linear Features</div>
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(FEATURE_COLORS).map(([type, color]) => {
              const displayed = displayedTotals[type as keyof typeof displayedTotals] || 0;
              const calculated = calculatedTotals[type] || 0;
              const count = featuresByType[type]?.length || 0;
              
              if (displayed === 0 && calculated === 0) return null;
              
              return (
                <div key={type} className="flex items-center gap-1">
                  <div 
                    className="w-2 h-2 rounded-full" 
                    style={{ backgroundColor: color }}
                  />
                  <span className="capitalize">{type}:</span>
                  <span className="font-medium">{Math.round(displayed)}'</span>
                  {count > 0 && (
                    <span className="text-muted-foreground">({count})</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Detailed Feature List (Collapsible) */}
        {linearFeatures.length > 0 && (
          <Collapsible open={showAllFeatures} onOpenChange={setShowAllFeatures}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full text-xs h-7">
                {showAllFeatures ? 'Hide' : 'Show'} {linearFeatures.length} Feature Details
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="max-h-40 overflow-y-auto space-y-1 text-[10px]">
                {linearFeatures.map((f) => {
                  const color = FEATURE_COLORS[f.type as keyof typeof FEATURE_COLORS] || '#888';
                  return (
                    <div 
                      key={f.id} 
                      className="flex items-center gap-2 px-1.5 py-0.5 rounded bg-muted/50"
                    >
                      <div 
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0" 
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-mono text-muted-foreground">{f.id}</span>
                      <span className="capitalize">{f.type}</span>
                      <span className="font-medium ml-auto">{Math.round(f.length_ft)}'</span>
                      {f.filtered && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 text-amber-600">
                          filtered
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Warnings */}
        {(manualReviewRecommended || isLowQuality || !hasFootprint) && (
          <div className="border-t pt-2 space-y-1.5">
            {!hasFootprint && (
              <div className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                <span>No footprint geometry found</span>
              </div>
            )}
            {isLowQuality && (
              <div className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                <span>Low split quality - facets are estimated</span>
              </div>
            )}
            {manualReviewRecommended && (
              <div className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                <span>Manual review recommended</span>
              </div>
            )}
            {onFixOutline && (
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full mt-2 h-7 text-xs"
                onClick={onFixOutline}
              >
                Fix Outline & Lines
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
