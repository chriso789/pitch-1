import { useState, useCallback } from 'react';
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

    // Check if coordinates are from verified source
    if (freshCoords.source !== 'contact_verified_address' && freshCoords.source !== 'user_pin_selection') {
      toast({
        title: "Address Verification Recommended",
        description: `Using ${freshCoords.source} coordinates. For best accuracy, verify the address via Google Places first.`,
        variant: "default"
      });
    }

    console.log('📍 Opening structure selector with fresh coords:', { 
      lat: freshCoords.lat, 
      lng: freshCoords.lng, 
      source: freshCoords.source 
    });
    setShowStructureSelector(true);
  }, [loadCoordinates, toast]);

  // Run AI analysis with the confirmed coordinates from PIN selection
  async function handlePull(confirmedLat: number, confirmedLng: number) {
    const pullLat = confirmedLat;
    const pullLng = confirmedLng;

    // Validate coordinates before attempting pull
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

    // 📊 Performance Monitoring: Start timing
    const pullStartTime = Date.now();
    const REQUEST_TIMEOUT_MS = 300000; // 300 second frontend timeout (matches backend wall_clock_limit)
    console.log('⏱️ AI Measurement analysis started:', { 
      propertyId, 
      pullLat, 
      pullLng, 
      timestamp: new Date().toISOString() 
    });

    // Create abort controller for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn('⏱️ Frontend timeout triggered after', REQUEST_TIMEOUT_MS, 'ms');
      abortController.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      // Get current user for the request
      const { data: { user } } = await supabase.auth.getUser();

      // User has already confirmed the PIN location, so we use those coordinates directly
      console.log('📍 Using user-selected PIN coordinates:', { pullLat, pullLng });

      toast({
        title: "Measuring Roof",
        description: "Analyzing with Solar data...",
      });

      // 🚀 Call the analyze-roof-aerial edge function with abort signal
      const invokePromise = supabase.functions.invoke('analyze-roof-aerial', {
        body: {
          address: address || 'Unknown Address',
          coordinates: { lat: pullLat, lng: pullLng },
          customerId: propertyId,
          userId: user?.id
        }
      });
      
      // Race against timeout
      const { data, error } = await Promise.race([
        invokePromise,
        new Promise<never>((_, reject) => {
          abortController.signal.addEventListener('abort', () => {
            reject(new Error('Request timeout - AI analysis took too long'));
          });
        })
      ]);

      if (error) {
        console.error('Edge function error:', error);
        throw error;
      }
      
      if (!data?.success) {
        // Check for specific error types
        if (data?.error?.includes('OPENAI') || data?.error?.includes('API key')) {
          toast({
            title: "API Key Missing",
            description: "OpenAI API key not configured. Contact your administrator.",
            variant: "destructive"
          });
          setLoading(false);
          return;
        }
        throw new Error(data?.error || 'AI analysis failed');
      }
      
      // 📊 Performance Monitoring: Record pull time
      const pullEndTime = Date.now();
      const pullDuration = pullEndTime - pullStartTime;
      console.log(`⏱️ AI analysis completed in ${pullDuration}ms`, {
        propertyId,
        duration: pullDuration,
        target: 15000,
        status: pullDuration < 15000 ? 'PASS' : 'SLOW',
        confidence: data.data?.confidence?.score
      });

      // Transform new format to legacy format for backward compatibility
      const { measurement, tags } = transformNewMeasurementToLegacyFormat(data.data);
      measurement.id = data.measurementId;

      // Get satellite image URL from the new system
      let satelliteImageUrl: string | undefined = 
        data.data?.images?.mapbox?.url || 
        data.data?.images?.google?.url;

      // If no satellite image from the new system, try Google Maps fallback
      if (!satelliteImageUrl) {
        console.log('No satellite image from AI system, using Google Maps fallback');
        
        const cacheKey = `gmaps_sat_${pullLat.toFixed(6)}_${pullLng.toFixed(6)}_z20`;
        const cachedImageUrl = imageCache.getImage(cacheKey);
        
        if (cachedImageUrl) {
          satelliteImageUrl = cachedImageUrl;
          console.log('[Image Cache] ✅ Cache HIT');
        } else {
          try {
            const { data: imageData, error: imageError } = await supabase.functions.invoke('google-maps-proxy', {
              body: { 
                endpoint: 'satellite',
                params: {
                  center: `${pullLat},${pullLng}`,
                  zoom: '21',
                  size: '1280x1280',
                  maptype: 'satellite',
                  scale: '2'
                }
              }
            });

            if (!imageError && imageData?.image_url) {
              satelliteImageUrl = imageData.image_url;
              imageCache.setImage(cacheKey, satelliteImageUrl);
            } else if (!imageError && imageData?.image) {
              satelliteImageUrl = `data:image/png;base64,${imageData.image}`;
              imageCache.setImage(cacheKey, satelliteImageUrl);
            }
          } catch (imgError) {
            console.error('Failed to fetch satellite image:', imgError);
          }
        }
      }

      // Store final coords for report preview
      const finalCoords = { lat: pullLat, lng: pullLng };

      // Fetch company info for report branding
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', currentUser.id)
          .single();
        
        if (profileData?.tenant_id) {
          const { data: tenantData } = await supabase
            .from('tenants')
            .select('name, logo_url, phone, email, license_number')
            .eq('id', profileData.tenant_id)
            .single();
          
          if (tenantData) {
            setCompanyInfo({
              name: tenantData.name,
              logo: tenantData.logo_url || undefined,
              phone: tenantData.phone || undefined,
              email: tenantData.email || undefined,
              license: tenantData.license_number || undefined,
            });
          }
        }
      }

      // Show full report preview (instead of verification dialog)
      setVerificationData({ measurement, tags, satelliteImageUrl, finalCoords });
      setShowReportPreview(true);
      
      // CRITICAL: Reset loading state immediately when showing preview
      // This prevents "stuck spinner" bug where loading persists
      setLoading(false);
      
      // CRITICAL: Invalidate ALL measurement caches immediately so UI refreshes
      // This ensures diagram, summary panel, and estimate builder all update
      queryClient.invalidateQueries({ queryKey: ['measurement-approvals', propertyId] });
      queryClient.invalidateQueries({ queryKey: ['ai-measurements', propertyId] });
      queryClient.invalidateQueries({ queryKey: ['measurement-context', propertyId] });
      queryClient.invalidateQueries({ queryKey: ['roof-measurement'] });
      queryClient.invalidateQueries({ queryKey: ['roof-measurement-edges'] });
      queryClient.invalidateQueries({ queryKey: ['measurement-facets'] });
      queryClient.invalidateQueries({ queryKey: ['active-measurement', propertyId] });
      
      // Show confidence-based toast with performance info
      const confidenceScore = data.data?.confidence?.score || 0;
      const confidenceRating = data.data?.confidence?.rating || 'unknown';
      const performanceData = data.data?.performance;
      const footprintData = data.data?.footprint;
      
      // Format path and timing info
      const pathUsed = performanceData?.path_used === 'solar_fast_path' ? '⚡ Fast Path' : '🔍 AI Analysis';
      const totalTimeSeconds = performanceData?.timings_ms?.total 
        ? (performanceData.timings_ms.total / 1000).toFixed(1) 
        : (pullDuration / 1000).toFixed(1);
      const footprintSource = footprintData?.source || performanceData?.footprint_source || 'unknown';
      
      // Format footprint source for display
      const footprintLabel = {
        'mapbox_vector': '📍 Mapbox Vector',
        'google_solar_api': '🌞 Solar API',
        'regrid_parcel': '🗺️ Regrid',
        'solar_bbox_fallback': '⚠️ Solar BBox',
        'ai_detection': '🤖 AI Detection'
      }[footprintSource] || footprintSource;
      
      toast({
        title: "🎯 AI Measurements Complete",
        description: (
          <div className="space-y-1">
            <p>Confidence: {confidenceScore}% ({confidenceRating})</p>
            <p className="text-muted-foreground text-xs">
              {measurement.summary?.total_squares?.toFixed(1)} squares • {pathUsed} • {totalTimeSeconds}s
            </p>
            <p className="text-xs text-muted-foreground">
              Footprint: {footprintLabel}
            </p>
          </div>
        ),
      });

    } catch (err: any) {
      console.error('AI measurement analysis error:', err);
      
      // Determine user-friendly error message based on error type
      let title = "Analysis Failed";
      let description = err.message || "Could not analyze roof. Try manual mode.";
      
      if (err.message?.includes('RATE_LIMIT') || err.message?.includes('429')) {
        title = "Rate Limit Reached";
        description = "Too many requests. Please wait a moment and try again.";
      } else if (err.message?.includes('PAYMENT_REQUIRED') || err.message?.includes('402')) {
        title = "Credits Exhausted";
        description = "AI credits are depleted. Please contact your administrator.";
      } else if (err.message?.includes('timeout') || err.message?.includes('aborted')) {
        title = "Request Timeout";
        description = "Analysis took too long. Please try again.";
      } else if (err.message?.includes('Failed to fetch') || err.message?.includes('network')) {
        title = "Connection Error";
        description = "Could not connect to AI service. Check your internet connection.";
      }
      
      toast({
        title,
        description,
        variant: "destructive",
      });
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

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

    onSuccess?.(finalMeasurement, finalTags);

    // Reset success state after 3 seconds
    setTimeout(() => setSuccess(false), 3000);
  };

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
  const handleStructureConfirmed = (selectedLat: number, selectedLng: number) => {
    setShowStructureSelector(false);
    toast({
      title: "📍 Structure Selected",
      description: "Now pulling measurements for the selected building...",
    });
    // Immediately trigger pull with confirmed coordinates
    handlePull(selectedLat, selectedLng);
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

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Main AI Measurements button - opens structure selector first */}
        <Button
          onClick={handleOpenStructureSelector}
          disabled={loading || loadingCoords}
          variant="outline"
          size="sm"
        >
          {loadingCoords ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading...
            </>
          ) : loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              AI Analyzing...
            </>
          ) : success ? (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
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
        {hasVerifiedCoords && !loading && !success && (
          <Button
            onClick={handleReanalyze}
            disabled={loading || loadingCoords}
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
    </>
  );
}
