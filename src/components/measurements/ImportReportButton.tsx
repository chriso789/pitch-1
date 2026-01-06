import React, { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  FileUp, Loader2, CheckCircle, AlertCircle, MapPin, ArrowRight, X, Ruler 
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

interface ParsedMeasurements {
  provider: string;
  address?: string | null;
  total_area_sqft?: number | null;
  pitched_area_sqft?: number | null;
  facet_count?: number | null;
  predominant_pitch?: string | null;
  ridges_ft?: number | null;
  hips_ft?: number | null;
  valleys_ft?: number | null;
  rakes_ft?: number | null;
  eaves_ft?: number | null;
  drip_edge_ft?: number | null;
  waste_table?: Array<{
    waste_pct: number;
    area_sqft: number | null;
    squares: number | null;
  }> | null;
}

interface ImportReportButtonProps {
  pipelineEntryId: string;
  onSuccess?: () => void;
}

export const ImportReportButton: React.FC<ImportReportButtonProps> = ({
  pipelineEntryId,
  onSuccess,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importUploading, setImportUploading] = useState(false);
  const [importAnalyzing, setImportAnalyzing] = useState(false);
  const [importParsedData, setImportParsedData] = useState<ParsedMeasurements | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const formatNumber = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return '—';
    return val.toLocaleString();
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'application/pdf') {
        setImportError('Please upload a PDF file');
        return;
      }
      setImportFile(selectedFile);
      setImportError(null);
      setImportParsedData(null);
    }
  };

  const handleUploadAndAnalyze = useCallback(async () => {
    if (!importFile) return;

    setImportUploading(true);
    setImportAnalyzing(false);
    setImportError(null);

    try {
      const arrayBuffer = await importFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      setImportUploading(false);
      setImportAnalyzing(true);

      const { data, error: fnError } = await supabase.functions.invoke('roof-report-ingest', {
        body: {
          base64_pdf: base64,
          lead_id: pipelineEntryId,
        },
      });

      if (fnError) throw new Error(fnError.message || 'Failed to analyze report');
      if (!data?.ok) throw new Error(data?.message || 'Analysis failed');

      setImportParsedData(data.parsed as ParsedMeasurements);
      
      toast({
        title: 'Report Analyzed',
        description: `Detected ${data.provider} report with ${data.parsed?.total_area_sqft?.toLocaleString() || 0} sqft`,
      });
    } catch (err) {
      console.error('Import error:', err);
      setImportError(err instanceof Error ? err.message : 'Failed to process report');
      toast({
        title: 'Analysis Failed',
        description: err instanceof Error ? err.message : 'Could not analyze the report',
        variant: 'destructive',
      });
    } finally {
      setImportUploading(false);
      setImportAnalyzing(false);
    }
  }, [importFile, pipelineEntryId, toast]);

  const handleApplyImportedMeasurements = useCallback(async () => {
    if (!importParsedData) return;

    try {
      const { data: entry, error: fetchError } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      if (fetchError) throw fetchError;

      const existingMetadata = (entry?.metadata as Record<string, any>) || {};

      const totalSquares = importParsedData.total_area_sqft ? importParsedData.total_area_sqft / 100 : 0;
      
      const comprehensiveMeasurements = {
        ...existingMetadata.comprehensive_measurements,
        roof_area_sq_ft: importParsedData.total_area_sqft,
        total_area_sqft: importParsedData.total_area_sqft,
        pitched_area_sqft: importParsedData.pitched_area_sqft,
        predominant_pitch: importParsedData.predominant_pitch,
        facet_count: importParsedData.facet_count,
        ridges_lf: importParsedData.ridges_ft,
        hips_lf: importParsedData.hips_ft,
        valleys_lf: importParsedData.valleys_ft,
        rakes_lf: importParsedData.rakes_ft,
        eaves_lf: importParsedData.eaves_ft,
        drip_edge_lf: importParsedData.drip_edge_ft,
        waste_table: importParsedData.waste_table,
        source: `imported_${importParsedData.provider}`,
        imported_at: new Date().toISOString(),
        roof_squares: totalSquares,
        total_squares: totalSquares,
        eave_length: importParsedData.eaves_ft || 0,
        rake_length: importParsedData.rakes_ft || 0,
        ridge_length: importParsedData.ridges_ft || 0,
        hip_length: importParsedData.hips_ft || 0,
        valley_length: importParsedData.valleys_ft || 0,
        step_flashing_length: 0,
        penetration_count: 3,
        waste_factor_percent: 10,
      };

      const { error: updateError } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            ...existingMetadata,
            comprehensive_measurements: comprehensiveMeasurements,
            imported_report_provider: importParsedData.provider,
            imported_report_address: importParsedData.address,
          },
        })
        .eq('id', pipelineEntryId);

      if (updateError) throw updateError;

      toast({
        title: 'Measurements Applied',
        description: 'The imported measurements have been saved',
      });

      // Reset state and close popover
      setIsOpen(false);
      setImportFile(null);
      setImportParsedData(null);
      setImportError(null);
      
      // Refresh measurement context
      queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      
      onSuccess?.();
    } catch (err) {
      console.error('Apply error:', err);
      toast({
        title: 'Failed to Apply',
        description: err instanceof Error ? err.message : 'Could not save measurements',
        variant: 'destructive',
      });
    }
  }, [importParsedData, pipelineEntryId, queryClient, toast, onSuccess]);

  const handleCancel = () => {
    setIsOpen(false);
    setImportFile(null);
    setImportParsedData(null);
    setImportError(null);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <FileUp className="h-4 w-4 mr-2" />
          Import Report
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Import Measurement Report</h4>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {!importParsedData ? (
            <div className="space-y-3">
              <Label htmlFor="report-file">Report PDF</Label>
              <Input
                id="report-file"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleImportFileChange}
                disabled={importUploading || importAnalyzing}
              />
              <p className="text-xs text-muted-foreground">
                Supported: EagleView, Roofr, Hover reports
              </p>
              
              {importError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {importError}
                </div>
              )}

              {importFile && !importParsedData && (
                <Button 
                  onClick={handleUploadAndAnalyze} 
                  disabled={importUploading || importAnalyzing}
                  className="w-full"
                >
                  {(importUploading || importAnalyzing) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {importUploading ? 'Uploading...' : importAnalyzing ? 'Analyzing...' : 'Analyze Report'}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="font-medium">Report Analyzed</span>
                <Badge variant="outline" className="ml-auto capitalize">
                  {importParsedData.provider}
                </Badge>
              </div>

              {importParsedData.address && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <span>{importParsedData.address}</span>
                </div>
              )}

              <Separator />

              <div className="bg-muted/50 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Area</span>
                    <span className="font-medium">{formatNumber(importParsedData.total_area_sqft)} sqft</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Squares</span>
                    <span className="font-medium">
                      {importParsedData.total_area_sqft ? (importParsedData.total_area_sqft / 100).toFixed(1) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pitch</span>
                    <span className="font-medium">{importParsedData.predominant_pitch || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Facets</span>
                    <span className="font-medium">{formatNumber(importParsedData.facet_count)}</span>
                  </div>
                </div>

                <Separator className="my-2" />

                <div className="space-y-1 text-sm">
                  <div className="font-medium flex items-center gap-2">
                    <Ruler className="h-3 w-3" />
                    Linear Features
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ridge</span>
                      <span>{formatNumber(importParsedData.ridges_ft)} ft</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Hip</span>
                      <span>{formatNumber(importParsedData.hips_ft)} ft</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Valley</span>
                      <span>{formatNumber(importParsedData.valleys_ft)} ft</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Eave</span>
                      <span>{formatNumber(importParsedData.eaves_ft)} ft</span>
                    </div>
                  </div>
                </div>
              </div>

              <Button onClick={handleApplyImportedMeasurements} className="w-full">
                Apply to Estimate
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
