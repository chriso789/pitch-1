import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, XCircle, AlertTriangle, FileCheck, ArrowRight } from 'lucide-react';

interface MeasurementSet {
  totalArea: number;
  facetCount: number;
  pitch: string;
  perimeter?: number; // NEW: Perimeter = eave + rake
  linear: {
    ridges: number;
    hips: number;
    valleys: number;
    eaves: number;
    rakes: number;
  };
}

interface MeasurementComparisonPanelProps {
  aiMeasurements: MeasurementSet;
  pdfMeasurements: MeasurementSet | null;
  onAcceptPdf?: () => void;
  onAcceptAi?: () => void;
  className?: string;
}

interface ComparisonRow {
  label: string;
  aiValue: number | string;
  pdfValue: number | string | null;
  unit: string;
  tolerance: number; // percentage tolerance for pass/fail
}

export function MeasurementComparisonPanel({
  aiMeasurements,
  pdfMeasurements,
  onAcceptPdf,
  onAcceptAi,
  className = '',
}: MeasurementComparisonPanelProps) {
  const hasPdf = pdfMeasurements !== null;
  
  // Calculate variances
  const calculateVariance = (ai: number, pdf: number): number => {
    if (pdf === 0) return ai === 0 ? 0 : 100;
    return ((ai - pdf) / pdf) * 100;
  };

  const getStatus = (variance: number, tolerance: number): 'pass' | 'warn' | 'fail' => {
    const absVariance = Math.abs(variance);
    if (absVariance <= tolerance) return 'pass';
    if (absVariance <= tolerance * 2) return 'warn';
    return 'fail';
  };

  // Calculate perimeter from eave + rake
  const aiPerimeter = (aiMeasurements.perimeter ?? (aiMeasurements.linear.eaves + aiMeasurements.linear.rakes));
  const pdfPerimeter = pdfMeasurements ? (pdfMeasurements.perimeter ?? (pdfMeasurements.linear.eaves + pdfMeasurements.linear.rakes)) : null;

  const comparisons: ComparisonRow[] = [
    {
      label: 'Total Area',
      aiValue: aiMeasurements.totalArea,
      pdfValue: pdfMeasurements?.totalArea ?? null,
      unit: 'sq ft',
      tolerance: 5,
    },
    {
      label: 'Facets',
      aiValue: aiMeasurements.facetCount,
      pdfValue: pdfMeasurements?.facetCount ?? null,
      unit: '',
      tolerance: 10,
    },
    {
      label: 'Pitch',
      aiValue: aiMeasurements.pitch,
      pdfValue: pdfMeasurements?.pitch ?? null,
      unit: '',
      tolerance: 0,
    },
    {
      label: 'Perimeter',
      aiValue: aiPerimeter,
      pdfValue: pdfPerimeter,
      unit: 'ft',
      tolerance: 5,
    },
    {
      label: 'Ridges',
      aiValue: aiMeasurements.linear.ridges,
      pdfValue: pdfMeasurements?.linear.ridges ?? null,
      unit: 'ft',
      tolerance: 10,
    },
    {
      label: 'Hips',
      aiValue: aiMeasurements.linear.hips,
      pdfValue: pdfMeasurements?.linear.hips ?? null,
      unit: 'ft',
      tolerance: 10,
    },
    {
      label: 'Valleys',
      aiValue: aiMeasurements.linear.valleys,
      pdfValue: pdfMeasurements?.linear.valleys ?? null,
      unit: 'ft',
      tolerance: 10,
    },
    {
      label: 'Eaves',
      aiValue: aiMeasurements.linear.eaves,
      pdfValue: pdfMeasurements?.linear.eaves ?? null,
      unit: 'ft',
      tolerance: 10,
    },
    {
      label: 'Rakes',
      aiValue: aiMeasurements.linear.rakes,
      pdfValue: pdfMeasurements?.linear.rakes ?? null,
      unit: 'ft',
      tolerance: 15,
    },
  ];

  // Count issues
  const issueCount = comparisons.filter(c => {
    if (typeof c.aiValue === 'string' || typeof c.pdfValue === 'string' || c.pdfValue === null) {
      return c.aiValue !== c.pdfValue;
    }
    const variance = calculateVariance(c.aiValue, c.pdfValue);
    return getStatus(variance, c.tolerance) === 'fail';
  }).length;

  const warnCount = comparisons.filter(c => {
    if (typeof c.aiValue === 'string' || typeof c.pdfValue === 'string' || c.pdfValue === null) return false;
    const variance = calculateVariance(c.aiValue, c.pdfValue);
    return getStatus(variance, c.tolerance) === 'warn';
  }).length;

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Measurement Comparison</h3>
        {hasPdf && (
          <div className="flex items-center gap-2">
            {issueCount === 0 && warnCount === 0 ? (
              <Badge className="bg-green-100 text-green-700">
                <CheckCircle className="h-3 w-3 mr-1" />
                All measurements match
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {issueCount} issues, {warnCount} warnings
              </Badge>
            )}
          </div>
        )}
      </div>

      {!hasPdf ? (
        <Alert>
          <FileCheck className="h-4 w-4" />
          <AlertDescription>
            Import a professional measurement report (EagleView, Roofr, etc.) to compare and validate AI measurements.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Comparison Table */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Metric</th>
                    <th className="text-right p-3 font-medium">AI</th>
                    <th className="text-right p-3 font-medium">PDF</th>
                    <th className="text-right p-3 font-medium">Variance</th>
                    <th className="text-center p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((row, idx) => {
                    const isNumeric = typeof row.aiValue === 'number' && typeof row.pdfValue === 'number';
                    const variance = isNumeric 
                      ? calculateVariance(row.aiValue as number, row.pdfValue as number)
                      : null;
                    const status = variance !== null 
                      ? getStatus(variance, row.tolerance)
                      : row.aiValue === row.pdfValue ? 'pass' : 'fail';

                    return (
                      <tr 
                        key={row.label} 
                        className={`border-b last:border-0 ${
                          status === 'fail' ? 'bg-red-50/50' : 
                          status === 'warn' ? 'bg-amber-50/50' : ''
                        }`}
                      >
                        <td className="p-3 font-medium">{row.label}</td>
                        <td className="p-3 text-right">
                          {typeof row.aiValue === 'number' 
                            ? row.aiValue.toLocaleString() 
                            : row.aiValue}
                          {row.unit && ` ${row.unit}`}
                        </td>
                        <td className="p-3 text-right font-semibold">
                          {row.pdfValue !== null && (
                            <>
                              {typeof row.pdfValue === 'number' 
                                ? row.pdfValue.toLocaleString() 
                                : row.pdfValue}
                              {row.unit && ` ${row.unit}`}
                            </>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {variance !== null && (
                            <span className={
                              status === 'fail' ? 'text-red-600 font-semibold' :
                              status === 'warn' ? 'text-amber-600' : 'text-green-600'
                            }>
                              {variance > 0 ? '+' : ''}{variance.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {status === 'pass' && (
                            <CheckCircle className="h-4 w-4 text-green-600 inline" />
                          )}
                          {status === 'warn' && (
                            <AlertTriangle className="h-4 w-4 text-amber-500 inline" />
                          )}
                          {status === 'fail' && (
                            <XCircle className="h-4 w-4 text-red-500 inline" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">
                {aiMeasurements.totalArea.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">AI Total (sq ft)</div>
            </Card>
            <Card className="p-4 text-center bg-muted/30">
              <ArrowRight className="h-5 w-5 mx-auto text-muted-foreground" />
              <div className="text-xs text-muted-foreground mt-1">
                {calculateVariance(aiMeasurements.totalArea, pdfMeasurements.totalArea).toFixed(1)}% diff
              </div>
            </Card>
            <Card className="p-4 text-center border-green-200 bg-green-50">
              <div className="text-2xl font-bold text-green-700">
                {pdfMeasurements.totalArea.toLocaleString()}
              </div>
              <div className="text-xs text-green-600">PDF Truth (sq ft)</div>
            </Card>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button 
              onClick={onAcceptPdf} 
              className="flex-1 bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Accept PDF as Truth
            </Button>
            <Button 
              variant="outline" 
              onClick={onAcceptAi}
              className="flex-1"
            >
              Keep AI Measurements
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default MeasurementComparisonPanel;
