import React from 'react';
import { AlertCircle, ShieldX } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

const REASON_LABELS: Record<string, { label: string; description: string }> = {
  LOW_COVERAGE: {
    label: 'Low Coverage',
    description: 'Detected geometry covers less than 85% of the roof footprint',
  },
  INVALID_FACES: {
    label: 'Invalid Faces',
    description: 'Less than 70% of detected roof faces passed validation',
  },
  WEAK_FOOTPRINT: {
    label: 'Weak Footprint',
    description: 'Footprint detection confidence is below 90%',
  },
  AREA_INFLATION: {
    label: 'Area Inflation',
    description: 'Pitch-adjusted area exceeds flat area by more than 25% — geometry is oversized',
  },
  area_inflation_after_merge: {
    label: 'Area Inflation',
    description: 'Plane merging inflated the total roof area beyond acceptable bounds',
  },
  footprint_not_snapped_to_eaves: {
    label: 'Footprint Drift',
    description: 'Footprint boundary does not align with actual roof eave lines',
  },
  no_ridge_hip_valley_on_pitched_roof: {
    label: 'Missing Structure',
    description: 'Pitched roof detected but no ridges, hips, or valleys found',
  },
  single_plane_for_large_footprint: {
    label: 'Single Plane',
    description: 'Large roof modeled as a single plane — likely multi-plane roof where detection failed',
  },
};

interface MeasurementFailureAlertProps {
  isValid: boolean;
  failReasons: string[] | null;
  areaRatio?: number | null;
  reportBlocked?: boolean;
}

export function MeasurementFailureAlert({
  isValid,
  failReasons,
  areaRatio,
  reportBlocked,
}: MeasurementFailureAlertProps) {
  if (isValid && !reportBlocked) return null;

  const reasons = failReasons ?? [];

  return (
    <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
      <ShieldX className="h-5 w-5" />
      <AlertTitle className="flex items-center gap-2 text-base font-semibold">
        <AlertCircle className="h-4 w-4" />
        Measurement Failed — Do Not Use
      </AlertTitle>
      <AlertDescription className="mt-3 space-y-3">
        <p className="text-sm text-destructive/90">
          This measurement did not pass validation and cannot be used for customer reports.
          {areaRatio != null && areaRatio > 1.25 && (
            <span className="ml-1 font-medium">
              Area ratio: {(areaRatio * 100).toFixed(0)}% (max 125%).
            </span>
          )}
        </p>

        {reasons.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {reasons.map((reason, i) => {
              const info = REASON_LABELS[reason];
              return (
                <Badge
                  key={i}
                  variant="destructive"
                  className="text-xs font-mono"
                  title={info?.description ?? reason}
                >
                  {info?.label ?? reason}
                </Badge>
              );
            })}
          </div>
        )}

        {reasons.length > 0 && (
          <ul className="text-xs text-destructive/80 space-y-1 mt-2 list-disc pl-4">
            {reasons.map((reason, i) => {
              const info = REASON_LABELS[reason];
              return info ? (
                <li key={i}>{info.description}</li>
              ) : (
                <li key={i}>{reason}</li>
              );
            })}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
