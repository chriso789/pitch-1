import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, Bug, AlertTriangle, CheckCircle } from 'lucide-react';

interface MeasurementDebugPanelProps {
  measurement: any;
  dbMeasurement: any;
  tags: Record<string, any>;
  centerLat: number;
  centerLng: number;
  satelliteZoom: number;
}

export function MeasurementDebugPanel({
  measurement,
  dbMeasurement,
  tags,
  centerLat,
  centerLng,
  satelliteZoom,
}: MeasurementDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Calculate diagnostic values
  const measurementId = dbMeasurement?.id || measurement?.id || 'N/A';
  const selectedImageSource = dbMeasurement?.selected_image_source || measurement?.selected_image_source || 'unknown';
  const analysisZoom = dbMeasurement?.analysis_zoom || measurement?.analysis_zoom || 20;
  const analysisImageSize = dbMeasurement?.analysis_image_size?.width || measurement?.analysis_image_size?.width || 640;
  
  // GPS coordinates from measurement vs displayed
  const analysisGps = measurement?.gps_coordinates || dbMeasurement?.gps_coordinates;
  const gpsLat = analysisGps?.lat || 0;
  const gpsLng = analysisGps?.lng || 0;
  
  // Calculate coordinate mismatch in meters
  const latDiff = Math.abs(gpsLat - centerLat) * 111320; // 1 degree ≈ 111.32km
  const lngDiff = Math.abs(gpsLng - centerLng) * 111320 * Math.cos(centerLat * Math.PI / 180);
  const coordMismatchMeters = Math.sqrt(latDiff ** 2 + lngDiff ** 2);
  
  // Solar API validation
  const solarFootprint = dbMeasurement?.solar_building_footprint_sqft || measurement?.solar_api_response?.buildingFootprintSqft || 0;
  const planArea = dbMeasurement?.summary?.plan_area_sqft || tags['roof.plan_area'] || 0;
  const solarVariance = solarFootprint > 0 && planArea > 0 
    ? ((planArea - solarFootprint) / solarFootprint * 100).toFixed(1)
    : 'N/A';
  
  // Shrinkage status from metadata
  const shrinkageApplied = dbMeasurement?.metadata?.shrinkage_applied || measurement?.metadata?.shrinkage_applied;
  const shrinkageReason = dbMeasurement?.metadata?.shrinkage_reason || measurement?.metadata?.shrinkage_reason;
  
  // Image quality/shadow risk
  const imageQualityScore = dbMeasurement?.metadata?.image_quality_score || measurement?.metadata?.image_quality_score;
  const shadowRisk = dbMeasurement?.metadata?.shadow_risk || measurement?.metadata?.shadow_risk || 'unknown';
  
  // Vertex and feature counts
  const vertexCount = dbMeasurement?.summary?.vertex_count || 
    (Array.isArray(measurement?.faces) && measurement.faces[0]?.vertices?.length) || 0;
  const linearFeatures = dbMeasurement?.linear_features || measurement?.linear_features || [];
  const featureCounts = {
    ridge: linearFeatures.filter((f: any) => f.type === 'ridge').length,
    hip: linearFeatures.filter((f: any) => f.type === 'hip').length,
    valley: linearFeatures.filter((f: any) => f.type === 'valley').length,
    eave: linearFeatures.filter((f: any) => f.type === 'eave').length,
    rake: linearFeatures.filter((f: any) => f.type === 'rake').length,
  };
  
  // Determine overall status
  const hasCoordMismatch = coordMismatchMeters > 20;
  const hasZoomMismatch = Math.abs(analysisZoom - satelliteZoom) > 0;
  const hasUnexpectedVariance = typeof solarVariance === 'string' ? false : Math.abs(parseFloat(solarVariance)) > 10;
  const hasIssues = hasCoordMismatch || hasZoomMismatch || hasUnexpectedVariance || shadowRisk === 'high';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-md hover:bg-muted/50 text-sm font-medium">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-muted-foreground" />
          <span>🔧 Debug Info</span>
          {hasIssues && (
            <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
              {[hasCoordMismatch, hasZoomMismatch, hasUnexpectedVariance, shadowRisk === 'high'].filter(Boolean).length} issues
            </Badge>
          )}
        </div>
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </CollapsibleTrigger>
      
      <CollapsibleContent className="space-y-2 text-xs pt-2 px-1">
        {/* Measurement ID */}
        <div className="flex justify-between py-1 border-b">
          <span className="text-muted-foreground">Measurement ID:</span>
          <span className="font-mono text-[10px] truncate max-w-[150px]" title={measurementId}>
            {measurementId.slice(0, 8)}...
          </span>
        </div>
        
        {/* Image Source */}
        <div className="flex justify-between py-1 border-b">
          <span className="text-muted-foreground">Image Source:</span>
          <Badge variant="outline" className="text-[10px] h-4">
            {selectedImageSource}
          </Badge>
        </div>
        
        {/* Analysis Zoom */}
        <div className="flex justify-between py-1 border-b items-center">
          <span className="text-muted-foreground">Analysis Zoom:</span>
          <div className="flex items-center gap-1">
            <span>{analysisZoom}</span>
            {hasZoomMismatch && (
              <Badge variant="destructive" className="text-[10px] h-4 px-1">
                Display: {satelliteZoom}
              </Badge>
            )}
          </div>
        </div>
        
        {/* Analysis Image Size */}
        <div className="flex justify-between py-1 border-b">
          <span className="text-muted-foreground">Analysis Image:</span>
          <span>{analysisImageSize}×{analysisImageSize}px</span>
        </div>
        
        {/* Coordinate Mismatch */}
        <div className="flex justify-between py-1 border-b items-center">
          <span className="text-muted-foreground">Center Offset:</span>
          <div className="flex items-center gap-1">
            <span>{coordMismatchMeters.toFixed(1)}m</span>
            {hasCoordMismatch ? (
              <AlertTriangle className="h-3 w-3 text-destructive" />
            ) : (
              <CheckCircle className="h-3 w-3 text-green-500" />
            )}
          </div>
        </div>
        
        {/* Solar Variance */}
        <div className="flex justify-between py-1 border-b items-center">
          <span className="text-muted-foreground">vs Solar API:</span>
          <div className="flex items-center gap-1">
            <span>{solarVariance}%</span>
            {hasUnexpectedVariance ? (
              <AlertTriangle className="h-3 w-3 text-amber-500" />
            ) : solarVariance !== 'N/A' ? (
              <CheckCircle className="h-3 w-3 text-green-500" />
            ) : null}
          </div>
        </div>
        
        {/* Shrinkage Status */}
        <div className="flex justify-between py-1 border-b items-center">
          <span className="text-muted-foreground">Shrinkage:</span>
          <Badge 
            variant={shrinkageApplied ? 'secondary' : 'outline'} 
            className="text-[10px] h-4"
          >
            {shrinkageApplied ? `Applied (${shrinkageReason || 'over-trace'})` : 'None'}
          </Badge>
        </div>
        
        {/* Shadow Risk */}
        <div className="flex justify-between py-1 border-b items-center">
          <span className="text-muted-foreground">Shadow Risk:</span>
          <Badge 
            variant={shadowRisk === 'high' ? 'destructive' : shadowRisk === 'medium' ? 'secondary' : 'outline'}
            className="text-[10px] h-4"
          >
            {shadowRisk} {imageQualityScore ? `(${imageQualityScore}%)` : ''}
          </Badge>
        </div>
        
        {/* Vertex Count */}
        <div className="flex justify-between py-1 border-b">
          <span className="text-muted-foreground">Perimeter Vertices:</span>
          <span>{vertexCount}</span>
        </div>
        
        {/* Feature Counts */}
        <div className="flex justify-between py-1 border-b">
          <span className="text-muted-foreground">Linear Features:</span>
          <span className="font-mono text-[10px]">
            R:{featureCounts.ridge} H:{featureCounts.hip} V:{featureCounts.valley} E:{featureCounts.eave} K:{featureCounts.rake}
          </span>
        </div>
        
        {/* GPS Coordinates */}
        <div className="p-2 bg-muted/30 rounded text-[10px] font-mono">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Analysis Center:</span>
            <span>{gpsLat.toFixed(6)}, {gpsLng.toFixed(6)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Display Center:</span>
            <span>{centerLat.toFixed(6)}, {centerLng.toFixed(6)}</span>
          </div>
        </div>
        
        {/* Warnings */}
        {hasIssues && (
          <div className="p-2 bg-amber-50 dark:bg-amber-950/30 rounded text-[10px] space-y-1">
            {hasCoordMismatch && (
              <p className="text-amber-700 dark:text-amber-300">
                ⚠️ Center offset &gt;20m may cause overlay misalignment
              </p>
            )}
            {hasZoomMismatch && (
              <p className="text-amber-700 dark:text-amber-300">
                ⚠️ Display zoom differs from analysis zoom
              </p>
            )}
            {hasUnexpectedVariance && (
              <p className="text-amber-700 dark:text-amber-300">
                ⚠️ Area differs &gt;10% from Solar API reference
              </p>
            )}
            {shadowRisk === 'high' && (
              <p className="text-amber-700 dark:text-amber-300">
                ⚠️ High shadow risk - measurements may be affected
              </p>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
