import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Bug,
  Info,
  MapPin,
  Ruler,
  Layers,
  AlertCircle
} from 'lucide-react';

interface MeasurementQuality {
  confidence: number;
  footprintSource?: string;
  pitchSource?: string;
  usedFallbacks?: string[];
  requiresManualReview?: boolean;
  warnings?: string[];
  isReliable?: boolean;
}

interface GeometryValidation {
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
  checks?: {
    name: string;
    passed: boolean;
    value?: string | number;
    expected?: string;
  }[];
}

interface DebugArtifacts {
  footprintCandidates?: {
    source: string;
    vertexCount: number;
    areaSqft: number;
    confidence: number;
  }[];
  skeletonOutput?: {
    ridgeCount: number;
    hipCount: number;
    valleyCount: number;
    processingTimeMs: number;
  };
  linearFeaturesRaw?: {
    type: string;
    lengthFt: number;
    wkt?: string;
  }[];
}

interface MeasurementDebugPanelProps {
  quality?: MeasurementQuality;
  geometryValidation?: GeometryValidation;
  debugArtifacts?: DebugArtifacts;
  analysisParams?: {
    lat: number;
    lng: number;
    zoom: number;
    imageSize: { width: number; height: number };
  };
  timing?: {
    totalMs: number;
    footprintMs?: number;
    skeletonMs?: number;
    validationMs?: number;
  };
  source?: string;
  className?: string;
}

export function MeasurementDebugPanel({
  quality,
  geometryValidation,
  debugArtifacts,
  analysisParams,
  timing,
  source,
  className = ''
}: MeasurementDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasIssues = quality?.warnings?.length ||
    quality?.requiresManualReview ||
    !quality?.isReliable ||
    !geometryValidation?.isValid;

  const getQualityColor = (confidence: number) => {
    if (confidence >= 85) return 'bg-green-500';
    if (confidence >= 70) return 'bg-yellow-500';
    if (confidence >= 50) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getSourceBadge = (src?: string) => {
    const sourceLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      'mapbox_vector': { label: 'Mapbox Vector', variant: 'default' },
      'microsoft_buildings': { label: 'Microsoft Buildings', variant: 'default' },
      'osm': { label: 'OpenStreetMap', variant: 'secondary' },
      'google_solar_bbox': { label: 'Google Solar BBox', variant: 'destructive' },
      'user_traced': { label: 'User Traced', variant: 'default' },
      'vendor_report': { label: 'Vendor Report', variant: 'default' },
      'unknown': { label: 'Unknown', variant: 'outline' }
    };
    const info = sourceLabels[src || 'unknown'] || sourceLabels['unknown'];
    return <Badge variant={info.variant}>{info.label}</Badge>;
  };

  return (
    <Card className={`p-3 bg-muted/50 ${className}`}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between hover:bg-muted"
          >
            <div className="flex items-center gap-2">
              <Bug className="h-4 w-4" />
              <span className="font-medium">Debug Info</span>
              {hasIssues && (
                <Badge variant="destructive" className="text-xs">
                  {(quality?.warnings?.length || 0) + (geometryValidation?.errors?.length || 0)} issues
                </Badge>
              )}
            </div>
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-3 space-y-4">
          {/* Quality Indicators */}
          {quality && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Quality Indicators
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Confidence:</span>
                  <div className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${getQualityColor(quality.confidence)}`} />
                    <span className="font-medium">{quality.confidence}%</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Reliable:</span>
                  {quality.isReliable ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Footprint:</span>
                  {getSourceBadge(quality.footprintSource)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Pitch:</span>
                  <Badge variant={quality.pitchSource === 'assumed' ? 'destructive' : 'secondary'}>
                    {quality.pitchSource || 'unknown'}
                  </Badge>
                </div>
              </div>

              {quality.requiresManualReview && (
                <div className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span>Requires manual review before use</span>
                </div>
              )}
            </div>
          )}

          {/* Warnings */}
          {quality?.warnings && quality.warnings.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                Warnings ({quality.warnings.length})
              </h4>
              <ul className="space-y-1">
                {quality.warnings.map((warning, idx) => (
                  <li key={idx} className="text-sm text-yellow-600 dark:text-yellow-400 flex items-start gap-2">
                    <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Fallbacks Used */}
          {quality?.usedFallbacks && quality.usedFallbacks.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Info className="h-4 w-4 text-orange-500" />
                Fallbacks Used
              </h4>
              <div className="flex flex-wrap gap-1">
                {quality.usedFallbacks.map((fallback, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs border-orange-500/50">
                    {fallback}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Geometry Validation */}
          {geometryValidation && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Ruler className="h-4 w-4" />
                Geometry Validation
                {geometryValidation.isValid ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </h4>

              {geometryValidation.checks && (
                <div className="space-y-1">
                  {geometryValidation.checks.map((check, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{check.name}</span>
                      <div className="flex items-center gap-2">
                        {check.value !== undefined && (
                          <span className="text-xs">{check.value}</span>
                        )}
                        {check.passed ? (
                          <CheckCircle className="h-3 w-3 text-green-500" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-500" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {geometryValidation.errors && geometryValidation.errors.length > 0 && (
                <ul className="space-y-1 mt-2">
                  {geometryValidation.errors.map((error, idx) => (
                    <li key={idx} className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                      <XCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                      {error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Analysis Parameters */}
          {analysisParams && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Analysis Parameters
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-background p-2 rounded">
                <div>lat: {analysisParams.lat.toFixed(8)}</div>
                <div>lng: {analysisParams.lng.toFixed(8)}</div>
                <div>zoom: {analysisParams.zoom}</div>
                <div>size: {analysisParams.imageSize.width}x{analysisParams.imageSize.height}</div>
              </div>
            </div>
          )}

          {/* Debug Artifacts */}
          {debugArtifacts && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Debug Artifacts</h4>

              {debugArtifacts.footprintCandidates && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Footprint Candidates:</span>
                  <ul className="mt-1 space-y-1">
                    {debugArtifacts.footprintCandidates.map((fp, idx) => (
                      <li key={idx} className="font-mono bg-background p-1 rounded">
                        {fp.source}: {fp.vertexCount} vertices, {fp.areaSqft.toFixed(0)} sqft, conf={fp.confidence}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {debugArtifacts.skeletonOutput && (
                <div className="text-xs font-mono bg-background p-2 rounded">
                  <div>Ridge: {debugArtifacts.skeletonOutput.ridgeCount}</div>
                  <div>Hip: {debugArtifacts.skeletonOutput.hipCount}</div>
                  <div>Valley: {debugArtifacts.skeletonOutput.valleyCount}</div>
                  <div>Time: {debugArtifacts.skeletonOutput.processingTimeMs}ms</div>
                </div>
              )}
            </div>
          )}

          {/* Timing */}
          {timing && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Timing</h4>
              <div className="text-xs font-mono bg-background p-2 rounded">
                <div>Total: {timing.totalMs}ms</div>
                {timing.footprintMs && <div>Footprint: {timing.footprintMs}ms</div>}
                {timing.skeletonMs && <div>Skeleton: {timing.skeletonMs}ms</div>}
                {timing.validationMs && <div>Validation: {timing.validationMs}ms</div>}
              </div>
            </div>
          )}

          {/* Source */}
          {source && (
            <div className="text-xs text-muted-foreground">
              Source: <span className="font-mono">{source}</span>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default MeasurementDebugPanel;
