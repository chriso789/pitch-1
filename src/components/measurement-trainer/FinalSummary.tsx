import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { FileJson, Copy, Download, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { 
  PlaneCalculation, 
  LinearSegment, 
  ComplexityCounts,
  OrderCalculation,
  QCResult,
  RoofWorksheetJSON,
  WasteBand,
  calculateOrder
} from '@/lib/measurements/roofWorksheetCalculations';
import { JobInfo } from './WorksheetHeader';
import { PitchInfo } from '@/lib/measurements/roofWorksheetCalculations';

interface FinalSummaryProps {
  jobInfo: JobInfo;
  planes: PlaneCalculation[];
  linearSegments: LinearSegment[];
  complexity: ComplexityCounts;
  wastePercent: number;
  material: string;
  qcResult: QCResult;
  customPitches: PitchInfo[];
  complexityNotes: string;
}

export const FinalSummary: React.FC<FinalSummaryProps> = ({
  jobInfo,
  planes,
  linearSegments,
  complexity,
  wastePercent,
  material,
  qcResult,
  customPitches,
  complexityNotes,
}) => {
  // Calculate totals
  const totalPlanArea = planes.filter(p => p.include).reduce((sum, p) => sum + p.planAreaSqft, 0);
  const totalSurfaceArea = planes.filter(p => p.include).reduce((sum, p) => sum + p.surfaceAreaSqft, 0);
  
  const linearTotals = linearSegments.reduce((acc, seg) => {
    acc[seg.type] = (acc[seg.type] || 0) + seg.lengthFt;
    return acc;
  }, {} as Record<string, number>);
  
  const ridgeTotal = (linearTotals.ridge || 0) + (linearTotals.hip || 0);
  const eaveTotal = linearTotals.eave || 0;
  const perimeterTotal = (linearTotals.eave || 0) + (linearTotals.rake || 0);
  
  const orderCalc = calculateOrder(totalSurfaceArea, wastePercent, ridgeTotal, eaveTotal, perimeterTotal);
  
  // Build JSON output
  const buildJSON = (): RoofWorksheetJSON => {
    const wasteBand: WasteBand = 
      wastePercent <= 10 ? 'simple' :
      wastePercent <= 14 ? 'moderate' :
      wastePercent <= 18 ? 'cut_up' : 'extreme';
    
    return {
      job_info: {
        job_name: jobInfo.jobName,
        date: jobInfo.date,
        measurer: jobInfo.measurer,
        source: jobInfo.source,
        units: 'ft_sqft',
        rounding: { length_ft: 0.1, area_sqft: 1 },
        notes: jobInfo.notes,
      },
      pitches: customPitches,
      planes: planes.map(p => ({
        id: p.id,
        shape: p.shape,
        dimensions: p.dimensions,
        plan_area_sqft: p.planAreaSqft,
        pitch: p.pitch,
        slope_factor: p.pitchInfo.slopeFactor,
        surface_area_sqft: p.surfaceAreaSqft,
        include: p.include,
        notes: p.notes ? [p.notes] : [],
      })),
      plane_totals: {
        plan_area_sqft: totalPlanArea,
        surface_area_sqft: totalSurfaceArea,
        squares: totalSurfaceArea / 100,
      },
      linear_components: {
        segments: linearSegments.map(s => ({
          component: s.type,
          id: s.id,
          length_ft: s.lengthFt,
          type: s.measurementType,
          notes: s.notes,
        })),
        totals_ft: {
          ridge: linearTotals.ridge || 0,
          hip: linearTotals.hip || 0,
          valley: linearTotals.valley || 0,
          eave: linearTotals.eave || 0,
          rake: linearTotals.rake || 0,
          perimeter: perimeterTotal,
        },
      },
      complexity: {
        ...complexity,
        notes: complexityNotes ? [complexityNotes] : [],
      },
      waste: {
        material,
        band: wasteBand,
        waste_percent: wastePercent,
        justification: [`Chosen ${wastePercent}% based on ${complexity.planesCount} planes, ${complexity.valleysCount} valleys, ${complexity.dormersCount} dormers`],
      },
      totals_and_order: orderCalc,
      qc: qcResult,
    };
  };
  
  const jsonOutput = buildJSON();
  const jsonString = JSON.stringify(jsonOutput, null, 2);
  
  const copyToClipboard = () => {
    navigator.clipboard.writeText(jsonString);
    toast.success('JSON copied to clipboard');
  };
  
  const downloadJSON = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roof-worksheet-${jobInfo.jobName.replace(/[^a-z0-9]/gi, '-') || 'untitled'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('JSON file downloaded');
  };
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          8. Final Summary
        </CardTitle>
        <CardDescription>
          {qcResult.overallOk 
            ? 'All checks passed. Review final totals and export JSON.'
            : 'QC issues present. Results shown with caveats.'
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground uppercase">Total PLAN Area</p>
            <p className="text-xl font-bold font-mono">{totalPlanArea.toFixed(0)} sq ft</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground uppercase">Total SURFACE Area</p>
            <p className="text-xl font-bold font-mono">{totalSurfaceArea.toFixed(0)} sq ft</p>
          </div>
          <div className="bg-primary/10 rounded-lg p-3">
            <p className="text-xs text-primary uppercase">Roof Squares</p>
            <p className="text-xl font-bold font-mono text-primary">{orderCalc.roofSquares.toFixed(2)}</p>
          </div>
          <div className="bg-green-100 rounded-lg p-3">
            <p className="text-xs text-green-800 uppercase">Order Squares (+{wastePercent}%)</p>
            <p className="text-xl font-bold font-mono text-green-800">{orderCalc.orderSquares.toFixed(2)}</p>
          </div>
        </div>
        
        {/* Linear Totals */}
        <div>
          <p className="text-sm font-semibold mb-2">Linear Measurements (ft)</p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            <Badge variant="outline" className="justify-between py-1">
              <span>Ridge</span>
              <span className="font-mono">{(linearTotals.ridge || 0).toFixed(0)}</span>
            </Badge>
            <Badge variant="outline" className="justify-between py-1">
              <span>Hip</span>
              <span className="font-mono">{(linearTotals.hip || 0).toFixed(0)}</span>
            </Badge>
            <Badge variant="outline" className="justify-between py-1">
              <span>Valley</span>
              <span className="font-mono">{(linearTotals.valley || 0).toFixed(0)}</span>
            </Badge>
            <Badge variant="outline" className="justify-between py-1">
              <span>Eave</span>
              <span className="font-mono">{(linearTotals.eave || 0).toFixed(0)}</span>
            </Badge>
            <Badge variant="outline" className="justify-between py-1">
              <span>Rake</span>
              <span className="font-mono">{(linearTotals.rake || 0).toFixed(0)}</span>
            </Badge>
            <Badge variant="secondary" className="justify-between py-1">
              <span>Perimeter</span>
              <span className="font-mono">{perimeterTotal.toFixed(0)}</span>
            </Badge>
          </div>
        </div>
        
        {/* Order Calculations */}
        <div className="bg-muted/30 rounded-lg p-4 space-y-2">
          <p className="text-sm font-semibold">Order Calculations</p>
          <div className="text-sm font-mono space-y-1">
            <p className="text-muted-foreground">{orderCalc.calculations.roofSquaresCalc}</p>
            <p className="text-muted-foreground">{orderCalc.calculations.orderSquaresCalc}</p>
          </div>
          <Separator className="my-2" />
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Ridge Cap LF</p>
              <p className="font-mono font-semibold">{ridgeTotal.toFixed(0)} ft</p>
            </div>
            <div>
              <p className="text-muted-foreground">Starter LF</p>
              <p className="font-mono font-semibold">{eaveTotal.toFixed(0)} ft</p>
            </div>
            <div>
              <p className="text-muted-foreground">Drip Edge LF</p>
              <p className="font-mono font-semibold">{perimeterTotal.toFixed(0)} ft</p>
            </div>
          </div>
        </div>
        
        {/* JSON Output */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold flex items-center gap-2">
              <FileJson className="h-4 w-4" />
              JSON Output
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyToClipboard}>
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </Button>
              <Button variant="outline" size="sm" onClick={downloadJSON}>
                <Download className="h-3 w-3 mr-1" />
                Download
              </Button>
            </div>
          </div>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-xs overflow-x-auto max-h-64">
            {jsonString}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
};
