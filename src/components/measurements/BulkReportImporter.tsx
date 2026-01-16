import React, { useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle2, XCircle, Loader2, AlertCircle, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface ImportResult {
  fileName: string;
  status: 'pending' | 'processing' | 'success' | 'error' | 'geocoding';
  provider?: string;
  address?: string;
  totalArea?: number;
  error?: string;
  geocoded?: boolean;
  lat?: number;
  lng?: number;
  trainingSessionCreated?: boolean;
}

interface BulkReportImporterProps {
  onComplete?: (results: ImportResult[]) => void;
}

export function BulkReportImporter({ onComplete }: BulkReportImporterProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    setFiles(prev => [...prev, ...droppedFiles]);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).filter(
        f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      setFiles(prev => [...prev, ...selectedFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number; zipCode?: string } | null> => {
    if (!address) return null;
    
    try {
      // Use Google Maps Geocoding via our proxy
      const { data, error } = await supabase.functions.invoke('google-address-validation', {
        body: { address }
      });
      
      if (error || !data?.result?.geocode?.location) {
        console.warn('Geocoding failed for address:', address);
        return null;
      }
      
      const location = data.result.geocode.location;
      const zipCode = data.result.address?.postalAddress?.postalCode;
      
      return {
        lat: location.latitude,
        lng: location.longitude,
        zipCode
      };
    } catch (err) {
      console.error('Geocoding error:', err);
      return null;
    }
  };

  const createTrainingSession = async (
    reportId: string,
    parsed: any,
    geocode: { lat: number; lng: number; zipCode?: string }
  ): Promise<boolean> => {
    try {
      // Get current user's tenant
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();
      
      if (!profile?.tenant_id) return false;

      // Create training session with vendor report as ground truth
      const { error: sessionError } = await supabase
        .from('roof_training_sessions')
        .insert({
          tenant_id: profile.tenant_id,
          name: `Vendor Import: ${parsed.address || 'Unknown Address'}`,
          status: 'vendor_verified',
          ground_truth_source: 'vendor_report',
          vendor_report_id: reportId,
          confidence_weight: 3.0, // Vendor reports = 3x weight
          lat: geocode.lat,
          lng: geocode.lng,
          property_address: parsed.address,
          traced_totals: {
            ridge: parsed.ridges_ft || 0,
            ridge_ft: parsed.ridges_ft || 0,
            hip: parsed.hips_ft || 0,
            hip_ft: parsed.hips_ft || 0,
            valley: parsed.valleys_ft || 0,
            valley_ft: parsed.valleys_ft || 0,
            eave: parsed.eaves_ft || 0,
            eave_ft: parsed.eaves_ft || 0,
            rake: parsed.rakes_ft || 0,
            rake_ft: parsed.rakes_ft || 0,
            total_area_sqft: parsed.total_area_sqft || 0,
            perimeter_ft: parsed.perimeter_ft || 0,
          },
          description: `Auto-created from ${parsed.provider || 'vendor'} report import. Ground truth source for AI training.`,
          created_by: user.id,
        });
      
      if (sessionError) {
        console.error('Failed to create training session:', sessionError);
        return false;
      }
      
      return true;
    } catch (err) {
      console.error('Error creating training session:', err);
      return false;
    }
  };

  const processFile = async (file: File, index: number): Promise<ImportResult> => {
    const result: ImportResult = {
      fileName: file.name,
      status: 'processing',
    };

    try {
      // Convert file to base64
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        for (let j = 0; j < chunk.length; j++) {
          binary += String.fromCharCode(chunk[j]);
        }
      }
      const base64 = btoa(binary);

      // Call roof-report-ingest
      const { data, error } = await supabase.functions.invoke('roof-report-ingest', {
        body: { base64_pdf: base64 }
      });

      if (error) {
        result.status = 'error';
        result.error = error.message;
        return result;
      }

      result.provider = data.provider;
      result.address = data.parsed?.address;
      result.totalArea = data.parsed?.total_area_sqft;

      // Update status to geocoding
      result.status = 'geocoding';
      setResults(prev => {
        const updated = [...prev];
        updated[index] = { ...result };
        return updated;
      });

      // Geocode the address if present
      if (result.address) {
        const geocode = await geocodeAddress(result.address);
        if (geocode) {
          result.geocoded = true;
          result.lat = geocode.lat;
          result.lng = geocode.lng;

          // Update roof_measurements_truth with geocode data
          if (data.report_row?.id) {
            await supabase
              .from('roof_measurements_truth')
              .update({
                latitude: geocode.lat,
                longitude: geocode.lng,
                geocoded_at: new Date().toISOString(),
                geocoding_status: 'success',
                zip_code: geocode.zipCode,
              })
              .eq('report_id', data.report_row.id);

            // Create training session
            const sessionCreated = await createTrainingSession(
              data.report_row.id,
              data.parsed,
              geocode
            );
            result.trainingSessionCreated = sessionCreated;
          }
        } else {
          result.geocoded = false;
        }
      }

      result.status = 'success';
      return result;
    } catch (err) {
      result.status = 'error';
      result.error = err instanceof Error ? err.message : 'Unknown error';
      return result;
    }
  };

  const processAllFiles = async () => {
    if (files.length === 0) return;

    setIsProcessing(true);
    setProgress(0);
    
    // Initialize results
    const initialResults: ImportResult[] = files.map(f => ({
      fileName: f.name,
      status: 'pending',
    }));
    setResults(initialResults);

    const processedResults: ImportResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Update to processing
      setResults(prev => {
        const updated = [...prev];
        updated[i] = { ...updated[i], status: 'processing' };
        return updated;
      });

      const result = await processFile(file, i);
      processedResults.push(result);

      // Update result
      setResults(prev => {
        const updated = [...prev];
        updated[i] = result;
        return updated;
      });

      // Update progress
      setProgress(((i + 1) / files.length) * 100);

      // Small delay to prevent rate limiting
      if (i < files.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setIsProcessing(false);
    
    const successCount = processedResults.filter(r => r.status === 'success').length;
    const geocodedCount = processedResults.filter(r => r.geocoded).length;
    const trainingCount = processedResults.filter(r => r.trainingSessionCreated).length;
    
    toast({
      title: 'Import Complete',
      description: `Processed ${successCount}/${files.length} reports. ${geocodedCount} geocoded, ${trainingCount} training sessions created.`,
    });

    onComplete?.(processedResults);
  };

  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  const geocodedCount = results.filter(r => r.geocoded).length;
  const trainingCount = results.filter(r => r.trainingSessionCreated).length;

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
          Bulk Import Reports
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Bulk Import Professional Reports</DialogTitle>
          <DialogDescription>
            Upload multiple EagleView, Roofr, Hover, or other professional measurement reports.
            The system will extract measurements, geocode addresses, and create training sessions automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => document.getElementById('bulk-file-input')?.click()}
          >
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Drop PDF reports here</p>
            <p className="text-sm text-muted-foreground mt-1">
              or click to select files (supports multiple)
            </p>
            <input
              id="bulk-file-input"
              type="file"
              accept=".pdf,application/pdf"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* File List */}
          {files.length > 0 && !isProcessing && results.length === 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">Selected Files ({files.length})</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm truncate max-w-[300px]">{file.name}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Progress & Results */}
          {(isProcessing || results.length > 0) && (
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {isProcessing ? 'Processing...' : 'Results'}
                  </CardTitle>
                  <div className="flex gap-2">
                    {successCount > 0 && (
                      <Badge variant="default" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {successCount} Success
                      </Badge>
                    )}
                    {geocodedCount > 0 && (
                      <Badge variant="secondary" className="gap-1">
                        <MapPin className="h-3 w-3" />
                        {geocodedCount} Geocoded
                      </Badge>
                    )}
                    {trainingCount > 0 && (
                      <Badge variant="outline" className="gap-1 bg-green-500/10 text-green-600">
                        {trainingCount} Training Sessions
                      </Badge>
                    )}
                    {errorCount > 0 && (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        {errorCount} Failed
                      </Badge>
                    )}
                  </div>
                </div>
                {isProcessing && (
                  <Progress value={progress} className="mt-2" />
                )}
              </CardHeader>
              <CardContent className="py-2">
                <ScrollArea className="h-[250px]">
                  <div className="space-y-2">
                    {results.map((result, index) => (
                      <div 
                        key={index} 
                        className={`flex items-center justify-between p-2 rounded ${
                          result.status === 'success' ? 'bg-green-500/10' :
                          result.status === 'error' ? 'bg-destructive/10' :
                          'bg-muted/50'
                        }`}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {result.status === 'pending' && (
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          {result.status === 'processing' && (
                            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                          )}
                          {result.status === 'geocoding' && (
                            <MapPin className="h-4 w-4 animate-pulse text-blue-500 shrink-0" />
                          )}
                          {result.status === 'success' && (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          )}
                          {result.status === 'error' && (
                            <XCircle className="h-4 w-4 text-destructive shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm truncate">{result.fileName}</p>
                            {result.status === 'success' && (
                              <p className="text-xs text-muted-foreground truncate">
                                {result.provider} • {result.address || 'No address'} • {result.totalArea?.toLocaleString() || '?'} sqft
                                {result.trainingSessionCreated && ' • Training ✓'}
                              </p>
                            )}
                            {result.status === 'error' && (
                              <p className="text-xs text-destructive">{result.error}</p>
                            )}
                          </div>
                        </div>
                        {result.geocoded && (
                          <Badge variant="outline" className="shrink-0 ml-2">
                            <MapPin className="h-3 w-3 mr-1" />
                            Geocoded
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setFiles([]);
                setResults([]);
                setProgress(0);
              }}
              disabled={isProcessing}
            >
              Clear All
            </Button>
            <Button
              onClick={processAllFiles}
              disabled={files.length === 0 || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Import {files.length} Report{files.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>

          {/* Info Alert */}
          <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg text-sm">
            <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-muted-foreground">
              <strong>How it works:</strong> Each PDF is parsed to extract measurements (ridges, hips, valleys, eaves, rakes).
              Addresses are geocoded to get coordinates. Training sessions are auto-created so the AI can learn from your professional reports.
              <br /><strong>Credit-free learning:</strong> Once imported, the system learns without any additional AI calls.
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
