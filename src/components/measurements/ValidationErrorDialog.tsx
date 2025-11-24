import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  AlertCircle, 
  AlertTriangle, 
  CheckCircle, 
  Info,
  X,
} from 'lucide-react';
import { ValidationError, ValidationResult } from '@/utils/measurementValidation';

interface ValidationErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  validationResult: ValidationResult;
  onContinueAnyway?: () => void;
  onFixErrors?: () => void;
  canContinue?: boolean;
}

export function ValidationErrorDialog({
  open,
  onOpenChange,
  validationResult,
  onContinueAnyway,
  onFixErrors,
  canContinue = false,
}: ValidationErrorDialogProps) {
  const { isValid, errors, warnings } = validationResult;

  const renderErrorItem = (error: ValidationError, index: number) => {
    const Icon = error.type === 'error' ? AlertCircle : AlertTriangle;
    const variant = error.type === 'error' ? 'destructive' : 'default';

    return (
      <Alert key={index} variant={variant} className="mb-3">
        <Icon className="h-4 w-4" />
        <AlertTitle className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            {error.field}
          </Badge>
          {error.message}
        </AlertTitle>
        {error.suggestion && (
          <AlertDescription className="mt-2 flex items-start gap-2">
            <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <span className="text-sm">{error.suggestion}</span>
          </AlertDescription>
        )}
      </Alert>
    );
  };

  const getSummaryIcon = () => {
    if (isValid && warnings.length === 0) return CheckCircle;
    if (errors.length > 0) return AlertCircle;
    return AlertTriangle;
  };

  const getSummaryColor = () => {
    if (isValid && warnings.length === 0) return 'text-green-600';
    if (errors.length > 0) return 'text-destructive';
    return 'text-yellow-600';
  };

  const getSummaryTitle = () => {
    if (isValid && warnings.length === 0) return 'All validations passed';
    if (errors.length > 0) return 'Validation errors found';
    return 'Validation warnings';
  };

  const getSummaryDescription = () => {
    if (isValid && warnings.length === 0) {
      return 'Your measurements are ready to save.';
    }
    if (errors.length > 0) {
      return `Found ${errors.length} error${errors.length > 1 ? 's' : ''} that must be fixed before saving.`;
    }
    return `Found ${warnings.length} warning${warnings.length > 1 ? 's' : ''} that should be reviewed.`;
  };

  const SummaryIcon = getSummaryIcon();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SummaryIcon className={`h-5 w-5 ${getSummaryColor()}`} />
            {getSummaryTitle()}
          </DialogTitle>
          <DialogDescription>
            {getSummaryDescription()}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[400px] pr-4">
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-destructive/10 rounded-lg">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium">Errors</span>
                </div>
                <p className="text-2xl font-bold text-destructive mt-1">{errors.length}</p>
              </div>
              <div className="p-4 bg-yellow-500/10 rounded-lg">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm font-medium">Warnings</span>
                </div>
                <p className="text-2xl font-bold text-yellow-600 mt-1">{warnings.length}</p>
              </div>
            </div>

            {/* Errors Section */}
            {errors.length > 0 && (
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Critical Issues
                </h4>
                {errors.map((error, index) => renderErrorItem(error, index))}
              </div>
            )}

            {/* Warnings Section */}
            {warnings.length > 0 && (
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2 text-yellow-600">
                  <AlertTriangle className="h-4 w-4" />
                  Recommendations
                </h4>
                {warnings.map((warning, index) => renderErrorItem(warning, index + errors.length))}
              </div>
            )}

            {/* Success State */}
            {isValid && warnings.length === 0 && (
              <Alert className="border-green-200 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-900">Ready to save</AlertTitle>
                <AlertDescription className="text-green-800">
                  All measurements have been validated and are ready to save.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          
          {errors.length > 0 && onFixErrors && (
            <Button onClick={onFixErrors}>
              Fix Errors
            </Button>
          )}

          {canContinue && warnings.length > 0 && errors.length === 0 && onContinueAnyway && (
            <Button onClick={onContinueAnyway}>
              Continue Anyway
            </Button>
          )}

          {isValid && (
            <Button onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
