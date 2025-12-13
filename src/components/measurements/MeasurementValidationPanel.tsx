import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Ruler, 
  Square, 
  ArrowUp,
  Calculator,
  Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  GPSPolygon, 
  validatePolygon, 
  categorizeEdges, 
  PITCH_MULTIPLIERS 
} from '@/utils/gpsCalculations';
import type { EdgeSegment } from '@/utils/gpsCalculations';

interface MeasurementValidationPanelProps {
  facets: GPSPolygon[];
  aiSuggestion?: {
    totalSqft: number;
    facetCount: number;
  };
  onValidationChange?: (isValid: boolean, errors: string[]) => void;
}

interface ValidationCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warning' | 'pending';
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export function MeasurementValidationPanel({
  facets,
  aiSuggestion,
  onValidationChange,
}: MeasurementValidationPanelProps) {
  // Calculate totals
  const totals = useMemo(() => {
    const totalFlatArea = facets.reduce((sum, f) => sum + f.areaSqft, 0);
    const totalAdjustedArea = facets.reduce((sum, f) => sum + (f.adjustedAreaSqft || f.areaSqft), 0);
    const totalPerimeter = facets.reduce((sum, f) => sum + f.perimeterFt, 0);
    
    // Aggregate edge segments
    const allEdges: EdgeSegment[] = facets.flatMap(f => f.edges || []);
    const edgeTotals = categorizeEdges(allEdges);
    
    return {
      flatArea: Math.round(totalFlatArea * 100) / 100,
      adjustedArea: Math.round(totalAdjustedArea * 100) / 100,
      squares: Math.round((totalAdjustedArea / 100) * 100) / 100,
      perimeter: Math.round(totalPerimeter * 100) / 100,
      facetCount: facets.length,
      edges: edgeTotals,
    };
  }, [facets]);

  // Run validation checks
  const validationChecks = useMemo((): ValidationCheck[] => {
    const checks: ValidationCheck[] = [];
    
    // 1. Minimum facet count
    if (facets.length === 0) {
      checks.push({
        id: 'facet-count',
        label: 'Facet Count',
        status: 'fail',
        message: 'No roof facets have been drawn',
        severity: 'error',
      });
    } else {
      checks.push({
        id: 'facet-count',
        label: 'Facet Count',
        status: 'pass',
        message: `${facets.length} facet${facets.length > 1 ? 's' : ''} defined`,
        severity: 'info',
      });
    }

    // 2. Total area validation
    if (totals.adjustedArea < 100) {
      checks.push({
        id: 'total-area',
        label: 'Total Area',
        status: 'fail',
        message: 'Total area is too small (<100 sq ft)',
        severity: 'error',
      });
    } else if (totals.adjustedArea > 50000) {
      checks.push({
        id: 'total-area',
        label: 'Total Area',
        status: 'warning',
        message: 'Total area is unusually large (>50,000 sq ft)',
        severity: 'warning',
      });
    } else {
      checks.push({
        id: 'total-area',
        label: 'Total Area',
        status: 'pass',
        message: `${totals.adjustedArea.toLocaleString()} sq ft (${totals.squares.toFixed(1)} squares)`,
        severity: 'info',
      });
    }

    // 3. AI variance check (if AI suggestion available)
    if (aiSuggestion && totals.adjustedArea > 0) {
      const variance = Math.abs(
        ((totals.adjustedArea - aiSuggestion.totalSqft) / aiSuggestion.totalSqft) * 100
      );
      
      if (variance > 20) {
        checks.push({
          id: 'ai-variance',
          label: 'AI Variance',
          status: 'warning',
          message: `${variance.toFixed(1)}% variance from AI (AI: ${aiSuggestion.totalSqft.toLocaleString()} sq ft)`,
          severity: 'warning',
        });
      } else if (variance > 10) {
        checks.push({
          id: 'ai-variance',
          label: 'AI Variance',
          status: 'warning',
          message: `${variance.toFixed(1)}% variance from AI estimate`,
          severity: 'warning',
        });
      } else {
        checks.push({
          id: 'ai-variance',
          label: 'AI Variance',
          status: 'pass',
          message: `${variance.toFixed(1)}% variance (within tolerance)`,
          severity: 'info',
        });
      }
    }

    // 4. Pitch assignment check
    const facetsWithoutPitch = facets.filter(f => !f.pitch);
    if (facetsWithoutPitch.length > 0) {
      checks.push({
        id: 'pitch-assignment',
        label: 'Pitch Assignment',
        status: 'warning',
        message: `${facetsWithoutPitch.length} facet${facetsWithoutPitch.length > 1 ? 's' : ''} missing pitch`,
        severity: 'warning',
      });
    } else if (facets.length > 0) {
      checks.push({
        id: 'pitch-assignment',
        label: 'Pitch Assignment',
        status: 'pass',
        message: 'All facets have pitch assigned',
        severity: 'info',
      });
    }

    // 5. Edge categorization check
    const hasEaves = totals.edges.eave > 0;
    const hasRidges = totals.edges.ridge > 0 || totals.edges.hip > 0;
    
    if (!hasEaves && facets.length > 0) {
      checks.push({
        id: 'edge-eaves',
        label: 'Edge Classification',
        status: 'warning',
        message: 'No eave edges identified (bottom edges)',
        severity: 'warning',
      });
    }
    
    if (!hasRidges && facets.length > 0) {
      checks.push({
        id: 'edge-ridges',
        label: 'Edge Classification',
        status: 'warning',
        message: 'No ridge or hip edges identified (top edges)',
        severity: 'warning',
      });
    }
    
    if (hasEaves && hasRidges) {
      const totalEdgeLength = Object.values(totals.edges).reduce((a, b) => a + b, 0);
      checks.push({
        id: 'edge-classification',
        label: 'Edge Classification',
        status: 'pass',
        message: `${Math.round(totalEdgeLength)} ft of edges classified`,
        severity: 'info',
      });
    }

    // 6. Polygon validity
    const invalidFacets = facets.filter(f => {
      const validation = validatePolygon(f);
      return !validation.isValid;
    });
    
    if (invalidFacets.length > 0) {
      checks.push({
        id: 'polygon-validity',
        label: 'Polygon Validity',
        status: 'fail',
        message: `${invalidFacets.length} facet${invalidFacets.length > 1 ? 's have' : ' has'} validation errors`,
        severity: 'error',
      });
    } else if (facets.length > 0) {
      checks.push({
        id: 'polygon-validity',
        label: 'Polygon Validity',
        status: 'pass',
        message: 'All polygons are valid',
        severity: 'info',
      });
    }

    return checks;
  }, [facets, totals, aiSuggestion]);

  // Calculate overall validation status
  const overallStatus = useMemo(() => {
    const errors = validationChecks.filter(c => c.status === 'fail');
    const warnings = validationChecks.filter(c => c.status === 'warning');
    
    const isValid = errors.length === 0;
    
    // Notify parent
    onValidationChange?.(isValid, errors.map(e => e.message));
    
    return {
      isValid,
      errorCount: errors.length,
      warningCount: warnings.length,
      passCount: validationChecks.filter(c => c.status === 'pass').length,
      score: Math.round(
        (validationChecks.filter(c => c.status === 'pass').length / 
         Math.max(validationChecks.length, 1)) * 100
      ),
    };
  }, [validationChecks, onValidationChange]);

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Measurement Validation
          </div>
          <Badge 
            variant={overallStatus.isValid ? 'default' : 'destructive'}
            className={cn(
              overallStatus.isValid 
                ? 'bg-green-500/10 text-green-600 border-green-200' 
                : 'bg-red-500/10 text-red-600 border-red-200'
            )}
          >
            {overallStatus.isValid ? 'Ready' : `${overallStatus.errorCount} Error${overallStatus.errorCount > 1 ? 's' : ''}`}
          </Badge>
        </CardTitle>
        
        {/* Score bar */}
        <div className="space-y-1.5 pt-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Validation Score</span>
            <span>{overallStatus.score}%</span>
          </div>
          <Progress 
            value={overallStatus.score} 
            className={cn(
              "h-2",
              overallStatus.score === 100 && "[&>div]:bg-green-500",
              overallStatus.score < 100 && overallStatus.score >= 70 && "[&>div]:bg-yellow-500",
              overallStatus.score < 70 && "[&>div]:bg-red-500"
            )}
          />
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Square className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Total Area:</span>
            <span className="font-medium">{totals.adjustedArea.toLocaleString()} sq ft</span>
          </div>
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Squares:</span>
            <span className="font-medium">{totals.squares.toFixed(1)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Perimeter:</span>
            <span className="font-medium">{totals.perimeter.toFixed(0)} ft</span>
          </div>
          <div className="flex items-center gap-2">
            <ArrowUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Facets:</span>
            <span className="font-medium">{totals.facetCount}</span>
          </div>
        </div>

        <Separator />

        {/* Validation Checks */}
        <div className="space-y-2">
          {validationChecks.map((check) => (
            <div 
              key={check.id}
              className={cn(
                "flex items-start gap-2 text-sm p-2 rounded-md",
                check.status === 'fail' && "bg-red-50 dark:bg-red-950/20",
                check.status === 'warning' && "bg-yellow-50 dark:bg-yellow-950/20",
                check.status === 'pass' && "bg-green-50/50 dark:bg-green-950/10"
              )}
            >
              {check.status === 'pass' && (
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              )}
              {check.status === 'fail' && (
                <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              )}
              {check.status === 'warning' && (
                <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
              )}
              <div>
                <span className="font-medium">{check.label}:</span>{' '}
                <span className="text-muted-foreground">{check.message}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Edge Breakdown */}
        {Object.values(totals.edges).some(v => v > 0) && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Edge Classification</h4>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {Object.entries(totals.edges).map(([type, length]) => (
                  length > 0 && (
                    <div key={type} className="flex justify-between px-2 py-1 bg-muted/50 rounded">
                      <span className="capitalize">{type.replace('_', ' ')}</span>
                      <span className="font-medium">{Math.round(length)} ft</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          </>
        )}

        {/* Blocking error message */}
        {!overallStatus.isValid && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              Fix all errors before generating the report. Measurements with errors cannot be saved.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
