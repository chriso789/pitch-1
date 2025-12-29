import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Upload, CheckCircle, AlertTriangle, XCircle, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface RoofrData {
  provider: string;
  address: string;
  total_area_sqft: number;
  facet_count: number;
  predominant_pitch: string;
  linears: {
    eaves_lf: number;
    rakes_lf: number;
    ridges_lf: number;
    hips_lf: number;
    valleys_lf: number;
    step_flashing_lf: number;
    wall_flashing_lf: number;
    unspecified_lf: number;
  };
}

interface InternalMeasurement {
  total_area_sqft?: number;
  facet_count?: number;
  predominant_pitch?: string;
  eaves_lf?: number;
  rakes_lf?: number;
  ridges_lf?: number;
  hips_lf?: number;
  valleys_lf?: number;
  step_flashing_lf?: number;
  wall_flashing_lf?: number;
}

interface RoofrComparisonPanelProps {
  leadId: string;
  tenantId: string;
  internalMeasurement?: InternalMeasurement;
}

type DiffStatus = 'match' | 'close' | 'warning' | 'error';

function getDiffStatus(internal: number, external: number, thresholdPct: number = 10): DiffStatus {
  if (external === 0 && internal === 0) return 'match';
  if (external === 0) return internal > 0 ? 'warning' : 'match';
  
  const diff = Math.abs(internal - external) / external * 100;
  if (diff <= 2) return 'match';
  if (diff <= thresholdPct) return 'close';
  if (diff <= 25) return 'warning';
  return 'error';
}

function getDiffBadge(status: DiffStatus, diffPct: number) {
  switch (status) {
    case 'match':
      return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">✓ Match</Badge>;
    case 'close':
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30">{diffPct > 0 ? '+' : ''}{diffPct.toFixed(1)}%</Badge>;
    case 'warning':
      return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30">{diffPct > 0 ? '+' : ''}{diffPct.toFixed(1)}%</Badge>;
    case 'error':
      return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">{diffPct > 0 ? '+' : ''}{diffPct.toFixed(1)}%</Badge>;
  }
}

export function RoofrComparisonPanel({ leadId, tenantId, internalMeasurement }: RoofrComparisonPanelProps) {
  const [roofrData, setRoofrData] = useState<RoofrData | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      toast.error('Please upload a PDF file');
      return;
    }

    setIsUploading(true);

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64 = (e.target?.result as string)?.split(',')[1];
          
          const { data, error } = await supabase.functions.invoke('roof-report-ingest', {
            body: { base64_pdf: base64, lead_id: leadId }
          });

          if (error) throw error;
          if (!data?.ok) throw new Error(data?.message || 'Failed to parse PDF');

          // Map the parsed data to our component's expected format
          const parsed = data.parsed;
          setRoofrData({
            provider: parsed.provider || 'roofr',
            address: parsed.address || '',
            total_area_sqft: parsed.total_area_sqft || 0,
            facet_count: parsed.facet_count || 0,
            predominant_pitch: parsed.predominant_pitch || '',
            linears: {
              eaves_lf: parsed.eaves_ft || 0,
              rakes_lf: parsed.rakes_ft || 0,
              ridges_lf: parsed.ridges_ft || 0,
              hips_lf: parsed.hips_ft || 0,
              valleys_lf: parsed.valleys_ft || 0,
              step_flashing_lf: parsed.step_flashing_ft || 0,
              wall_flashing_lf: parsed.wall_flashing_ft || 0,
              unspecified_lf: parsed.unspecified_ft || 0,
            }
          });
          toast.success('Roofr report parsed successfully');
        } catch (err) {
          console.error('Upload error:', err);
          toast.error('Failed to parse Roofr PDF');
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to parse Roofr PDF');
      setIsUploading(false);
    }
  };

  // Calculate differences
  const calculateDiff = (internal: number | undefined, external: number): { pct: number; status: DiffStatus } => {
    const internalVal = internal || 0;
    const pct = external === 0 ? 0 : ((internalVal - external) / external) * 100;
    const status = getDiffStatus(internalVal, external);
    return { pct, status };
  };

  const areaDiff = roofrData ? calculateDiff(internalMeasurement?.total_area_sqft, roofrData.total_area_sqft) : null;
  const facetDiff = roofrData ? calculateDiff(internalMeasurement?.facet_count, roofrData.facet_count) : null;
  const eavesDiff = roofrData ? calculateDiff(internalMeasurement?.eaves_lf, roofrData.linears.eaves_lf) : null;
  const valleysDiff = roofrData ? calculateDiff(internalMeasurement?.valleys_lf, roofrData.linears.valleys_lf) : null;

  // Identify issues
  const issues: string[] = [];
  if (areaDiff && areaDiff.status === 'error') {
    if (areaDiff.pct > 0) issues.push('Potential screen enclosure included');
    else issues.push('Missing roof area');
  }
  if (valleysDiff && internalMeasurement?.valleys_lf === 0 && roofrData && roofrData.linears.valleys_lf > 0) {
    issues.push('Valleys not detected');
  }
  if (facetDiff && facetDiff.status === 'error') {
    issues.push('Facet count mismatch');
  }
  if (internalMeasurement?.predominant_pitch !== roofrData?.predominant_pitch && roofrData) {
    issues.push('Pitch mismatch');
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Roofr Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!roofrData ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Upload a Roofr PDF to compare measurements
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                disabled={isUploading}
                className="flex-1"
              />
              {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary badges */}
            <div className="flex flex-wrap gap-2">
              {issues.length === 0 ? (
                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Measurements Match
                </Badge>
              ) : (
                issues.map((issue, i) => (
                  <Badge key={i} variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {issue}
                  </Badge>
                ))
              )}
            </div>

            {/* Comparison table */}
            <div className="text-xs space-y-2">
              <div className="grid grid-cols-4 gap-2 font-medium border-b pb-2">
                <span>Metric</span>
                <span className="text-right">Internal</span>
                <span className="text-right">Roofr</span>
                <span className="text-right">Diff</span>
              </div>
              
              {/* Total Area */}
              <div className="grid grid-cols-4 gap-2 items-center">
                <span>Total Area</span>
                <span className="text-right">{internalMeasurement?.total_area_sqft?.toLocaleString() || '-'} sqft</span>
                <span className="text-right">{roofrData.total_area_sqft.toLocaleString()} sqft</span>
                <span className="text-right">{areaDiff && getDiffBadge(areaDiff.status, areaDiff.pct)}</span>
              </div>

              {/* Facets */}
              <div className="grid grid-cols-4 gap-2 items-center">
                <span>Facets</span>
                <span className="text-right">{internalMeasurement?.facet_count || '-'}</span>
                <span className="text-right">{roofrData.facet_count}</span>
                <span className="text-right">{facetDiff && getDiffBadge(facetDiff.status, facetDiff.pct)}</span>
              </div>

              {/* Pitch */}
              <div className="grid grid-cols-4 gap-2 items-center">
                <span>Pitch</span>
                <span className="text-right">{internalMeasurement?.predominant_pitch || '-'}</span>
                <span className="text-right">{roofrData.predominant_pitch}</span>
                <span className="text-right">
                  {internalMeasurement?.predominant_pitch === roofrData.predominant_pitch ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">✓</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30">≠</Badge>
                  )}
                </span>
              </div>

              {showDetails && (
                <>
                  {/* Eaves */}
                  <div className="grid grid-cols-4 gap-2 items-center">
                    <span>Eaves</span>
                    <span className="text-right">{internalMeasurement?.eaves_lf?.toFixed(0) || '-'} LF</span>
                    <span className="text-right">{roofrData.linears.eaves_lf.toFixed(0)} LF</span>
                    <span className="text-right">{eavesDiff && getDiffBadge(eavesDiff.status, eavesDiff.pct)}</span>
                  </div>

                  {/* Valleys */}
                  <div className="grid grid-cols-4 gap-2 items-center">
                    <span>Valleys</span>
                    <span className="text-right">{internalMeasurement?.valleys_lf?.toFixed(0) || '-'} LF</span>
                    <span className="text-right">{roofrData.linears.valleys_lf.toFixed(0)} LF</span>
                    <span className="text-right">{valleysDiff && getDiffBadge(valleysDiff.status, valleysDiff.pct)}</span>
                  </div>

                  {/* Hips */}
                  <div className="grid grid-cols-4 gap-2 items-center">
                    <span>Hips</span>
                    <span className="text-right">{internalMeasurement?.hips_lf?.toFixed(0) || '-'} LF</span>
                    <span className="text-right">{roofrData.linears.hips_lf.toFixed(0)} LF</span>
                    <span className="text-right">-</span>
                  </div>

                  {/* Ridges */}
                  <div className="grid grid-cols-4 gap-2 items-center">
                    <span>Ridges</span>
                    <span className="text-right">{internalMeasurement?.ridges_lf?.toFixed(0) || '-'} LF</span>
                    <span className="text-right">{roofrData.linears.ridges_lf.toFixed(0)} LF</span>
                    <span className="text-right">-</span>
                  </div>
                </>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(!showDetails)}
              className="w-full text-xs"
            >
              {showDetails ? 'Hide Details' : 'Show All Linears'}
            </Button>

            {/* Upload new */}
            <div className="pt-2 border-t">
              <label className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                <Input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="hidden"
                />
                <span className="flex items-center gap-1">
                  <Upload className="h-3 w-3" />
                  Upload new Roofr PDF
                </span>
              </label>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
