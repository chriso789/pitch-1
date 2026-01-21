import React, { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  FileUp, Loader2, CheckCircle, AlertCircle, MapPin, ArrowRight, X, Ruler, Trash2, RefreshCw 
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
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
  const [blockingRecord, setBlockingRecord] = useState<{
    id: string;
    created_at: string;
    lead_id: string;
    lead_name?: string;
    provider: string;
    address?: string;
    area?: number;
  } | null>(null);
  const [isDeletingBlocking, setIsDeletingBlocking] = useState(false);
  
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

      // Handle duplicate detection - try to re-save existing data to this lead
      if (data.duplicate && data.existing_report_id) {
        console.log('Duplicate detected, attempting to re-save existing report data...');
        
        // Fetch the existing report's parsed data
        const { data: existingReport, error: fetchReportErr } = await supabase
          .from('roof_vendor_reports')
          .select('id, parsed, provider, created_at, address, lead_id')
          .eq('id', data.existing_report_id)
          .single();

        if (fetchReportErr || !existingReport) {
          setImportError('Could not retrieve the original report data. Please try a different file.');
          return;
        }

        const existingParsed = existingReport.parsed as Record<string, any> | null;
        const existingArea = existingParsed?.total_area_sqft || 0;

        // Check if the original has valid data (area > 500 sqft is reasonable minimum)
        if (!existingParsed || existingArea < 500) {
          // Fetch the lead name for context
          let leadName = 'Unknown Lead';
          if (existingReport.lead_id) {
            const { data: blockingLead } = await supabase
              .from('pipeline_entries')
              .select('id, metadata')
              .eq('id', existingReport.lead_id)
              .maybeSingle();

            const leadMeta = blockingLead?.metadata as Record<string, any> | null;
            leadName = leadMeta?.name || leadMeta?.contact_name || 'Unknown Lead';
          }
          
          setBlockingRecord({
            id: existingReport.id,
            created_at: existingReport.created_at,
            lead_id: existingReport.lead_id || '',
            lead_name: leadName,
            provider: existingReport.provider,
            address: existingReport.address || undefined,
            area: existingArea,
          });

          setImportError(
            `This PDF was previously imported with extraction errors. You can delete the old record and try again.`
          );
          return;
        }

        // Check if already saved to measurement_approvals for THIS lead
        const { data: existingApproval } = await supabase
          .from('measurement_approvals')
          .select('id')
          .eq('pipeline_entry_id', pipelineEntryId)
          .limit(1);

        // Look for an approval with matching source from this provider
        const alreadySaved = existingApproval?.some(a => {
          // Check if any approval was from this same provider import
          return false; // Allow re-saving even if one exists - user can delete duplicates
        });

        // Re-save the existing parsed data to measurement_approvals for this lead
        toast({
          title: 'Report Found',
          description: `Found ${existingArea.toLocaleString()} sqft from previous import. Saving to this lead...`,
        });

        // Continue with the existing parsed data as if it were just parsed
        const parsed = existingParsed as ParsedMeasurements;
        
        // Proceed with auto-save logic using the existing data
        const { data: entry, error: fetchError } = await supabase
          .from('pipeline_entries')
          .select('metadata, tenant_id')
          .eq('id', pipelineEntryId)
          .single();

        if (fetchError) throw fetchError;

        const existingMetadata = (entry?.metadata as Record<string, any>) || {};
        const tenantId = entry?.tenant_id;

        if (!tenantId) throw new Error('No tenant_id found for this lead');

        const totalSquares = parsed.total_area_sqft ? parsed.total_area_sqft / 100 : 0;
        
        const savedTags = {
          'roof.plan_area': parsed.total_area_sqft || 0,
          'roof.total_sqft': parsed.total_area_sqft || 0,
          'roof.squares': totalSquares,
          'roof.predominant_pitch': parsed.predominant_pitch || '6/12',
          'roof.faces_count': parsed.facet_count || 0,
          'lf.ridge': parsed.ridges_ft || 0,
          'lf.hip': parsed.hips_ft || 0,
          'lf.valley': parsed.valleys_ft || 0,
          'lf.rake': parsed.rakes_ft || 0,
          'lf.eave': parsed.eaves_ft || 0,
          'lf.ridge_hip_total': (parsed.ridges_ft || 0) + (parsed.hips_ft || 0),
          'source': `imported_${existingReport.provider || parsed.provider}`,
          'imported_at': new Date().toISOString(),
          'original_report_id': existingReport.id,
        };

        const { data: newApproval, error: approvalError } = await supabase
          .from('measurement_approvals')
          .insert({
            tenant_id: tenantId,
            pipeline_entry_id: pipelineEntryId,
            approved_at: new Date().toISOString(),
            saved_tags: savedTags,
            approval_notes: `Re-saved from ${existingReport.provider || 'unknown'} - ${parsed.total_area_sqft?.toLocaleString() || 0} sqft`,
          })
          .select('id')
          .single();

        if (approvalError) {
          console.error('Approval save error:', approvalError);
          throw new Error('Failed to save measurement');
        }

        // Set as active measurement
        await supabase
          .from('pipeline_entries')
          .update({
            metadata: {
              ...existingMetadata,
              selected_measurement_approval_id: newApproval.id,
              comprehensive_measurements: {
                ...existingMetadata.comprehensive_measurements,
                roof_area_sq_ft: parsed.total_area_sqft,
                total_area_sqft: parsed.total_area_sqft,
                predominant_pitch: parsed.predominant_pitch,
                ridges_lf: parsed.ridges_ft,
                hips_lf: parsed.hips_ft,
                valleys_lf: parsed.valleys_ft,
                source: `imported_${existingReport.provider}`,
                imported_at: new Date().toISOString(),
                roof_squares: totalSquares,
              },
              imported_report_provider: existingReport.provider,
            },
          })
          .eq('id', pipelineEntryId);

        toast({
          title: 'Measurement Saved',
          description: `${existingReport.provider || 'Report'} data saved - ${totalSquares.toFixed(1)} squares ready for estimates`,
        });

        queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
        queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
        
        setIsOpen(false);
        setImportFile(null);
        setImportParsedData(null);
        setImportError(null);
        
        onSuccess?.();
        return;
      }

      const parsed = data.parsed as ParsedMeasurements;
      
      if (!parsed) {
        throw new Error('No measurement data extracted from report');
      }

      // AUTO-SAVE: Immediately save to measurement_approvals
      const { data: entry, error: fetchError } = await supabase
        .from('pipeline_entries')
        .select('metadata, tenant_id')
        .eq('id', pipelineEntryId)
        .single();

      if (fetchError) throw fetchError;

      const existingMetadata = (entry?.metadata as Record<string, any>) || {};
      const tenantId = entry?.tenant_id;

      if (!tenantId) throw new Error('No tenant_id found for this lead');

      const totalSquares = parsed.total_area_sqft ? parsed.total_area_sqft / 100 : 0;
      
      // Create saved_tags for estimate template integration
      const savedTags = {
        'roof.plan_area': parsed.total_area_sqft || 0,
        'roof.total_sqft': parsed.total_area_sqft || 0,
        'roof.squares': totalSquares,
        'roof.predominant_pitch': parsed.predominant_pitch || '6/12',
        'roof.faces_count': parsed.facet_count || 0,
        'lf.ridge': parsed.ridges_ft || 0,
        'lf.hip': parsed.hips_ft || 0,
        'lf.valley': parsed.valleys_ft || 0,
        'lf.rake': parsed.rakes_ft || 0,
        'lf.eave': parsed.eaves_ft || 0,
        'lf.ridge_hip_total': (parsed.ridges_ft || 0) + (parsed.hips_ft || 0),
        'source': `imported_${parsed.provider}`,
        'imported_at': new Date().toISOString(),
      };

      // Create measurement_approvals entry
      const { data: newApproval, error: approvalError } = await supabase
        .from('measurement_approvals')
        .insert({
          tenant_id: tenantId,
          pipeline_entry_id: pipelineEntryId,
          approved_at: new Date().toISOString(),
          saved_tags: savedTags,
          approval_notes: `Auto-saved from ${parsed.provider} - ${parsed.total_area_sqft?.toLocaleString() || 0} sqft`,
        })
        .select('id')
        .single();

      if (approvalError) {
        console.error('Approval save error:', approvalError);
        throw new Error('Failed to save measurement');
      }

      // Set as active measurement automatically
      await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            ...existingMetadata,
            selected_measurement_approval_id: newApproval.id,
            comprehensive_measurements: {
              ...existingMetadata.comprehensive_measurements,
              roof_area_sq_ft: parsed.total_area_sqft,
              total_area_sqft: parsed.total_area_sqft,
              pitched_area_sqft: parsed.pitched_area_sqft,
              predominant_pitch: parsed.predominant_pitch,
              facet_count: parsed.facet_count,
              ridges_lf: parsed.ridges_ft,
              hips_lf: parsed.hips_ft,
              valleys_lf: parsed.valleys_ft,
              rakes_lf: parsed.rakes_ft,
              eaves_lf: parsed.eaves_ft,
              drip_edge_lf: parsed.drip_edge_ft,
              waste_table: parsed.waste_table,
              source: `imported_${parsed.provider}`,
              imported_at: new Date().toISOString(),
              roof_squares: totalSquares,
              total_squares: totalSquares,
            },
            imported_report_provider: parsed.provider,
            imported_report_address: parsed.address,
          },
        })
        .eq('id', pipelineEntryId);

      toast({
        title: 'Measurement Saved',
        description: `${parsed.provider} report saved - ${totalSquares.toFixed(1)} squares ready for estimates`,
      });

      // Refresh and close
      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      
      setIsOpen(false);
      setImportFile(null);
      setImportParsedData(null);
      setImportError(null);
      
      onSuccess?.();
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
  }, [importFile, pipelineEntryId, queryClient, toast, onSuccess]);

  // Handle deleting a blocking record and retrying the import
  const handleDeleteBlockingRecord = useCallback(async () => {
    if (!blockingRecord || !importFile) return;
    
    setIsDeletingBlocking(true);
    try {
      const { error: deleteError } = await supabase
        .from('roof_vendor_reports')
        .delete()
        .eq('id', blockingRecord.id);

      if (deleteError) {
        throw new Error('Failed to delete the blocking record');
      }

      toast({
        title: 'Record Deleted',
        description: 'Re-analyzing the report...',
      });

      setBlockingRecord(null);
      setImportError(null);

      // Re-trigger the upload/analysis
      await handleUploadAndAnalyze();
    } catch (err) {
      console.error('Delete blocking record error:', err);
      toast({
        title: 'Delete Failed',
        description: err instanceof Error ? err.message : 'Could not delete the blocking record.',
        variant: 'destructive',
      });
    } finally {
      setIsDeletingBlocking(false);
    }
  }, [blockingRecord, importFile, toast, handleUploadAndAnalyze]);

  const handleApplyImportedMeasurements = useCallback(async () => {
    if (!importParsedData) return;

    try {
      const { data: entry, error: fetchError } = await supabase
        .from('pipeline_entries')
        .select('metadata, tenant_id')
        .eq('id', pipelineEntryId)
        .single();

      if (fetchError) throw fetchError;

      const existingMetadata = (entry?.metadata as Record<string, any>) || {};
      const tenantId = entry?.tenant_id;

      if (!tenantId) throw new Error('No tenant_id found for this lead');

      const totalSquares = importParsedData.total_area_sqft ? importParsedData.total_area_sqft / 100 : 0;
      
      // 1. Save to measurement_approvals (primary storage for template integration)
      console.log('Saving imported report to measurement_approvals...');

      // 2. Create saved_tags for estimate template integration
      const savedTags = {
        'roof.plan_area': importParsedData.total_area_sqft || 0,
        'roof.total_sqft': importParsedData.total_area_sqft || 0,
        'roof.squares': totalSquares,
        'roof.predominant_pitch': importParsedData.predominant_pitch || '6/12',
        'roof.faces_count': importParsedData.facet_count || 0,
        'lf.ridge': importParsedData.ridges_ft || 0,
        'lf.hip': importParsedData.hips_ft || 0,
        'lf.valley': importParsedData.valleys_ft || 0,
        'lf.rake': importParsedData.rakes_ft || 0,
        'lf.eave': importParsedData.eaves_ft || 0,
        'lf.ridge_hip_total': (importParsedData.ridges_ft || 0) + (importParsedData.hips_ft || 0),
        'source': `imported_${importParsedData.provider}`,
        'imported_at': new Date().toISOString(),
      };

      // 3. Create measurement_approvals entry
      const { error: approvalError } = await supabase
        .from('measurement_approvals')
        .insert({
          tenant_id: tenantId,
          pipeline_entry_id: pipelineEntryId,
          approved_at: new Date().toISOString(),
          saved_tags: savedTags,
          approval_notes: `Imported from ${importParsedData.provider} report - ${importParsedData.total_area_sqft?.toLocaleString() || 0} sqft`,
        });

      if (approvalError) {
        console.error('Approval save error:', approvalError);
        throw new Error('Failed to save measurement approval');
      }

      // 4. Also update pipeline entry metadata for backward compatibility
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
      };

      await supabase
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

      toast({
        title: 'Measurements Saved',
        description: `${importParsedData.provider} report saved permanently - ${totalSquares.toFixed(1)} squares available for estimates`,
      });

      // Reset state and close popover
      setIsOpen(false);
      setImportFile(null);
      setImportParsedData(null);
      setImportError(null);
      
      // Refresh measurement context and approvals
      queryClient.invalidateQueries({ queryKey: ['measurement-context', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', pipelineEntryId] });
      
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
    setBlockingRecord(null);
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

              {blockingRecord && (
                <Alert variant="destructive" className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Blocking Record Found</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p className="text-xs">
                      This PDF was imported on {new Date(blockingRecord.created_at).toLocaleDateString()} but failed to extract data correctly.
                    </p>
                    <div className="text-xs bg-destructive/10 p-2 rounded space-y-0.5">
                      {blockingRecord.lead_name && (
                        <div><strong>Lead:</strong> {blockingRecord.lead_name}</div>
                      )}
                      <div><strong>Provider:</strong> {blockingRecord.provider} (misparsed)</div>
                      {blockingRecord.area !== undefined && (
                        <div><strong>Extracted:</strong> {blockingRecord.area.toLocaleString()} sqft (invalid)</div>
                      )}
                      {blockingRecord.address && (
                        <div><strong>Address:</strong> {blockingRecord.address}</div>
                      )}
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="w-full mt-2"
                      onClick={handleDeleteBlockingRecord}
                      disabled={isDeletingBlocking}
                    >
                      {isDeletingBlocking ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-1" />
                      )}
                      Delete & Retry Analysis
                    </Button>
                  </AlertDescription>
                </Alert>
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
                <CheckCircle className="h-5 w-5 text-success" />
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
