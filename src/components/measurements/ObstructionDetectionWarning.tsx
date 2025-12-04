import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, PenLine, Mountain, Triangle } from 'lucide-react';

interface ObstructionDetectionWarningProps {
  hip: number;
  ridge: number;
  imageryYear?: number;
  onDrawRidgeManually?: () => void;
  onDrawHipManually?: () => void;
}

/**
 * Warning component displayed when measurements indicate possible obstructions.
 * Triggers when:
 * - Hip = 0 (no hip lines detected, possible tarp or obstruction)
 * - Ridge < 40 ft (unusually short ridge, possible partial roof coverage)
 * 
 * This is common with tarped roofs from storm damage.
 */
export function ObstructionDetectionWarning({
  hip,
  ridge,
  imageryYear,
  onDrawRidgeManually,
  onDrawHipManually
}: ObstructionDetectionWarningProps) {
  // Only show warning if suspicious patterns detected
  const hasZeroHip = hip === 0;
  const hasShortRidge = ridge > 0 && ridge < 40;
  
  // Don't show if no issues detected
  if (!hasZeroHip && !hasShortRidge) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const imageryAge = imageryYear ? currentYear - imageryYear : null;

  return (
    <Alert variant="destructive" className="mb-4 border-orange-500 bg-orange-50 dark:bg-orange-950/20">
      <AlertTriangle className="h-5 w-5 text-orange-500" />
      <AlertTitle className="text-orange-700 dark:text-orange-400">
        Possible Roof Obstruction Detected
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <div className="text-sm text-orange-600 dark:text-orange-300">
          {hasZeroHip && (
            <p className="flex items-center gap-2">
              <Triangle className="h-4 w-4" />
              <strong>No hip lines detected</strong> - This may indicate a tarp, debris, or flat roof section obscuring the imagery.
            </p>
          )}
          {hasShortRidge && (
            <p className="flex items-center gap-2">
              <Mountain className="h-4 w-4" />
              <strong>Ridge line unusually short ({ridge.toFixed(0)} ft)</strong> - May indicate partial roof coverage or obstruction.
            </p>
          )}
          {imageryAge && imageryAge > 2 && (
            <p className="text-xs mt-2 opacity-80">
              Note: Measurement imagery is from {imageryYear} ({imageryAge} years old). Current roof condition may differ.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          {hasZeroHip && onDrawHipManually && (
            <Button 
              size="sm" 
              variant="outline"
              className="border-orange-500 text-orange-700 hover:bg-orange-100 dark:text-orange-300 dark:hover:bg-orange-900/30"
              onClick={onDrawHipManually}
            >
              <PenLine className="h-4 w-4 mr-2" />
              Draw Hip Manually
            </Button>
          )}
          {hasShortRidge && onDrawRidgeManually && (
            <Button 
              size="sm" 
              variant="outline"
              className="border-orange-500 text-orange-700 hover:bg-orange-100 dark:text-orange-300 dark:hover:bg-orange-900/30"
              onClick={onDrawRidgeManually}
            >
              <PenLine className="h-4 w-4 mr-2" />
              Draw Ridge Manually
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground pt-1">
          Manual verification recommended for accurate material estimates.
        </p>
      </AlertDescription>
    </Alert>
  );
}
