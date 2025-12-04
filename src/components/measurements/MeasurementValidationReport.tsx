import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Calendar, 
  Ruler, 
  Home, 
  BarChart3,
  Pencil,
  FileCheck,
  Clock,
  Layers,
  ArrowRight
} from 'lucide-react';
import { format } from 'date-fns';

interface ValidationCheck {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: string;
}

interface MeasurementValidationReportProps {
  measurement: any;
  tags: Record<string, any>;
  imageryDate?: { year: number; month: number; day: number };
  onDrawManually?: () => void;
  onAcceptWithNotes?: (notes: string) => void;
  className?: string;
}

export function MeasurementValidationReport({
  measurement,
  tags,
  imageryDate,
  onDrawManually,
  onAcceptWithNotes,
  className = ''
}: MeasurementValidationReportProps) {
  const currentYear = new Date().getFullYear();
  const imageryYear = imageryDate?.year || currentYear;
  const imageryAge = currentYear - imageryYear;

  // Run validation checks
  const getValidationChecks = (): ValidationCheck[] => {
    const checks: ValidationCheck[] = [];

    // 1. Imagery Age Check
    if (imageryAge > 5) {
      checks.push({
        name: 'Imagery Age',
        status: 'fail',
        message: `Imagery is ${imageryAge} years old`,
        details: 'Roof may have been replaced, damaged, or modified since baseline imagery was captured.'
      });
    } else if (imageryAge > 2) {
      checks.push({
        name: 'Imagery Age',
        status: 'warning',
        message: `Imagery is ${imageryAge} years old`,
        details: 'Consider verifying measurements if recent work was done.'
      });
    } else {
      checks.push({
        name: 'Imagery Age',
        status: 'pass',
        message: 'Imagery is current',
        details: 'Baseline imagery is recent and reliable.'
      });
    }

    // 2. Ridge/Hip Detection Check
    const ridge = tags['lf.ridge'] || measurement?.summary?.ridge_ft || 0;
    const hip = tags['lf.hip'] || measurement?.summary?.hip_ft || 0;
    const totalArea = tags['roof.plan_area'] || measurement?.summary?.total_area_sqft || 0;

    if (totalArea > 2000 && ridge < 30 && hip === 0) {
      checks.push({
        name: 'Ridge/Hip Detection',
        status: 'fail',
        message: 'Suspiciously low ridge/hip values',
        details: `Ridge: ${ridge.toFixed(0)} ft, Hip: ${hip.toFixed(0)} ft for a ${totalArea.toFixed(0)} sq ft roof. Possible tarp or obstruction.`
      });
    } else if (ridge > 0 || hip > 0) {
      checks.push({
        name: 'Ridge/Hip Detection',
        status: 'pass',
        message: 'Ridge/Hip detected successfully',
        details: `Ridge: ${ridge.toFixed(0)} ft, Hip: ${hip.toFixed(0)} ft`
      });
    } else {
      checks.push({
        name: 'Ridge/Hip Detection',
        status: 'warning',
        message: 'No ridge/hip lines detected',
        details: 'May be a flat roof or detection issue.'
      });
    }

    // 3. Facet Count Check
    const facetCount = measurement?.faces?.length || 0;
    if (facetCount === 0) {
      checks.push({
        name: 'Roof Facets',
        status: 'fail',
        message: 'No roof facets detected',
        details: 'Manual measurement may be required.'
      });
    } else if (facetCount < 2 && totalArea > 1500) {
      checks.push({
        name: 'Roof Facets',
        status: 'warning',
        message: `Only ${facetCount} facet detected`,
        details: 'Large roof with few facets may indicate detection issues.'
      });
    } else {
      checks.push({
        name: 'Roof Facets',
        status: 'pass',
        message: `${facetCount} facets detected`,
        details: 'Roof geometry captured successfully.'
      });
    }

    // 4. Area Reasonability Check
    if (totalArea < 500) {
      checks.push({
        name: 'Area Reasonability',
        status: 'warning',
        message: `Area (${totalArea.toFixed(0)} sq ft) seems small`,
        details: 'Verify this is the complete roof area.'
      });
    } else if (totalArea > 10000) {
      checks.push({
        name: 'Area Reasonability',
        status: 'warning',
        message: `Area (${totalArea.toFixed(0)} sq ft) is very large`,
        details: 'Verify this is a single residential property.'
      });
    } else {
      checks.push({
        name: 'Area Reasonability',
        status: 'pass',
        message: `Area ${totalArea.toFixed(0)} sq ft within normal range`,
        details: 'Typical residential roof size.'
      });
    }

    // 5. Confidence Score Check
    const confidence = measurement?.confidence || 0;
    if (confidence < 0.5) {
      checks.push({
        name: 'Confidence Score',
        status: 'fail',
        message: `Low confidence (${(confidence * 100).toFixed(0)}%)`,
        details: 'AI detection had difficulty with this property.'
      });
    } else if (confidence < 0.8) {
      checks.push({
        name: 'Confidence Score',
        status: 'warning',
        message: `Medium confidence (${(confidence * 100).toFixed(0)}%)`,
        details: 'Some measurements may need manual verification.'
      });
    } else {
      checks.push({
        name: 'Confidence Score',
        status: 'pass',
        message: `High confidence (${(confidence * 100).toFixed(0)}%)`,
        details: 'AI detection is confident in measurements.'
      });
    }

    return checks;
  };

  const checks = getValidationChecks();
  const passCount = checks.filter(c => c.status === 'pass').length;
  const warningCount = checks.filter(c => c.status === 'warning').length;
  const failCount = checks.filter(c => c.status === 'fail').length;
  const overallScore = (passCount / checks.length) * 100;

  const getOverallStatus = () => {
    if (failCount > 0) return 'fail';
    if (warningCount > 1) return 'warning';
    return 'pass';
  };

  const overallStatus = getOverallStatus();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'fail':
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileCheck className="h-4 w-4" />
            Validation Report
          </CardTitle>
          <Badge 
            variant={overallStatus === 'pass' ? 'default' : overallStatus === 'warning' ? 'secondary' : 'destructive'}
          >
            {passCount}/{checks.length} Passed
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Score */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Validation Score</span>
            <span className="font-medium">{overallScore.toFixed(0)}%</span>
          </div>
          <Progress 
            value={overallScore} 
            className={
              overallStatus === 'pass' 
                ? '[&>div]:bg-green-500' 
                : overallStatus === 'warning' 
                ? '[&>div]:bg-yellow-500' 
                : '[&>div]:bg-destructive'
            }
          />
        </div>

        <Separator />

        {/* Validation Checks */}
        <div className="space-y-2">
          {checks.map((check, index) => (
            <div 
              key={index}
              className={`p-2 rounded-lg border ${
                check.status === 'pass' 
                  ? 'bg-green-500/5 border-green-500/20' 
                  : check.status === 'warning'
                  ? 'bg-yellow-500/5 border-yellow-500/20'
                  : 'bg-destructive/5 border-destructive/20'
              }`}
            >
              <div className="flex items-start gap-2">
                {getStatusIcon(check.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{check.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {check.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{check.message}</p>
                  {check.details && (
                    <p className="text-xs text-muted-foreground/80 mt-1">{check.details}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Recommendations */}
        {(failCount > 0 || warningCount > 1) && (
          <>
            <Separator />
            <Alert variant={failCount > 0 ? 'destructive' : 'default'}>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Recommended Actions</AlertTitle>
              <AlertDescription className="space-y-2">
                {imageryAge > 5 && (
                  <div className="flex items-center gap-2 text-sm">
                    <ArrowRight className="h-3 w-3" />
                    <span>Use manual drawing tools to verify against current satellite imagery</span>
                  </div>
                )}
                {(tags['lf.ridge'] || 0) < 30 && (tags['lf.hip'] || 0) === 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <ArrowRight className="h-3 w-3" />
                    <span>Manually add ridge and hip lines if tarp/obstruction is present</span>
                  </div>
                )}
                {(measurement?.confidence || 0) < 0.6 && (
                  <div className="flex items-center gap-2 text-sm">
                    <ArrowRight className="h-3 w-3" />
                    <span>Consider requesting premium measurement service</span>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          </>
        )}

        {/* Action Buttons */}
        {onDrawManually && failCount > 0 && (
          <Button onClick={onDrawManually} className="w-full">
            <Pencil className="h-4 w-4 mr-2" />
            Draw Measurements Manually
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
