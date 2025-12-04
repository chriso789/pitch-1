import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Calendar, Camera, Clock, History, Pencil } from 'lucide-react';
import { format } from 'date-fns';

interface ImageryDate {
  year: number;
  month: number;
  day: number;
}

interface ImageryAgeWarningProps {
  imageryDate?: ImageryDate;
  onDrawManually?: () => void;
  onViewHistory?: () => void;
  className?: string;
}

export function ImageryAgeWarning({
  imageryDate,
  onDrawManually,
  onViewHistory,
  className = ''
}: ImageryAgeWarningProps) {
  if (!imageryDate) return null;

  const imageDate = new Date(imageryDate.year, imageryDate.month - 1, imageryDate.day);
  const now = new Date();
  const ageInYears = Math.floor((now.getTime() - imageDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const ageInMonths = Math.floor((now.getTime() - imageDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000));

  // Only show warning if imagery is older than 2 years
  if (ageInYears < 2) return null;

  const getSeverity = () => {
    if (ageInYears >= 8) return 'critical';
    if (ageInYears >= 5) return 'high';
    if (ageInYears >= 3) return 'medium';
    return 'low';
  };

  const severity = getSeverity();

  const getSeverityStyles = () => {
    switch (severity) {
      case 'critical':
        return 'bg-destructive/15 border-destructive text-destructive';
      case 'high':
        return 'bg-orange-500/15 border-orange-500 text-orange-700 dark:text-orange-400';
      case 'medium':
        return 'bg-yellow-500/15 border-yellow-500 text-yellow-700 dark:text-yellow-400';
      default:
        return 'bg-blue-500/15 border-blue-500 text-blue-700 dark:text-blue-400';
    }
  };

  const getRecommendation = () => {
    if (ageInYears >= 8) {
      return 'Critical: Use manual drawing tools to verify measurements against current satellite imagery.';
    }
    if (ageInYears >= 5) {
      return 'Roof may have been replaced or modified. Verify measurements carefully.';
    }
    return 'Measurements may not reflect recent changes. Consider manual verification.';
  };

  return (
    <Alert className={`${getSeverityStyles()} ${className}`}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2">
        <span>Outdated Imagery Warning</span>
        <Badge variant={severity === 'critical' ? 'destructive' : 'secondary'} className="text-xs">
          {ageInYears} years old
        </Badge>
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 opacity-70" />
          <span>
            Measurements based on imagery from{' '}
            <span className="font-medium">{format(imageDate, 'MMMM d, yyyy')}</span>
          </span>
        </div>
        
        <p className="text-sm opacity-90">{getRecommendation()}</p>

        <div className="flex flex-wrap gap-2 pt-1">
          {onDrawManually && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onDrawManually}
              className="gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" />
              Draw Manually
            </Button>
          )}
          {onViewHistory && (
            <Button
              variant="outline"
              size="sm"
              onClick={onViewHistory}
              className="gap-1.5"
            >
              <History className="h-3.5 w-3.5" />
              View History
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
