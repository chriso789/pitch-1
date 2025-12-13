import { AlertTriangle, CheckCircle2, Upload, MapPin, ZoomIn } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface AccuracyWarning {
  type: 'zoom' | 'coordinates' | 'no_ground_truth' | 'variance';
  severity: 'warning' | 'error';
  message: string;
}

interface MeasurementAccuracyWarningProps {
  warnings: AccuracyWarning[];
  onUploadReport?: () => void;
  onVerifyAddress?: () => void;
  className?: string;
}

export function MeasurementAccuracyWarning({
  warnings,
  onUploadReport,
  onVerifyAddress,
  className = ''
}: MeasurementAccuracyWarningProps) {
  if (warnings.length === 0) {
    return null;
  }

  const hasError = warnings.some(w => w.severity === 'error');
  const hasWarning = warnings.some(w => w.severity === 'warning');

  return (
    <Alert 
      variant={hasError ? "destructive" : "default"} 
      className={`${className} ${hasWarning && !hasError ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20' : ''}`}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2">
        Measurement Accuracy Notice
        {hasError && <Badge variant="destructive" className="text-xs">Action Required</Badge>}
      </AlertTitle>
      <AlertDescription className="mt-2">
        <ul className="space-y-2 text-sm">
          {warnings.map((warning, i) => (
            <li key={i} className="flex items-start gap-2">
              {warning.type === 'zoom' && <ZoomIn className="h-4 w-4 mt-0.5 text-yellow-600" />}
              {warning.type === 'coordinates' && <MapPin className="h-4 w-4 mt-0.5 text-red-600" />}
              {warning.type === 'no_ground_truth' && <Upload className="h-4 w-4 mt-0.5 text-blue-600" />}
              {warning.type === 'variance' && <AlertTriangle className="h-4 w-4 mt-0.5 text-orange-600" />}
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
        
        <div className="flex flex-wrap gap-2 mt-3">
          {warnings.some(w => w.type === 'coordinates') && onVerifyAddress && (
            <Button variant="outline" size="sm" onClick={onVerifyAddress} className="gap-1">
              <MapPin className="h-3 w-3" />
              Verify Address
            </Button>
          )}
          {warnings.some(w => w.type === 'no_ground_truth' || w.type === 'variance') && onUploadReport && (
            <Button variant="outline" size="sm" onClick={onUploadReport} className="gap-1">
              <Upload className="h-3 w-3" />
              Upload Professional Report
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

// Helper function to generate warnings based on measurement context
export function generateAccuracyWarnings({
  zoomLevel,
  hasVerifiedAddress,
  hasGroundTruth,
  measuredArea,
  expectedArea,
}: {
  zoomLevel?: number;
  hasVerifiedAddress: boolean;
  hasGroundTruth: boolean;
  measuredArea?: number;
  expectedArea?: number;
}): AccuracyWarning[] {
  const warnings: AccuracyWarning[] = [];

  // Zoom level warning
  if (zoomLevel !== undefined && zoomLevel < 19) {
    warnings.push({
      type: 'zoom',
      severity: 'warning',
      message: `Zoom level ${zoomLevel.toFixed(1)} is below recommended (19+). Increase zoom for better accuracy.`
    });
  }

  // Coordinates warning
  if (!hasVerifiedAddress) {
    warnings.push({
      type: 'coordinates',
      severity: 'error',
      message: 'Address not verified via Google Places. Coordinates may be inaccurate. Verify address first.'
    });
  }

  // No ground truth warning
  if (!hasGroundTruth) {
    warnings.push({
      type: 'no_ground_truth',
      severity: 'warning',
      message: 'No professional report available for validation. Upload an EagleView/Roofr report for accuracy comparison.'
    });
  }

  // Variance warning
  if (measuredArea && expectedArea && expectedArea > 0) {
    const variancePct = Math.abs((measuredArea - expectedArea) / expectedArea) * 100;
    if (variancePct > 20) {
      warnings.push({
        type: 'variance',
        severity: 'warning',
        message: `Measured area (${measuredArea.toFixed(0)} sq ft) differs ${variancePct.toFixed(0)}% from expected. Consider uploading a professional report.`
      });
    }
  }

  // Large area warning for single-family residential
  if (measuredArea && measuredArea > 5000 && !hasGroundTruth) {
    warnings.push({
      type: 'variance',
      severity: 'warning',
      message: `Large area detected (${measuredArea.toFixed(0)} sq ft). For accuracy, upload a professional measurement report.`
    });
  }

  return warnings;
}
