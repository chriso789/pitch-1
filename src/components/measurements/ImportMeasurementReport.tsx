// Import & Analyze Measurement Report component
import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { 
  FileUp, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  MapPin,
  Ruler,
  ArrowRight
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ParsedMeasurements {
  provider: string;
  address?: string | null;
  total_area_sqft?: number | null;
  pitched_area_sqft?: number | null;
  flat_area_sqft?: number | null;
  facet_count?: number | null;
  predominant_pitch?: string | null;
  ridges_ft?: number | null;
  hips_ft?: number | null;
  valleys_ft?: number | null;
  rakes_ft?: number | null;
  eaves_ft?: number | null;
  drip_edge_ft?: number | null;
  perimeter_ft?: number | null;
  step_flashing_ft?: number | null;
  squares?: number | null;
  hip_ridge_cap_lf?: number | null;
  waste_table?: Array<{
    waste_pct: number;
    area_sqft: number | null;
    squares: number | null;
  }> | null;
}

interface ImportMeasurementReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineEntryId: string;
  onMeasurementsApplied?: (measurements: ParsedMeasurements) => void;
}

export function ImportMeasurementReport({
  open,
  onOpenChange,
  pipelineEntryId,
  onMeasurementsApplied,
}: ImportMeasurementReportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedMeasurements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const ACCEPTED_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/heic',
    'image/heif'
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Also accept files with no type (common for HEIC on some systems)
      const isAcceptedType = ACCEPTED_TYPES.includes(selectedFile.type) || 
        selectedFile.name.toLowerCase().endsWith('.heic') ||
        selectedFile.name.toLowerCase().endsWith('.heif');
        
      if (!isAcceptedType) {
        setError('Please upload a PDF or image file (JPG, PNG, HEIC)');
        return;
      }
      setFile(selectedFile);
      setError(null);
      setParsedData(null);
    }
  };

  const handleUploadAndAnalyze = useCallback(async () => {
    if (!file) return;

    setUploading(true);
    setAnalyzing(false);
    setError(null);

    try {
      // Convert file to base64
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      setUploading(false);
      setAnalyzing(true);

      // Determine if this is an image file
      const isImage = file.type.startsWith('image/') || 
        file.name.toLowerCase().endsWith('.heic') ||
        file.name.toLowerCase().endsWith('.heif');
      const mimeType = file.type || (file.name.toLowerCase().endsWith('.heic') ? 'image/heic' : 'application/pdf');

      // Call the roof-report-ingest edge function
      const { data, error: fnError } = await supabase.functions.invoke('roof-report-ingest', {
        body: {
          base64_pdf: isImage ? undefined : base64,
          base64_image: isImage ? base64 : undefined,
          file_type: isImage ? 'image' : 'pdf',
          mime_type: mimeType,
          lead_id: pipelineEntryId,
        },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to analyze report');
      }

      if (!data?.ok) {
        throw new Error(data?.message || 'Analysis failed');
      }

      // Handle duplicate report - fetch original parsed data from database
      if (data.duplicate && data.existing_report_id) {
        const { data: existingReport } = await supabase
          .from('roof_vendor_reports')
          .select('parsed, provider, address')
          .eq('id', data.existing_report_id)
          .single();

        if (existingReport?.parsed) {
          const existingParsed = existingReport.parsed as unknown as ParsedMeasurements;
          setParsedData(existingParsed);
          toast({
            title: 'Report Already Imported',
            description: `This ${existingReport.provider || data.provider} report was previously imported with ${existingParsed.total_area_sqft?.toLocaleString() || 0} sqft. You can still apply these measurements.`,
          });
          return;
        }
      }

      setParsedData(data.parsed as ParsedMeasurements);
      
      toast({
        title: 'Report Analyzed',
        description: `Detected ${data.provider} report with ${data.parsed?.total_area_sqft?.toLocaleString() || 0} sqft`,
      });
    } catch (err) {
      console.error('Import error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process report');
      toast({
        title: 'Analysis Failed',
        description: err instanceof Error ? err.message : 'Could not analyze the report',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      setAnalyzing(false);
    }
  }, [file, pipelineEntryId, toast]);

  const handleApplyMeasurements = useCallback(async () => {
    if (!parsedData) return;

    try {
      // Get existing metadata and tenant_id
      const { data: entry, error: fetchError } = await supabase
        .from('pipeline_entries')
        .select('metadata, tenant_id')
        .eq('id', pipelineEntryId)
        .single();

      if (fetchError) throw fetchError;

      const existingMetadata = (entry?.metadata as Record<string, any>) || {};
      const tenantId = entry?.tenant_id;

      if (!tenantId) throw new Error('No tenant_id found for this lead');

      const totalSquares = parsedData.squares || (parsedData.total_area_sqft ? parsedData.total_area_sqft / 100 : 0);

      // 1. Save to external_measurement_reports table (permanent storage)
      // Note: Skipping external_measurement_reports due to type constraints
      // The measurement_approvals table is the primary storage for template integration
      console.log('Saving imported report to measurement_approvals...');

      // 2. Create saved_tags for estimate template integration
      const savedTags = {
        'roof.plan_area': parsedData.total_area_sqft || 0,
        'roof.total_sqft': parsedData.total_area_sqft || 0,
        'roof.squares': totalSquares,
        'roof.predominant_pitch': parsedData.predominant_pitch || '6/12',
        'roof.faces_count': parsedData.facet_count || 0,
        'lf.ridge': parsedData.ridges_ft || 0,
        'lf.hip': parsedData.hips_ft || 0,
        'lf.valley': parsedData.valleys_ft || 0,
        'lf.rake': parsedData.rakes_ft || 0,
        'lf.eave': parsedData.eaves_ft || 0,
        'lf.drip_edge': parsedData.drip_edge_ft || 0,
        'lf.perimeter': parsedData.perimeter_ft || 0,
        'lf.step_flashing': parsedData.step_flashing_ft || 0,
        'lf.ridge_hip_total': (parsedData.ridges_ft || 0) + (parsedData.hips_ft || 0),
        // Xactimate-specific
        'xactimate.squares': parsedData.squares || totalSquares,
        'xactimate.hip_ridge_cap_lf': parsedData.hip_ridge_cap_lf || 0,
        // Source tracking
        'source': `imported_${parsedData.provider}`,
        'imported_at': new Date().toISOString(),
      };

      // 3. Create measurement_approvals entry (enables template integration)
      const { error: approvalError } = await supabase
        .from('measurement_approvals')
        .insert({
          tenant_id: tenantId,
          pipeline_entry_id: pipelineEntryId,
          approved_at: new Date().toISOString(),
          saved_tags: savedTags,
          approval_notes: `Imported from ${parsedData.provider} report - ${parsedData.total_area_sqft?.toLocaleString() || 0} sqft, ${totalSquares.toFixed(1)} squares`,
        });

      if (approvalError) {
        console.error('Approval save error:', approvalError);
        throw new Error('Failed to save measurement approval');
      }

      // 4. Also update pipeline entry metadata for backward compatibility
      const comprehensiveMeasurements = {
        ...existingMetadata.comprehensive_measurements,
        roof_area_sq_ft: parsedData.total_area_sqft,
        total_area_sqft: parsedData.total_area_sqft,
        pitched_area_sqft: parsedData.pitched_area_sqft,
        flat_area_sqft: parsedData.flat_area_sqft,
        predominant_pitch: parsedData.predominant_pitch,
        facet_count: parsedData.facet_count,
        ridges_lf: parsedData.ridges_ft,
        hips_lf: parsedData.hips_ft,
        valleys_lf: parsedData.valleys_ft,
        rakes_lf: parsedData.rakes_ft,
        eaves_lf: parsedData.eaves_ft,
        drip_edge_lf: parsedData.drip_edge_ft,
        perimeter_ft: parsedData.perimeter_ft,
        step_flashing_lf: parsedData.step_flashing_ft,
        waste_table: parsedData.waste_table,
        squares: parsedData.squares || totalSquares,
        hip_ridge_cap_lf: parsedData.hip_ridge_cap_lf,
        source: `imported_${parsedData.provider}`,
        imported_at: new Date().toISOString(),
      };

      await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            ...existingMetadata,
            comprehensive_measurements: comprehensiveMeasurements,
            imported_report_provider: parsedData.provider,
            imported_report_address: parsedData.address,
          },
        })
        .eq('id', pipelineEntryId);

      toast({
        title: 'Measurements Saved',
        description: `${parsedData.provider} report saved permanently - ${totalSquares.toFixed(1)} squares available for estimates`,
      });

      onMeasurementsApplied?.(parsedData);
      onOpenChange(false);
      
      // Reset state
      setFile(null);
      setParsedData(null);
    } catch (err) {
      console.error('Apply error:', err);
      toast({
        title: 'Failed to Apply',
        description: err instanceof Error ? err.message : 'Could not save measurements',
        variant: 'destructive',
      });
    }
  }, [parsedData, pipelineEntryId, onMeasurementsApplied, onOpenChange, toast]);

  const handleClose = () => {
    setFile(null);
    setParsedData(null);
    setError(null);
    onOpenChange(false);
  };

  const formatNumber = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return '—';
    return val.toLocaleString();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            Import Measurement Report
          </DialogTitle>
          <DialogDescription>
            Upload an EagleView, Roofr, Xactimate, or other measurement report (PDF) to extract measurements.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Upload */}
          {!parsedData && (
            <div className="space-y-3">
              <Label htmlFor="report-file">Report File</Label>
              <Input
                id="report-file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic"
                onChange={handleFileChange}
                disabled={uploading || analyzing}
              />
              <p className="text-xs text-muted-foreground">
                Supported: PDF reports or screenshots (JPG, PNG, HEIC)
              </p>
              
              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              {file && !parsedData && (
                <Button 
                  onClick={handleUploadAndAnalyze} 
                  disabled={uploading || analyzing}
                  className="w-full"
                >
                  {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {analyzing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {uploading ? 'Uploading...' : analyzing ? 'Analyzing...' : 'Analyze Report'}
                </Button>
              )}
            </div>
          )}

          {/* Parsed Results Preview */}
          {parsedData && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="font-medium">Report Analyzed</span>
                <Badge variant="outline" className="ml-auto capitalize">
                  {parsedData.provider}
                </Badge>
              </div>

              {parsedData.address && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <span>{parsedData.address}</span>
                </div>
              )}

              <Separator />

              <Card>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Area</span>
                      <span className="font-medium">{formatNumber(parsedData.total_area_sqft)} sqft</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Squares</span>
                      <span className="font-medium">
                        {parsedData.total_area_sqft ? (parsedData.total_area_sqft / 100).toFixed(1) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pitch</span>
                      <span className="font-medium">{parsedData.predominant_pitch || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Facets</span>
                      <span className="font-medium">{formatNumber(parsedData.facet_count)}</span>
                    </div>
                  </div>

                  <Separator className="my-3" />

                  <div className="space-y-2 text-sm">
                    <div className="font-medium flex items-center gap-2">
                      <Ruler className="h-4 w-4" />
                      Linear Features
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Ridge</span>
                        <span>{formatNumber(parsedData.ridges_ft)} ft</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Hip</span>
                        <span>{formatNumber(parsedData.hips_ft)} ft</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Valley</span>
                        <span>{formatNumber(parsedData.valleys_ft)} ft</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Eave</span>
                        <span>{formatNumber(parsedData.eaves_ft)} ft</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Rake</span>
                        <span>{formatNumber(parsedData.rakes_ft)} ft</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {parsedData && (
            <Button onClick={handleApplyMeasurements}>
              Apply to Estimate
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
