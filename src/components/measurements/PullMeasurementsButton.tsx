import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, Pencil, Crosshair } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useImageCache } from '@/contexts/ImageCacheContext';
import { StructureSelectionMap } from './StructureSelectionMap';
import { useMeasurementCoordinates } from '@/hooks/useMeasurementCoordinates';
import { RoofrStyleReportPreview } from './RoofrStyleReportPreview';
import { triggerAutomation, AUTOMATION_EVENTS } from '@/lib/automations/triggerAutomation';
import { useMeasurementJob } from '@/hooks/useMeasurementJob';
import { EdgeConfirmationWizard } from './EdgeConfirmationWizard';
import type { PlanEdge, EdgeType } from './DimensionedPlanDrawing';

// Pitch multipliers for area adjustment
const PITCH_MULTIPLIERS: Record<string, number> = {
  '0/12': 1.0, '1/12': 1.003, '2/12': 1.014, '3/12': 1.031,
  '4/12': 1.054, '5/12': 1.083, '6/12': 1.118, '7/12': 1.158,
  '8/12': 1.202, '9/12': 1.250, '10/12': 1.302, '11/12': 1.357,
  '12/12': 1.414
};

interface PullMeasurementsButtonProps {
  propertyId: string;
  lat: number;
  lng: number;
  address?: string;
  onSuccess?: (measurement: any, tags: Record<string, any>) => void;
}

/**
 * Transform new analyze-roof-aerial response to legacy format for MeasurementVerificationDialog
 */
function transformNewMeasurementToLegacyFormat(newData: any) {
  const { measurements, aiAnalysis, confidence, images, linearFeaturesWkt, perimeterWkt, analysisZoom, footprint } = newData;
  
  // Transform to legacy "measurement" object
  const measurement = {
    id: null, // Will be set from measurementId
    faces: measurements?.facets?.map((f: any, i: number) => ({
      id: i + 1,
      facet_number: f.facetNumber || i + 1,
      pitch: f.pitch || '6/12',
      plan_area_sqft: f.flatAreaSqft || f.area || 0,
      area_sqft: f.adjustedAreaSqft || f.area || 0,
      shape: f.shape || 'rectangle',
      orientation: f.orientation || 'unknown',
      wkt: f.wkt || f.polygon_wkt || null,
    })) || [],
    // CRITICAL FIX: Use WKT array from API response for accurate overlay rendering
    // This preserves the geographic coordinates detected by AI Vision
    linear_features: linearFeaturesWkt || measurements?.linearFeaturesWkt || measurements?.linear || {
      ridge: 0,
      hip: 0,
      valley: 0,
      eave: 0,
      rake: 0,
    },
    // Preserve perimeter WKT for outline rendering
    perimeter_wkt: perimeterWkt || measurements?.perimeterWkt || null,
    // Store analysis zoom for accurate coordinate transformation in overlay
    analysis_zoom: analysisZoom || measurements?.analysisZoom || 20,
    // Store analysis image size for proper scaling (default 640x640)
    analysis_image_size: measurements?.analysisImageSize || { width: 640, height: 640 },
    mapbox_visualization_url: images?.mapbox?.url || null,
    google_image_url: images?.google?.url || null,
    roof_type: aiAnalysis?.roofType || measurements?.roofType || 'unknown',
    predominant_pitch: measurements?.predominantPitch || aiAnalysis?.pitch || '6/12',
    confidence_score: confidence?.score || 0,
    requires_review: confidence?.requiresReview || false,
    // Include summary for MeasurementVerificationDialog
    summary: {
      total_area_sqft: measurements?.totalAdjustedArea || measurements?.totalAreaSqft || 0,
      total_squares: measurements?.totalSquares || 0,
      waste_pct: ((measurements?.wasteFactor || 1.12) - 1) * 100,
      pitch: measurements?.predominantPitch || aiAnalysis?.pitch || '6/12',
      perimeter_ft: (measurements?.linear?.eave || 0) + (measurements?.linear?.rake || 0),
      stories: measurements?.stories || 1,
      // Include linear feature totals in summary for display
      ridge_ft: measurements?.linear?.ridge || 0,
      hip_ft: measurements?.linear?.hip || 0,
      valley_ft: measurements?.linear?.valley || 0,
      eave_ft: measurements?.linear?.eave || 0,
      rake_ft: measurements?.linear?.rake || 0,
    },
    // AI-specific fields
    aiAnalysis: aiAnalysis || null,
    confidence: confidence || null,
    // NEW: Footprint tracking fields for source badge display
    footprint_source: footprint?.source || 'ai_detection',
    footprint_confidence: footprint?.confidence || 0.5,
    footprint_vertices_geo: footprint?.vertices || null,
    footprint_requires_review: footprint?.requiresReview || false,
    dsm_available: footprint?.dsmAvailable || false,
  };

  // Get pitch multiplier
  const pitchStr = measurements?.predominantPitch || aiAnalysis?.pitch || '6/12';
  const pitchMultiplier = PITCH_MULTIPLIERS[pitchStr] || 1.118;

  // Transform to legacy "tags" format - use correct 'lf.' prefix for linear features
  const tags: Record<string, any> = {
    'roof.plan_area': measurements?.totalFlatArea || measurements?.totalAreaSqft || 0,
    'roof.total_area': measurements?.totalAdjustedArea || measurements?.totalAreaSqft || 0,
    'roof.squares': measurements?.totalSquares || 0,
    'roof.pitch_factor': pitchMultiplier,
    'roof.waste_pct': ((measurements?.wasteFactor || 1.12) - 1) * 100,
    'roof.faces_count': aiAnalysis?.facetCount || measurements?.facets?.length || 0,
    'roof.perimeter': (measurements?.linear?.eave || 0) + (measurements?.linear?.rake || 0),
    // Use 'lf.' prefix for linear features (ComprehensiveMeasurementOverlay expects this)
    'lf.ridge': measurements?.linear?.ridge || 0,
    'lf.hip': measurements?.linear?.hip || 0,
    'lf.valley': measurements?.linear?.valley || 0,
    'lf.eave': measurements?.linear?.eave || 0,
    'lf.rake': measurements?.linear?.rake || 0,
    // Also keep roof.* versions for backward compatibility
    'roof.ridge': measurements?.linear?.ridge || 0,
    'roof.hip': measurements?.linear?.hip || 0,
    'roof.valley': measurements?.linear?.valley || 0,
    'roof.eave': measurements?.linear?.eave || 0,
    'roof.rake': measurements?.linear?.rake || 0,
    'materials.shingle_bundles': measurements?.materials?.shingleBundles || 0,
    'materials.ridge_cap_bundles': measurements?.materials?.hipRidgeBundles || 0,
    'materials.valley_rolls': measurements?.materials?.valleyMetalSheets || 0,
    'materials.drip_edge_sheets': measurements?.materials?.dripEdgeSheets || 0,
    'materials.starter_bundles': measurements?.materials?.starterStripBundles || 0,
    'materials.ice_water_rolls': measurements?.materials?.iceWaterShieldRolls || 0,
    'materials.underlayment_rolls': measurements?.materials?.underlaymentRolls || 0,
    // AI-specific tags
    'ai.confidence': confidence?.score || 0,
    'ai.rating': confidence?.rating || 'unknown',
    'ai.roof_type': aiAnalysis?.roofType || 'unknown',
    'ai.complexity': aiAnalysis?.complexity || 'moderate',
    // NEW: Footprint tracking tags for source badge and DSM indicator
    'footprint.source': footprint?.source || 'ai_detection',
    'footprint.confidence': footprint?.confidence || 0.5,
    'footprint.vertex_count': footprint?.vertexCount || 0,
    'footprint.dsm_available': footprint?.dsmAvailable || false,
    'footprint.requires_review': footprint?.requiresReview || false,
  };

  return { measurement, tags };
}

export function PullMeasurementsButton({
  propertyId,
  lat,
  lng,
  address,
  onSuccess
}: PullMeasurementsButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const imageCache = useImageCache();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showStructureSelector, setShowStructureSelector] = useState(false);
  const [verificationData, setVerificationData] = useState<{
    measurement: any;
    tags: Record<string, any>;
    satelliteImageUrl?: string;
    finalCoords?: { lat: number; lng: number };
  } | null>(null);
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [showVerifyWizard, setShowVerifyWizard] = useState(false);
  const [seedEdges, setSeedEdges] = useState<PlanEdge[] | undefined>(undefined);
  const [companyInfo, setCompanyInfo] = useState<{
    name: string;
    logo?: string;
    phone?: string;
    email?: string;
    license?: string;
  } | null>(null);
  
  // Use unified coordinate hook for single source of truth
  const { 
    coordinates: verifiedCoords, 
    isLoading: loadingCoords, 
    source: coordSource,
    loadCoordinates 
  } = useMeasurementCoordinates({
    pipelineEntryId: propertyId,
    propLat: lat,
    propLng: lng,
    address
  });

  // Open structure selector using coordinates from the unified hook
  const handleOpenStructureSelector = useCallback(async () => {
    // Load coordinates to ensure we have the latest from database
    const freshCoords = await loadCoordinates();
    
    if (!freshCoords?.isValid) {
      toast({
        title: "Verified Address Required",
        description: "Property coordinates not verified. Please use the 'Re-verify Address' button to confirm the exact property location before running AI measurements.",
        variant: "destructive"
      });
      return;
    }

    // Log coordinate source for debugging (no longer prompting for re-verification)
    if (freshCoords.source !== 'contact_verified_address' && freshCoords.source !== 'user_pin_selection') {
      console.log(`📍 Using ${freshCoords.source} coordinates — address was verified at lead creation.`);
    }

    console.log('📍 Opening structure selector with fresh coords:', { 
      lat: freshCoords.lat, 
      lng: freshCoords.lng, 
      source: freshCoords.source 
    });
    setShowStructureSelector(true);
  }, [loadCoordinates, toast]);

  // Use measurement job hook for async processing
  const { job, isActive: jobIsActive, startJob } = useMeasurementJob(propertyId);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  const [shouldNotifyJobStatus, setShouldNotifyJobStatus] = useState(false);

  // Run AI analysis with the confirmed coordinates from PIN selection — now ASYNC
  async function handlePull(confirmedLat: number, confirmedLng: number, pitchOverride?: string) {
    const pullLat = confirmedLat;
    const pullLng = confirmedLng;

    if (!pullLat || !pullLng || (pullLat === 0 && pullLng === 0)) {
      toast({
        title: "Missing Location",
        description: "Property coordinates not found. Please verify the address first.",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    setSuccess(false);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      let tenantId = 'unknown';
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .single();
        tenantId = profile?.tenant_id || 'unknown';
      }

      // Start async job — returns immediately
      const jobId = await startJob({
        lat: pullLat,
        lng: pullLng,
        address: address || undefined,
        pitchOverride: pitchOverride || undefined,
        tenantId,
        userId: user?.id,
      });

      setTrackedJobId(jobId);
      setShouldNotifyJobStatus(true);
      setPrevJobStatus(null);

      toast({
        title: "🚀 Measurement Started",
        description: "AI analysis is running in the background. You'll see results when it's done.",
      });

      // Reset loading — the job status will drive the UI now
      setLoading(false);

    } catch (err: any) {
      console.error('Failed to start measurement job:', err);
      toast({
        title: "Failed to Start",
        description: err.message || "Could not start AI measurement. Try again.",
        variant: "destructive",
      });
      setLoading(false);
    }
  }

  // Track job status changes to show toasts
  const [prevJobStatus, setPrevJobStatus] = useState<string | null>(null);
  
  useEffect(() => {
    if (!job) return;
    if (!shouldNotifyJobStatus) return;
    if (!trackedJobId || job.id !== trackedJobId) return;
    if (job.status === prevJobStatus) return;
    
    if (job.status === 'completed' && prevJobStatus !== 'completed') {
      setSuccess(true);
      setShouldNotifyJobStatus(false);
      setTimeout(() => setSuccess(false), 5000);
      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', propertyId] });
      queryClient.invalidateQueries({ queryKey: ['ai-measurements', propertyId] });
      queryClient.invalidateQueries({ queryKey: ['measurement-context', propertyId] });
      toast({
        title: "✅ AI Analysis Complete — Verify for 100% Accuracy",
        description: "Confirm each edge to lock in the measurement.",
      });

      // Fetch the latest AI measurement and seed the verification wizard
      (async () => {
        try {
          const { data } = await supabase
            .from('roof_measurements')
            .select('total_ridge_length, total_hip_length, total_valley_length, total_eave_length, total_rake_length')
            .eq('customer_id', propertyId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const seeds: PlanEdge[] = [];
          // Build a simple rectangular plan from the AI's totals so the user
          // can confirm/correct each edge type and length.
          const addRun = (type: EdgeType, total: number) => {
            const len = Number(total) || 0;
            if (len <= 0) return;
            // Split each total into a single representative edge per type
            seeds.push({
              id: `ai-${type}-${seeds.length}`,
              type,
              p1: [0, seeds.length * 8],
              p2: [len, seeds.length * 8],
              length_ft: len,
              confirmed: false,
            });
          };
          if (data) {
            addRun('eave', data.total_eave_length || 0);
            addRun('rake', data.total_rake_length || 0);
            addRun('ridge', data.total_ridge_length || 0);
            addRun('hip', data.total_hip_length || 0);
            addRun('valley', data.total_valley_length || 0);
          }
          setSeedEdges(seeds.length > 0 ? seeds : undefined);
        } catch (e) {
          console.warn('Could not seed verify wizard from AI measurement:', e);
          setSeedEdges(undefined);
        } finally {
          setShowVerifyWizard(true);
        }
      })();
    } else if (job.status === 'failed' && prevJobStatus !== 'failed') {
      setShouldNotifyJobStatus(false);
      toast({
        title: "Analysis Failed",
        description: job.error || "AI measurement could not complete.",
        variant: "destructive",
      });
    }
    
    setPrevJobStatus(job.status);
  }, [job, prevJobStatus, propertyId, queryClient, shouldNotifyJobStatus, toast, trackedJobId]);

  const handleAcceptMeasurements = async (adjustedMeasurement?: any) => {
    if (!verificationData) return;

    const { measurement, tags } = verificationData;
    const finalMeasurement = adjustedMeasurement || measurement;
    
    // Merge penetrations and age data into tags if adjusted
    let finalTags = { ...tags };
    if (adjustedMeasurement?.penetrations) {
      const penetrations = adjustedMeasurement.penetrations;
      finalTags['pen.pipe_vent'] = penetrations.pipe_vent || 0;
      finalTags['pen.skylight'] = penetrations.skylight || 0;
      finalTags['pen.chimney'] = penetrations.chimney || 0;
      finalTags['pen.hvac'] = penetrations.hvac || 0;
      finalTags['pen.other'] = penetrations.other || 0;
      finalTags['pen.total'] = (
        (penetrations.pipe_vent || 0) +
        (penetrations.skylight || 0) +
        (penetrations.chimney || 0) +
        (penetrations.hvac || 0) +
        (penetrations.other || 0)
      );
    }
    if (adjustedMeasurement?.roofAge !== undefined) {
      finalTags['age.years'] = adjustedMeasurement.roofAge;
    }
    if (adjustedMeasurement?.roofAgeSource) {
      finalTags['age.source'] = adjustedMeasurement.roofAgeSource;
    }

    // Invalidate measurement cache
    queryClient.invalidateQueries({ queryKey: ['measurement', propertyId] });

    setSuccess(true);
    
    const squares = adjustedMeasurement?.adjustedSquares || tags['roof.squares'];
    
    toast({
      title: "Measurements Applied",
      description: `${squares?.toFixed(1)} squares ready for estimates`,
    });

    // Trigger automation for measurement completion
    try {
      await triggerAutomation(AUTOMATION_EVENTS.MEASUREMENT_COMPLETED, {
        measurement_id: finalMeasurement.id || null,
        pipeline_entry_id: propertyId,
        confidence_score: tags['confidence.score'] || finalMeasurement.measurementConfidence || 0,
        accuracy_tier: getAccuracyTier(tags['confidence.score'] || finalMeasurement.measurementConfidence || 0),
        source: tags['source'] || 'ai_analysis',
        total_squares: squares,
      });
    } catch (automationErr) {
      console.error('Automation trigger error (non-fatal):', automationErr);
    }

    onSuccess?.(finalMeasurement, finalTags);

    // Reset success state after 3 seconds
    setTimeout(() => setSuccess(false), 3000);
  };

  // Helper to determine accuracy tier
  function getAccuracyTier(confidence: number): string {
    if (confidence >= 98) return 'diamond';
    if (confidence >= 95) return 'platinum';
    if (confidence >= 90) return 'gold';
    if (confidence >= 80) return 'silver';
    return 'bronze';
  }

  // Handle report generated - save to documents
  const handleReportGenerated = async (reportUrl: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user?.id || '')
        .single();
      
      const filename = `Roof_Measurement_Report_${new Date().toISOString().split('T')[0]}.pdf`;
      
      await supabase.from('documents').insert({
        tenant_id: profile?.tenant_id,
        pipeline_entry_id: propertyId,
        document_type: 'measurement_report',
        filename,
        file_path: reportUrl,
        uploaded_by: user?.id,
        description: `Roof Measurement Report for ${address || 'Property'}`,
      });

      toast({
        title: "Report Saved",
        description: "Measurement report saved to documents",
      });
    } catch (error) {
      console.error('Failed to save report to documents:', error);
    }
  };

  const handleCloseReport = () => {
    setShowReportPreview(false);
    // Trigger success callback with the measurements
    if (verificationData) {
      onSuccess?.(verificationData.measurement, verificationData.tags);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    }
  };

  const handleOpenManualTool = () => {
    // Navigate to professional measurement page for manual verification/drawing
    navigate(`/professional-measurement/${propertyId}`);
  };

  // Handle structure selection from PIN map - immediately run AI analysis
  const handleStructureConfirmed = (selectedLat: number, selectedLng: number, pitchOverride?: string) => {
    setShowStructureSelector(false);
    toast({
      title: "📍 Structure Selected",
      description: pitchOverride 
        ? `Using ${pitchOverride} pitch for measurements...` 
        : "Now pulling measurements for the selected building...",
    });
    // Immediately trigger pull with confirmed coordinates and pitch override
    handlePull(selectedLat, selectedLng, pitchOverride);
  };

  // Re-analyze using stored verified coordinates (skips structure selector)
  const handleReanalyze = useCallback(async () => {
    const freshCoords = await loadCoordinates();
    
    if (!freshCoords?.isValid) {
      toast({
        title: "Verified Coordinates Required",
        description: "No verified coordinates found. Use 'AI Measurements' to select a structure first.",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "🔄 Re-analyzing Property",
      description: `Using stored coordinates (${freshCoords.source})`,
    });

    // Directly trigger analysis with stored coordinates
    handlePull(freshCoords.lat, freshCoords.lng);
  }, [loadCoordinates, toast]);

  // Check if we have verified coordinates for re-analyze button
  const hasVerifiedCoords = verifiedCoords?.isValid && 
    (coordSource === 'contact_verified_address' || coordSource === 'user_pin_selection');

  // Determine button state from job status
  const isJobRunning = job?.status === 'queued' || job?.status === 'processing';
  const buttonDisabled = loading || loadingCoords || isJobRunning;

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Main AI Measurements button - opens structure selector first */}
        <Button
          onClick={handleOpenStructureSelector}
          disabled={buttonDisabled}
          variant="outline"
          size="sm"
        >
          {loadingCoords ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading...
            </>
          ) : isJobRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {job?.progress_message || 'AI Analyzing...'}
            </>
          ) : loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Starting...
            </>
          ) : success ? (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2 text-primary" />
              Measurements Ready
            </>
          ) : (
            <>
              <Crosshair className="h-4 w-4 mr-2" />
              AI Measurements
            </>
          )}
        </Button>

        {/* Re-analyze button - only shows when verified coordinates exist */}
        {hasVerifiedCoords && !loading && !success && !isJobRunning && (
          <Button
            onClick={handleReanalyze}
            disabled={buttonDisabled}
            variant="ghost"
            size="sm"
            title="Re-run analysis using stored verified coordinates"
          >
            <Loader2 className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : 'hidden'}`} />
            <span className="text-xs">🔄 Re-analyze</span>
          </Button>
        )}

        {/* Draw Manually button */}
        <Button
          onClick={handleOpenManualTool}
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Pencil className="h-4 w-4 mr-1" />
          Draw
        </Button>

        {success && (
          <Badge variant="outline" className="text-green-600 border-green-600">
            ✓ Tags Ready
          </Badge>
        )}
      </div>

      {/* Structure Selection Map for PIN placement - uses unified coordinates */}
      <StructureSelectionMap
        open={showStructureSelector}
        onOpenChange={setShowStructureSelector}
        initialLat={verifiedCoords?.lat ?? lat}
        initialLng={verifiedCoords?.lng ?? lng}
        address={address}
        onLocationConfirmed={handleStructureConfirmed}
      />

      {/* Full Report Preview - auto-opens after AI analysis */}
      {verificationData && (
        <RoofrStyleReportPreview
          open={showReportPreview}
          onOpenChange={(open) => {
            if (!open) {
              handleCloseReport();
            }
          }}
          measurementId={verificationData.measurement?.id}
          measurement={verificationData.measurement}
          tags={verificationData.tags}
          address={address || 'Property'}
          pipelineEntryId={propertyId}
          satelliteImageUrl={verificationData.satelliteImageUrl}
          companyInfo={companyInfo || { name: 'PITCH CRM' }}
          onReportGenerated={handleReportGenerated}
        />
      )}

      {/* Edge-by-edge Verification Wizard — auto-opens after AI completes */}
      <EdgeConfirmationWizard
        open={showVerifyWizard}
        onOpenChange={setShowVerifyWizard}
        pipelineEntryId={propertyId}
        initialEdges={seedEdges}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['measurement-approvals', propertyId] });
          queryClient.invalidateQueries({ queryKey: ['measurement-context', propertyId] });
          queryClient.invalidateQueries({ queryKey: ['ai-measurements', propertyId] });
          onSuccess?.({}, {});
        }}
      />
    </>
  );
}
