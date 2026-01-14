import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, Share2, ChevronLeft, ChevronRight, Loader2, FileText, ChevronsDown, Check, RefreshCw, Bug } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ReportPage } from './ReportPage';
import { SchematicRoofDiagram } from './SchematicRoofDiagram';
import { AllReportPages } from './AllReportPages';
import { useMultiPagePDFGeneration } from '@/hooks/useMultiPagePDFGeneration';

interface RoofrStyleReportPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measurementId?: string;
  measurement: any;
  tags: Record<string, any>;
  address: string;
  pipelineEntryId?: string;
  satelliteImageUrl?: string;
  companyInfo?: {
    name: string;
    logo?: string;
    phone?: string;
    email?: string;
    license?: string;
  };
  onReportGenerated?: (reportUrl: string) => void;
}

// Waste percentage options for report
const WASTE_PERCENTAGES = [0, 10, 12, 15, 17, 20, 22];

export function RoofrStyleReportPreview({
  open,
  onOpenChange,
  measurementId,
  measurement,
  tags,
  address,
  pipelineEntryId,
  satelliteImageUrl,
  companyInfo,
  onReportGenerated,
}: RoofrStyleReportPreviewProps) {
  const { toast } = useToast();
  const { generateMultiPagePDF, downloadPDF, isGenerating: isPDFGenerating, progress } = useMultiPagePDFGeneration();
  const [currentPage, setCurrentPage] = useState(1);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [showScrollHint, setShowScrollHint] = useState(true);
  const [roofMeasurementData, setRoofMeasurementData] = useState<any>(null);
  const [showHiddenPages, setShowHiddenPages] = useState(false);
  const [isRemeasuring, setIsRemeasuring] = useState(false);
  const [showDebugMetadata, setShowDebugMetadata] = useState(false);
  const [activeMeasurementId, setActiveMeasurementId] = useState<string | undefined>(measurementId);
  const [debugResults, setDebugResults] = useState<any>(null);
  const [isRunningDebug, setIsRunningDebug] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const totalPages = 7;
  
  // Fetch roof_measurements data - prioritize activeMeasurementId, fallback to address
  const fetchRoofMeasurements = useCallback(async (targetMeasurementId?: string) => {
    const selectFields = `
      id,
      facet_count,
      total_area_flat_sqft,
      total_area_adjusted_sqft,
      predominant_pitch,
      measurement_confidence,
      roof_type,
      complexity_rating,
      total_eave_length,
      total_rake_length,
      total_hip_length,
      total_valley_length,
      total_ridge_length,
      perimeter_wkt,
      linear_features_wkt,
      property_address,
      footprint_source,
      footprint_confidence,
      footprint_vertices_geo,
      footprint_requires_review,
      dsm_available,
      created_at,
      latitude,
      longitude
    `;
    
    try {
      let data = null;
      let error = null;
      const idToFetch = targetMeasurementId || activeMeasurementId;
      
      // PRIORITY 1: Fetch by measurementId if available (guarantees latest result)
      if (idToFetch) {
        const result = await supabase
          .from('roof_measurements')
          .select(selectFields)
          .eq('id', idToFetch)
          .maybeSingle();
        data = result.data;
        error = result.error;
        
        if (data) {
          console.log('📐 Fetched roof_measurements by ID:', idToFetch);
        }
      }
      
      // PRIORITY 2: Fallback to address lookup if no measurementId or not found
      if (!data && address) {
        const normalizedAddress = address.split(',')[0].trim().toUpperCase();
        const result = await supabase
          .from('roof_measurements')
          .select(selectFields)
          .ilike('property_address', `%${normalizedAddress}%`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        data = result.data;
        error = result.error;
        
        if (data) {
          console.log('📐 Fetched roof_measurements by address fallback');
        }
      }
      
      if (error) {
        console.log('No roof_measurements found:', error.message);
        return null;
      }
      
      if (data) {
        const wktFeatures = data.linear_features_wkt as any[];
        const vertices = data.footprint_vertices_geo as any[];
        console.log('📐 Loaded roof_measurements:', {
          id: data.id,
          facet_count: data.facet_count,
          total_area: data.total_area_adjusted_sqft,
          footprint_source: data.footprint_source,
          vertex_count: vertices?.length || 'unknown',
          perimeter_wkt: (data.perimeter_wkt as string)?.substring(0, 50),
          linear_features_wkt: wktFeatures?.length || 0,
          created_at: data.created_at,
        });
        setRoofMeasurementData(data);
        return data;
      }
      return null;
    } catch (err) {
      console.error('Error fetching roof_measurements:', err);
      return null;
    }
  }, [activeMeasurementId, address]);

  useEffect(() => {
    if (open) {
      fetchRoofMeasurements();
    }
  }, [open, activeMeasurementId, fetchRoofMeasurements]);

  // Re-measure function - triggers a new AI measurement
  const handleRemeasure = async () => {
    if (!roofMeasurementData?.latitude || !roofMeasurementData?.longitude) {
      toast({ title: "Error", description: "No coordinates available for re-measurement", variant: "destructive" });
      return;
    }
    
    setIsRemeasuring(true);
    try {
      console.log('🔄 Re-measuring roof at:', roofMeasurementData.latitude, roofMeasurementData.longitude);
      
      const { data, error } = await supabase.functions.invoke('analyze-roof-aerial', {
        body: {
          address: address || roofMeasurementData.property_address,
          coordinates: {
            lat: roofMeasurementData.latitude,
            lng: roofMeasurementData.longitude,
          },
        },
      });
      
      if (error) throw error;
      
      if (data?.measurementId) {
        console.log('✅ New measurement created:', data.measurementId);
        setActiveMeasurementId(data.measurementId);
        await fetchRoofMeasurements(data.measurementId);
        toast({ title: "Re-measured", description: `New measurement: ${data.measurementId.substring(0, 8)}...` });
      } else {
        throw new Error('No measurement ID returned');
      }
    } catch (err: any) {
      console.error('Re-measure error:', err);
      toast({ title: "Re-measure failed", description: err.message, variant: "destructive" });
    } finally {
      setIsRemeasuring(false);
    }
  };

  // Run footprint debug function
  const handleRunDebug = async () => {
    if (!roofMeasurementData?.latitude || !roofMeasurementData?.longitude) {
      toast({ title: "Error", description: "No coordinates available", variant: "destructive" });
      return;
    }
    
    setIsRunningDebug(true);
    setDebugResults(null);
    
    try {
      console.log('🐛 Running footprint debug at:', roofMeasurementData.latitude, roofMeasurementData.longitude);
      
      const { data, error } = await supabase.functions.invoke('debug-footprint-sources', {
        body: {
          lat: roofMeasurementData.latitude,
          lng: roofMeasurementData.longitude,
        },
      });
      
      if (error) throw error;
      
      console.log('🐛 Debug results:', data);
      setDebugResults(data);
      toast({ title: "Debug Complete", description: `Best source: ${data?.recommendation?.bestSource || 'none'}` });
    } catch (err: any) {
      console.error('Debug error:', err);
      toast({ title: "Debug failed", description: err.message, variant: "destructive" });
    } finally {
      setIsRunningDebug(false);
    }
  };

  // Merge measurement with full data from roof_measurements DB
  const enrichedMeasurement = useMemo(() => {
    if (!roofMeasurementData) return measurement;
    
    return {
      ...measurement,
      // Core data from DB - this is the source of truth
      facet_count: roofMeasurementData.facet_count,
      total_area_flat_sqft: roofMeasurementData.total_area_flat_sqft,
      total_area_adjusted_sqft: roofMeasurementData.total_area_adjusted_sqft,
      predominant_pitch: roofMeasurementData.predominant_pitch,
      measurement_confidence: roofMeasurementData.measurement_confidence,
      roof_type: roofMeasurementData.roof_type,
      complexity_rating: roofMeasurementData.complexity_rating,
      // Linear measurements from DB
      total_eave_length: roofMeasurementData.total_eave_length,
      total_rake_length: roofMeasurementData.total_rake_length,
      total_hip_length: roofMeasurementData.total_hip_length,
      total_valley_length: roofMeasurementData.total_valley_length,
      total_ridge_length: roofMeasurementData.total_ridge_length,
      // WKT geometry
      perimeter_wkt: roofMeasurementData.perimeter_wkt || measurement?.perimeter_wkt,
      linear_features_wkt: roofMeasurementData.linear_features_wkt || measurement?.linear_features_wkt,
      // Footprint tracking fields for source badge
      footprint_source: roofMeasurementData.footprint_source,
      footprint_confidence: roofMeasurementData.footprint_confidence,
      footprint_vertices_geo: roofMeasurementData.footprint_vertices_geo,
      footprint_requires_review: roofMeasurementData.footprint_requires_review,
      dsm_available: roofMeasurementData.dsm_available,
    };
  }, [measurement, roofMeasurementData]);
  
  // Auto-scroll to top when page changes
  useEffect(() => {
    const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]');
    if (scrollArea) {
      scrollArea.scrollTop = 0;
      setShowScrollHint(true);
    }
  }, [currentPage]);
  
  // Hide scroll hint after user scrolls
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollHint(false);
    };
    const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]');
    if (scrollArea) {
      scrollArea.addEventListener('scroll', handleScroll, { once: true });
      return () => scrollArea.removeEventListener('scroll', handleScroll);
    }
  }, [currentPage]);
  
  // Debug: Log what data we're receiving
  console.log('📊 RoofrStyleReportPreview data:', { measurement: enrichedMeasurement, tags, satelliteImageUrl });
  
  // Calculate linear totals from WKT features - prioritize enrichedMeasurement (DB truth)
  const wktLinearTotals = useMemo(() => {
    const wktFeatures = enrichedMeasurement?.linear_features_wkt || measurement?.linear_features_wkt || [];
    const totals: Record<string, number> = { eave: 0, rake: 0, hip: 0, valley: 0, ridge: 0 };
    
    if (Array.isArray(wktFeatures) && wktFeatures.length > 0) {
      wktFeatures.forEach((feature: any) => {
        const type = feature.type?.toLowerCase();
        if (type && totals.hasOwnProperty(type)) {
          totals[type] += feature.length_ft || 0;
        }
      });
    }
    
    console.log('📐 WKT Linear Features:', { 
      source: enrichedMeasurement?.linear_features_wkt ? 'enrichedMeasurement' : 'measurement',
      featureCount: wktFeatures.length,
      totals 
    });
    
    return totals;
  }, [enrichedMeasurement, measurement]);
  
  const hasWKTData = Object.values(wktLinearTotals).some(v => v > 0);
  
  // Extract measurement data - prioritize enrichedMeasurement (DB truth) over legacy fallbacks
  const totalArea = enrichedMeasurement?.total_area_adjusted_sqft || 
                    enrichedMeasurement?.total_area_flat_sqft ||
                    measurement?.summary?.total_area_sqft || 
                    tags?.['roof.total_area'] || 
                    tags?.['roof.plan_area'] || 
                    measurement?.total_area_sqft || 0;
  const totalSquares = (totalArea / 100).toFixed(1);
  const pitch = enrichedMeasurement?.predominant_pitch || 
                measurement?.summary?.pitch || 
                tags?.['roof.pitch'] || '6/12';
  
  // CRITICAL: Facet count from database is the source of truth
  const facetCount = enrichedMeasurement?.facet_count || 
                     roofMeasurementData?.facet_count ||
                     measurement?.facet_count || 
                     measurement?.faces?.length || 
                     tags?.['roof.faces_count'] || 
                     measurement?.facetCount || 4; // Default to 4 (typical residential hip roof)
  
  // Linear features - prioritize DB columns (enrichedMeasurement), then WKT-derived, then legacy
  const eaves = enrichedMeasurement?.total_eave_length || 
                (hasWKTData ? wktLinearTotals.eave : 
                 (measurement?.summary?.eave_ft || 
                  tags?.['lf.eave'] || 
                  measurement?.linear_features?.eave || 0));
  const rakes = enrichedMeasurement?.total_rake_length ||
                (hasWKTData ? wktLinearTotals.rake :
                 (measurement?.summary?.rake_ft || 
                  tags?.['lf.rake'] || 
                  measurement?.linear_features?.rake || 0));
  const ridges = enrichedMeasurement?.total_ridge_length ||
                 (hasWKTData ? wktLinearTotals.ridge :
                  (measurement?.summary?.ridge_ft || 
                   tags?.['lf.ridge'] || 
                   measurement?.linear_features?.ridge || 0));
  const hips = enrichedMeasurement?.total_hip_length ||
               (hasWKTData ? wktLinearTotals.hip :
                (measurement?.summary?.hip_ft || 
                 tags?.['lf.hip'] || 
                 measurement?.linear_features?.hip || 0));
  const valleys = enrichedMeasurement?.total_valley_length ||
                  (hasWKTData ? wktLinearTotals.valley :
                   (measurement?.summary?.valley_ft || 
                    tags?.['lf.valley'] || 
                    measurement?.linear_features?.valley || 0));
  const stepFlashing = tags?.['lf.step'] || measurement?.linear_features?.step || 0;
  
  console.log('📐 Linear measurements:', { eaves, rakes, ridges, hips, valleys, hasWKTData });
  
  // Materials - calculate from actual measurements if tags missing
  const materials = {
    shingleBundles: tags?.['materials.shingle_bundles'] || Math.ceil((totalArea * 1.1) / 33.3),
    starterBundles: tags?.['materials.starter_bundles'] || Math.ceil((eaves + rakes) / 120),
    iceWaterRolls: tags?.['materials.ice_water_rolls'] || Math.ceil(valleys / 66) || 0,
    underlaymentRolls: tags?.['materials.underlayment_rolls'] || Math.ceil(totalArea / 400),
    hipRidgeBundles: tags?.['materials.ridge_cap_bundles'] || Math.ceil((ridges + hips) / 35),
    valleySheets: Math.ceil(valleys / 10) || 0,
    dripEdgeSheets: tags?.['materials.drip_edge_sheets'] || Math.ceil((eaves + rakes) / 10),
  };

  // Calculate waste table values
  const wasteTableData = WASTE_PERCENTAGES.map(waste => {
    const adjustedArea = totalArea * (1 + waste / 100);
    return {
      waste,
      area: adjustedArea.toFixed(0),
      squares: (adjustedArea / 100).toFixed(2),
    };
  });

  const [isConfirming, setIsConfirming] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // Native share using Web Share API
  const handleShare = async () => {
    setIsSharing(true);
    try {
      // Generate PDF blob first
      setShowHiddenPages(true);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const result = await downloadPDF('all-report-pages-container', totalPages, {
        filename: `roof-report-${address.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`,
        propertyAddress: address,
        measurementId,
        pipelineEntryId,
      });
      
      setShowHiddenPages(false);
      
      if (result.success && result.blob) {
        const file = new File([result.blob], `roof-report-${address.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`, { type: 'application/pdf' });
        
        // Check if native file sharing is supported
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `Roof Report - ${address}`,
            text: `Measurement report for ${address}`,
            files: [file],
          });
          toast({ title: "Shared successfully" });
        } else if (navigator.share) {
          // Fallback: share URL if file sharing not supported
          if (result.storageUrl) {
            await navigator.share({
              title: `Roof Report - ${address}`,
              text: `Measurement report for ${address}`,
              url: result.storageUrl,
            });
            toast({ title: "Shared successfully" });
          } else {
            throw new Error('URL not available');
          }
        } else {
          // Final fallback: copy link to clipboard
          if (result.storageUrl) {
            await navigator.clipboard.writeText(result.storageUrl);
            toast({ title: "Link copied to clipboard" });
          } else {
            throw new Error('Share not supported');
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Share error:', error);
        toast({ title: "Share failed", description: error.message, variant: "destructive" });
      }
    } finally {
      setIsSharing(false);
    }
  };

  // Confirm & Save: generates PDF, uploads to documents bucket, saves smart tags
  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .maybeSingle();
      
      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error('No tenant found');
      
      // Generate PDF
      setShowHiddenPages(true);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const result = await generateMultiPagePDF('all-report-pages-container', totalPages, {
        filename: `roof-report-${address.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`,
        propertyAddress: address,
        measurementId,
        pipelineEntryId,
      });
      
      setShowHiddenPages(false);
      
      if (!result.success || !result.blob) {
        throw new Error('Failed to generate PDF');
      }
      
      const filename = `measurement-report-${Date.now()}.pdf`;
      const storagePath = `${tenantId}/pipeline/${pipelineEntryId || 'general'}/documents/${filename}`;
      
      // Upload to documents bucket
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, result.blob, { contentType: 'application/pdf' });
      
      if (uploadError) throw uploadError;
      
      // Insert into documents table
      console.log('[Confirm] Inserting document with tenant_id:', tenantId);
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .insert({
          tenant_id: tenantId,
          pipeline_entry_id: pipelineEntryId || null,
          document_type: 'measurement_report',
          filename,
          file_path: storagePath,
          mime_type: 'application/pdf',
          file_size: result.blob.size,
          description: `Measurement report for ${address}`,
          uploaded_by: user.id,
        })
        .select('id')
        .single();
      
      if (docError) throw docError;
      
      // Save measurement approval with tags for smart templates
      if (pipelineEntryId && measurementId) {
        console.log('[Confirm] Upserting measurement_approval with tenant_id:', tenantId);
        const { error: approvalError } = await supabase.from('measurement_approvals').upsert({
          tenant_id: tenantId,
          pipeline_entry_id: pipelineEntryId,
          measurement_id: measurementId,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          saved_tags: tags,
          report_generated: true,
          report_document_id: docData.id,
        }, { onConflict: 'pipeline_entry_id,measurement_id' });
        
        if (approvalError) {
          console.error('Measurement approval save failed:', approvalError);
          toast({ 
            title: "Warning", 
            description: "Report saved but measurement approval failed", 
            variant: "default" 
          });
        }
      }
      
      toast({ title: "Confirmed", description: "Saved to Documents" });
      onReportGenerated?.(storagePath);
      onOpenChange(false);
      
    } catch (error: any) {
      console.error('Confirm error:', error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsConfirming(false);
    }
  };

  const formatFeetInches = (feet: number) => {
    if (!feet || feet === 0) return '0 ft';
    const wholeFeet = Math.floor(feet);
    const inches = Math.round((feet - wholeFeet) * 12);
    if (inches === 0) return `${wholeFeet} ft`;
    return `${wholeFeet}' ${inches}"`;
  };

  return (
    <>
      {/* Hidden container for PDF generation */}
      {showHiddenPages && (
        <AllReportPages
          measurement={measurement}
          enrichedMeasurement={enrichedMeasurement}
          tags={tags}
          address={address}
          measurementId={roofMeasurementData?.id || measurementId}
          satelliteImageUrl={satelliteImageUrl}
          companyInfo={companyInfo}
        />
      )}
      
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-4 border-b flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary" />
              <DialogTitle>Professional Measurement Report</DialogTitle>
              <Badge variant="outline" className="ml-2">
                Page {currentPage} of {totalPages}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowDebugMetadata(!showDebugMetadata)}
                className="text-muted-foreground"
              >
                <Bug className="h-4 w-4" />
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleRemeasure} 
                disabled={isRemeasuring || !roofMeasurementData?.latitude}
              >
                {isRemeasuring ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Re-measure
              </Button>
              <Button variant="outline" size="sm" onClick={handleShare} disabled={isSharing}>
                {isSharing ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4 mr-1" />
                )}
                Share
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={isConfirming || isPDFGenerating}>
                {isConfirming || isPDFGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    {Math.round(progress)}%
                  </>
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Confirm
              </Button>
            </div>
          </div>
          
          {/* Debug Metadata Panel */}
          {showDebugMetadata && roofMeasurementData && (
            <div className="bg-muted/50 rounded-lg p-3 text-xs font-mono space-y-2 border">
              <div className="flex flex-wrap gap-4">
                <span><strong>ID:</strong> {roofMeasurementData.id?.substring(0, 8)}...</span>
                <span><strong>Source:</strong> <Badge variant={
                  roofMeasurementData.footprint_source === 'mapbox_vector' ? 'default' :
                  roofMeasurementData.footprint_source === 'regrid_parcel' ? 'secondary' :
                  roofMeasurementData.footprint_source === 'osm_overpass' ? 'secondary' :
                  'outline'
                }>{roofMeasurementData.footprint_source || 'unknown'}</Badge></span>
                <span><strong>Vertices:</strong> {
                  Array.isArray(roofMeasurementData.footprint_vertices_geo) 
                    ? roofMeasurementData.footprint_vertices_geo.length 
                    : 'N/A'
                }</span>
                <span><strong>Confidence:</strong> {roofMeasurementData.footprint_confidence ? `${Math.round(roofMeasurementData.footprint_confidence * 100)}%` : 'N/A'}</span>
                <span><strong>DSM:</strong> {roofMeasurementData.dsm_available ? '✓' : '✗'}</span>
                <span><strong>Created:</strong> {new Date(roofMeasurementData.created_at).toLocaleString()}</span>
              </div>
              {roofMeasurementData.footprint_requires_review && (
                <div className="text-amber-600 dark:text-amber-400">
                  ⚠️ Footprint requires manual review
                </div>
              )}
              
              {/* Debug Button */}
              <div className="flex items-center gap-2 pt-2 border-t">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleRunDebug}
                  disabled={isRunningDebug}
                  className="text-xs"
                >
                  {isRunningDebug ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Bug className="h-3 w-3 mr-1" />
                  )}
                  Run Footprint Debug
                </Button>
                {debugResults && (
                  <span className="text-green-600">
                    Best: {debugResults.recommendation?.bestSource || 'none'}
                  </span>
                )}
              </div>
              
              {/* Debug Results */}
              {debugResults && (
                <div className="mt-2 p-2 bg-background rounded border space-y-1 text-[10px] max-h-40 overflow-auto">
                  <div><strong>Mapbox:</strong> {debugResults.mapbox?.success ? 
                    `✅ ${debugResults.mapbox.selectedPolygon?.vertexCount || 0} vertices` : 
                    `❌ ${debugResults.mapbox?.error || debugResults.mapbox?.fallbackReason || 'failed'}`}</div>
                  <div><strong>Regrid:</strong> {debugResults.regrid?.success ? 
                    `✅ ${debugResults.regrid.footprint?.vertexCount || 0} vertices` : 
                    `❌ ${debugResults.regrid?.error || 'failed'}`}</div>
                  <div><strong>OSM:</strong> {debugResults.osm?.success ? 
                    `✅ ${debugResults.osm.footprint?.vertexCount || 0} vertices` : 
                    `❌ ${debugResults.osm?.error || 'failed'}`}</div>
                  <div><strong>Recommendation:</strong> {debugResults.recommendation?.reasoning || 'N/A'}</div>
                </div>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Page Navigation */}
          <div className="w-32 border-r bg-muted/30 p-2">
            <ScrollArea className="h-full">
              <div className="space-y-1">
                {[
                  { num: 1, label: 'Cover' },
                  { num: 2, label: 'Diagram' },
                  { num: 3, label: 'Lengths' },
                  { num: 4, label: 'Areas' },
                  { num: 5, label: 'Pitch' },
                  { num: 6, label: 'Summary' },
                  { num: 7, label: 'Materials' },
                ].map(({ num, label }) => (
                  <button
                    key={num}
                    onClick={() => setCurrentPage(num)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm ${
                      currentPage === num
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {num}. {label}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Report Content */}
          <ScrollArea className="flex-1 h-[calc(90vh-180px)]">
            <div className="p-6 pb-24" id="roofr-report-content" ref={scrollRef}>
              {/* Page 1: Cover */}
              {currentPage === 1 && (
                <ReportPage 
                  pageNumber={1}
                  companyInfo={companyInfo}
                >
                  <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-primary mb-2">Roof Report</h1>
                    <p className="text-muted-foreground">AI-Powered Measurement</p>
                  </div>
                  
                  <div className="bg-muted/30 rounded-lg p-4 mb-6">
                    <p className="text-lg font-medium">{address}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="bg-primary/10 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-primary">{Math.round(totalArea).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Total Sq Ft</div>
                    </div>
                    <div className="bg-primary/10 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-primary">{facetCount}</div>
                      <div className="text-xs text-muted-foreground">Facets</div>
                    </div>
                    <div className="bg-primary/10 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-primary">{pitch}</div>
                      <div className="text-xs text-muted-foreground">Predominant Pitch</div>
                    </div>
                  </div>

                  {/* Satellite Image with Roof Overlay */}
                  <div className="aspect-[4/3] bg-muted rounded-lg overflow-hidden mb-4">
                    {satelliteImageUrl ? (
                      <div className="relative w-full h-full">
                        <img 
                          src={satelliteImageUrl} 
                          alt="Satellite view of property" 
                          className="w-full h-full object-cover"
                        />
                        {/* Clean satellite image without overlay on cover page */}
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-200 dark:bg-slate-700">
                        <p className="text-muted-foreground text-sm">Satellite image loading...</p>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground text-center">
                    Report generated on {new Date().toLocaleDateString()} • Imagery source: Mapbox Satellite
                  </p>
                </ReportPage>
              )}

              {/* Page 2: Clean Diagram */}
              {currentPage === 2 && (
                <ReportPage pageNumber={2} companyInfo={companyInfo} title="Roof Diagram">
                  <div className="aspect-square bg-white rounded-lg border overflow-hidden">
                    <SchematicRoofDiagram 
                      measurement={enrichedMeasurement}
                      tags={tags}
                      measurementId={roofMeasurementData?.id || measurementId}
                      width={500}
                      height={500}
                      showLengthLabels={false}
                      showLegend={true}
                      showCompass={true}
                      showTotals={true}
                      satelliteImageUrl={satelliteImageUrl}
                    />
                  </div>
                </ReportPage>
              )}

              {/* Page 3: Length Measurement Report */}
              {currentPage === 3 && (
                <ReportPage pageNumber={3} companyInfo={companyInfo} title="Length Measurement Report">
                  <div className="grid grid-cols-4 gap-3 mb-6">
                    <div className="bg-cyan-50 dark:bg-cyan-950 border border-cyan-200 dark:border-cyan-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-cyan-700 dark:text-cyan-300">{formatFeetInches(eaves)}</div>
                      <div className="text-xs text-cyan-600 dark:text-cyan-400">Eaves</div>
                    </div>
                    <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-red-700 dark:text-red-300">{formatFeetInches(valleys)}</div>
                      <div className="text-xs text-red-600 dark:text-red-400">Valleys</div>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatFeetInches(hips)}</div>
                      <div className="text-xs text-blue-600 dark:text-blue-400">Hips</div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-green-700 dark:text-green-300">{formatFeetInches(ridges)}</div>
                      <div className="text-xs text-green-600 dark:text-green-400">Ridges</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-purple-700 dark:text-purple-300">{formatFeetInches(rakes)}</div>
                      <div className="text-xs text-purple-600 dark:text-purple-400">Rakes</div>
                    </div>
                    <div className="bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-orange-700 dark:text-orange-300">{formatFeetInches(stepFlashing)}</div>
                      <div className="text-xs text-orange-600 dark:text-orange-400">Step Flashing</div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-3 text-center">
                      <div className="text-xl font-bold text-gray-700 dark:text-gray-300">0ft 0in</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Wall Flashing</div>
                    </div>
                  </div>

                  <div className="aspect-video bg-white rounded-lg border overflow-hidden">
                    <SchematicRoofDiagram 
                      measurement={enrichedMeasurement}
                      tags={tags}
                      measurementId={roofMeasurementData?.id || measurementId}
                      width={550}
                      height={350}
                      showLengthLabels={true}
                      showLegend={false}
                      showCompass={true}
                      showTotals={false}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <Badge className="bg-cyan-500">Eaves</Badge>
                    <Badge className="bg-red-500">Valleys</Badge>
                    <Badge className="bg-blue-500">Hips</Badge>
                    <Badge className="bg-green-500">Ridges</Badge>
                    <Badge className="bg-purple-500">Rakes</Badge>
                    <Badge className="bg-orange-500">Step Flashing</Badge>
                  </div>
                </ReportPage>
              )}

              {/* Page 4: Area Measurement Report */}
              {currentPage === 4 && (
                <ReportPage pageNumber={4} companyInfo={companyInfo} title="Area Measurement Report">
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-primary/10 rounded-lg p-4">
                      <div className="text-sm text-muted-foreground">Total Roof Area</div>
                      <div className="text-3xl font-bold">{Math.round(totalArea).toLocaleString()} sqft</div>
                    </div>
                    <div className="bg-primary/10 rounded-lg p-4">
                      <div className="text-sm text-muted-foreground">Predominant Pitch</div>
                      <div className="text-3xl font-bold">{pitch}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="border rounded p-3 text-center">
                      <div className="text-xl font-bold">{Math.round(totalArea).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Pitched Roof Area (sqft)</div>
                    </div>
                    <div className="border rounded p-3 text-center">
                      <div className="text-xl font-bold">0</div>
                      <div className="text-xs text-muted-foreground">Flat Roof Area (sqft)</div>
                    </div>
                    <div className="border rounded p-3 text-center">
                      <div className="text-xl font-bold">0</div>
                      <div className="text-xs text-muted-foreground">Two Story Area (sqft)</div>
                    </div>
                  </div>

                  <div className="aspect-video bg-white rounded-lg border overflow-hidden">
                    <SchematicRoofDiagram 
                      measurement={enrichedMeasurement}
                      tags={tags}
                      measurementId={roofMeasurementData?.id || measurementId}
                      width={550}
                      height={350}
                      showLengthLabels={false}
                      showLegend={true}
                      showCompass={true}
                      showTotals={true}
                    />
                  </div>
                </ReportPage>
              )}

              {/* Page 5: Pitch & Direction */}
              {currentPage === 5 && (
                <ReportPage pageNumber={5} companyInfo={companyInfo} title="Pitch & Direction Report">
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="border rounded-lg p-4">
                      <div className="text-sm text-muted-foreground mb-2">Pitch Distribution</div>
                      <div className="space-y-2">
                        {(measurement?.faces || []).reduce((acc: any[], face: any) => {
                          const pitch = face.pitch || '6/12';
                          const existing = acc.find(p => p.pitch === pitch);
                          if (existing) {
                            existing.count++;
                            existing.area += face.area_sqft || face.plan_area_sqft || 0;
                          } else {
                            acc.push({ pitch, count: 1, area: face.area_sqft || face.plan_area_sqft || 0 });
                          }
                          return acc;
                        }, []).map((p: any, i: number) => (
                          <div key={i} className="flex justify-between items-center">
                            <span className="font-medium">{p.pitch}</span>
                            <span className="text-muted-foreground">{p.count} facets ({Math.round(p.area)} sqft)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border rounded-lg p-4">
                      <div className="text-sm text-muted-foreground mb-2">Predominant Direction</div>
                      <div className="text-2xl font-bold">South-Facing</div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Based on largest facet orientation
                      </p>
                    </div>
                  </div>

                  <div className="aspect-video bg-white rounded-lg border overflow-hidden">
                    <SchematicRoofDiagram 
                      measurement={enrichedMeasurement}
                      tags={tags}
                      measurementId={roofMeasurementData?.id || measurementId}
                      width={550}
                      height={350}
                      showLengthLabels={true}
                      showLegend={true}
                      showCompass={true}
                      showTotals={false}
                    />
                  </div>
                </ReportPage>
              )}

              {/* Page 6: Report Summary */}
              {currentPage === 6 && (
                <ReportPage pageNumber={6} companyInfo={companyInfo} title="Report Summary">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold mb-3 text-lg">Measurements Summary</h3>
                      <table className="w-full text-sm">
                        <tbody>
                          <tr className="border-b"><td className="py-2">Total Roof Area</td><td className="py-2 font-bold text-right">{Math.round(totalArea).toLocaleString()} sqft</td></tr>
                          <tr className="border-b"><td className="py-2">Predominant Pitch</td><td className="py-2 font-bold text-right">{pitch}</td></tr>
                          <tr className="border-b"><td className="py-2">Facet Count</td><td className="py-2 font-bold text-right">{facetCount}</td></tr>
                          <tr className="border-b"><td className="py-2">Eaves</td><td className="py-2 text-right">{formatFeetInches(eaves)}</td></tr>
                          <tr className="border-b"><td className="py-2">Rakes</td><td className="py-2 text-right">{formatFeetInches(rakes)}</td></tr>
                          <tr className="border-b"><td className="py-2">Ridges</td><td className="py-2 text-right">{formatFeetInches(ridges)}</td></tr>
                          <tr className="border-b"><td className="py-2">Hips</td><td className="py-2 text-right">{formatFeetInches(hips)}</td></tr>
                          <tr className="border-b"><td className="py-2">Valleys</td><td className="py-2 text-right">{formatFeetInches(valleys)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                    
                    <div>
                      <h3 className="font-semibold mb-3 text-lg">Waste Factor Table</h3>
                      <table className="w-full text-sm border">
                        <thead className="bg-muted">
                          <tr>
                            <th className="py-2 px-3 text-left">Waste %</th>
                            <th className="py-2 px-3 text-right">Area (sqft)</th>
                            <th className="py-2 px-3 text-right">Squares</th>
                          </tr>
                        </thead>
                        <tbody>
                          {wasteTableData.map(row => (
                            <tr key={row.waste} className={`border-t ${row.waste === 10 ? 'bg-primary/10 font-medium' : ''}`}>
                              <td className="py-1.5 px-3">{row.waste}%</td>
                              <td className="py-1.5 px-3 text-right">{row.area}</td>
                              <td className="py-1.5 px-3 text-right">{row.squares}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-xs text-muted-foreground mt-2">
                        * Recommended waste factor: 10-15% for standard roofs
                      </p>
                    </div>
                  </div>
                </ReportPage>
              )}

              {/* Page 7: Material Calculations */}
              {currentPage === 7 && (
                <ReportPage pageNumber={7} companyInfo={companyInfo} title="Material Calculations">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border">
                      <thead className="bg-muted">
                        <tr>
                          <th className="py-2 px-3 text-left">Product</th>
                          <th className="py-2 px-3 text-center">Unit</th>
                          <th className="py-2 px-3 text-right">0%</th>
                          <th className="py-2 px-3 text-right">10%</th>
                          <th className="py-2 px-3 text-right">12%</th>
                          <th className="py-2 px-3 text-right">15%</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Shingles</td>
                        </tr>
                        {['IKO Cambridge', 'CertainTeed Landmark', 'GAF Timberline HDZ', 'Owens Corning Duration', 'Atlas Pristine'].map(brand => (
                          <tr key={brand} className="border-t">
                            <td className="py-1.5 px-3 pl-6">{brand}</td>
                            <td className="py-1.5 px-3 text-center">bundle</td>
                            <td className="py-1.5 px-3 text-right">{Math.ceil(totalArea / 33.3)}</td>
                            <td className="py-1.5 px-3 text-right">{Math.ceil((totalArea * 1.1) / 33.3)}</td>
                            <td className="py-1.5 px-3 text-right">{Math.ceil((totalArea * 1.12) / 33.3)}</td>
                            <td className="py-1.5 px-3 text-right">{Math.ceil((totalArea * 1.15) / 33.3)}</td>
                          </tr>
                        ))}
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Starter Strip</td>
                        </tr>
                        <tr className="border-t">
                          <td className="py-1.5 px-3 pl-6">IKO Leading Edge</td>
                          <td className="py-1.5 px-3 text-center">bundle</td>
                          <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                        </tr>
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Ice & Water Shield</td>
                        </tr>
                        <tr className="border-t">
                          <td className="py-1.5 px-3 pl-6">IKO GoldShield</td>
                          <td className="py-1.5 px-3 text-center">roll</td>
                          <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                          <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                          <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                          <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                        </tr>
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Hip & Ridge Cap</td>
                        </tr>
                        <tr className="border-t">
                          <td className="py-1.5 px-3 pl-6">IKO Ultra HP</td>
                          <td className="py-1.5 px-3 text-center">bundle</td>
                          <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                        </tr>
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Underlayment</td>
                        </tr>
                        <tr className="border-t">
                          <td className="py-1.5 px-3 pl-6">IKO RoofGard-SA</td>
                          <td className="py-1.5 px-3 text-center">roll</td>
                          <td className="py-1.5 px-3 text-right">{materials.underlaymentRolls}</td>
                          <td className="py-1.5 px-3 text-right">{Math.ceil(materials.underlaymentRolls * 1.1)}</td>
                          <td className="py-1.5 px-3 text-right">{Math.ceil(materials.underlaymentRolls * 1.12)}</td>
                          <td className="py-1.5 px-3 text-right">{Math.ceil(materials.underlaymentRolls * 1.15)}</td>
                        </tr>
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Drip Edge</td>
                        </tr>
                        <tr className="border-t">
                          <td className="py-1.5 px-3 pl-6">Aluminum Drip Edge</td>
                          <td className="py-1.5 px-3 text-center">10ft pc</td>
                          <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                          <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                          <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                          <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  
                  <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      <strong>Disclaimer:</strong> Material quantities are estimates based on measurements. 
                      Always verify requirements before ordering. Local building codes may require additional materials.
                    </p>
                  </div>
                </ReportPage>
              )}
            </div>
            
            {/* Scroll Indicator */}
            {showScrollHint && (
              <div className="sticky bottom-0 left-0 right-0 flex justify-center py-3 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none">
                <div className="flex items-center gap-1 text-xs text-muted-foreground animate-bounce">
                  <ChevronsDown className="h-4 w-4" />
                  <span>Scroll for more</span>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Page Navigation Footer */}
        <div className="flex items-center justify-between p-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`w-8 h-8 rounded text-sm ${
                  currentPage === page
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                {page}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
