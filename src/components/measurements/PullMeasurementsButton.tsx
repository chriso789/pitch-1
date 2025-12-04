import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, Pencil, Brain, MapPin, Crosshair } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { MeasurementVerificationDialog } from './MeasurementVerificationDialog';
import { useImageCache } from '@/contexts/ImageCacheContext';
import { StructureSelectionMap } from './StructureSelectionMap';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

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
  const { measurements, aiAnalysis, confidence, images } = newData;
  
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
      wkt: null,
    })) || [],
    linear_features: measurements?.linear || {
      ridge: 0,
      hip: 0,
      valley: 0,
      eave: 0,
      rake: 0,
    },
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
    },
    // AI-specific fields
    aiAnalysis: aiAnalysis || null,
    confidence: confidence || null,
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
  const [customCoords, setCustomCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [verificationData, setVerificationData] = useState<{
    measurement: any;
    tags: Record<string, any>;
    satelliteImageUrl?: string;
    finalCoords?: { lat: number; lng: number };
  } | null>(null);
  const [showVerificationDialog, setShowVerificationDialog] = useState(false);

  async function handlePull(useCustomCoords = false) {
    // Use custom coordinates if provided (from structure selection PIN)
    let pullLat = useCustomCoords && customCoords ? customCoords.lat : lat;
    let pullLng = useCustomCoords && customCoords ? customCoords.lng : lng;

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
    console.log('⏱️ AI Measurement analysis started:', { 
      propertyId, 
      pullLat, 
      pullLng, 
      useCustomCoords,
      timestamp: new Date().toISOString() 
    });

    try {
      // Get current user for the request
      const { data: { user } } = await supabase.auth.getUser();

      // Skip coordinate validation if user manually selected structure via PIN
      if (!useCustomCoords) {
        // ✅ Coordinate Validation: Check against verified address from contacts table (PRIORITY #1)
        const { data: pipelineData } = await supabase
          .from('pipeline_entries')
          .select('contact_id, metadata, contacts!inner(verified_address, latitude, longitude)')
          .eq('id', propertyId)
          .single();

        const contact = (pipelineData as any)?.contacts;
        const verifiedAddress = contact?.verified_address;
        const verifiedLat = (verifiedAddress?.lat || contact?.latitude) as number | undefined;
        const verifiedLng = (verifiedAddress?.lng || contact?.longitude) as number | undefined;

        if (verifiedLat && verifiedLng) {
          // Calculate distance using haversine formula
          const R = 6371e3; // Earth radius in meters
          const φ1 = (verifiedLat * Math.PI) / 180;
          const φ2 = (pullLat * Math.PI) / 180;
          const Δφ = ((pullLat - verifiedLat) * Math.PI) / 180;
          const Δλ = ((pullLng - verifiedLng) * Math.PI) / 180;

          const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = R * c; // Distance in meters

          console.log('🎯 Coordinate validation:', {
            pullCoords: { lat: pullLat, lng: pullLng },
            verifiedCoords: { lat: verifiedLat, lng: verifiedLng },
            distance: `${Math.round(distance)}m`,
            threshold: '30m',
            status: distance > 30 ? '⚠️ MISMATCH' : '✅ OK'
          });

          if (distance > 30) {
            toast({
              title: "⚠️ Coordinate Mismatch Detected",
              description: (
                <div className="space-y-2 text-sm">
                  <p>Pull coordinates are {Math.round(distance)}m from verified address.</p>
                  <p className="text-muted-foreground">
                    Using verified address coordinates ({verifiedLat.toFixed(6)}, {verifiedLng.toFixed(6)}) instead.
                  </p>
                </div>
              ),
              variant: "default",
              duration: 7000,
            });

            // Override with verified coordinates
            pullLat = verifiedLat;
            pullLng = verifiedLng;
            console.log('✅ Coordinates corrected to verified address');
          }
        } else {
          console.warn('⚠️ No verified address found in metadata - proceeding with provided coordinates');
        }
      } else {
        console.log('📍 Using user-selected PIN coordinates:', { pullLat, pullLng });
      }

      toast({
        title: useCustomCoords ? "📍 Measuring Selected Structure" : "🤖 AI Analysis Started",
        description: "Analyzing roof with GPT-4 Vision + Google Solar API...",
      });

      // 🚀 Call the NEW analyze-roof-aerial edge function
      const { data, error } = await supabase.functions.invoke('analyze-roof-aerial', {
        body: {
          address: address || 'Unknown Address',
          coordinates: { lat: pullLat, lng: pullLng },
          customerId: propertyId,
          userId: user?.id
        }
      });

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
                  zoom: '20',
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

      // Store final coords for verification dialog
      const finalCoords = { lat: pullLat, lng: pullLng };

      // Show verification dialog
      setVerificationData({ measurement, tags, satelliteImageUrl, finalCoords });
      setShowVerificationDialog(true);
      
      // Show confidence-based toast
      const confidenceScore = data.data?.confidence?.score || 0;
      const confidenceRating = data.data?.confidence?.rating || 'unknown';
      
      toast({
        title: "🎯 AI Measurements Complete",
        description: (
          <div className="space-y-1">
            <p>Confidence: {confidenceScore}% ({confidenceRating})</p>
            <p className="text-muted-foreground text-xs">
              {measurement.summary?.total_squares?.toFixed(1)} squares detected
            </p>
          </div>
        ),
      });

    } catch (err: any) {
      console.error('AI measurement analysis error:', err);
      toast({
        title: "Analysis Failed",
        description: err.message || "Could not analyze roof. Try manual mode.",
        variant: "destructive",
      });
    } finally {
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

  const handleRejectMeasurements = () => {
    setVerificationData(null);
    setShowVerificationDialog(false);
    toast({
      title: "Measurements Rejected",
      description: "Pull measurements again or enter manually",
      variant: "destructive"
    });
  };

  const handleOpenManualTool = () => {
    const params = new URLSearchParams();
    if (lat) params.set('lat', lat.toString());
    if (lng) params.set('lng', lng.toString());
    if (address) params.set('address', address);
    navigate(`/roof-measure/${propertyId}?${params.toString()}`);
  };

  // Handle structure selection from PIN map
  const handleStructureConfirmed = (selectedLat: number, selectedLng: number) => {
    setCustomCoords({ lat: selectedLat, lng: selectedLng });
    toast({
      title: "📍 Structure Selected",
      description: "Now pulling measurements for the selected building...",
    });
    // Immediately trigger pull with custom coordinates
    setTimeout(() => handlePull(true), 100);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              disabled={loading}
              variant="outline"
              size="sm"
              className="w-full"
            >
              {loading ? (
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
                  <Brain className="h-4 w-4 mr-2" />
                  AI Measurements
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={() => handlePull(false)} disabled={loading}>
              <Brain className="h-4 w-4 mr-2" />
              AI Analysis (Auto)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowStructureSelector(true)} disabled={loading}>
              <Crosshair className="h-4 w-4 mr-2" />
              Select Structure First
              <span className="ml-auto text-xs text-muted-foreground">PIN</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleOpenManualTool}>
              <Pencil className="h-4 w-4 mr-2" />
              Draw Manually
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {success && (
          <Badge variant="outline" className="text-green-600 border-green-600">
            ✓ Tags Ready
          </Badge>
        )}
      </div>

      {/* Structure Selection Map for PIN placement */}
      <StructureSelectionMap
        open={showStructureSelector}
        onOpenChange={setShowStructureSelector}
        initialLat={lat}
        initialLng={lng}
        address={address}
        onLocationConfirmed={handleStructureConfirmed}
      />

      {/* Verification Dialog */}
      {verificationData && (
        <MeasurementVerificationDialog
          open={showVerificationDialog}
          onOpenChange={(open) => {
            setShowVerificationDialog(open);
            if (!open) {
              // Clear verification data when dialog is closed
              setVerificationData(null);
            }
          }}
          measurement={verificationData.measurement}
          tags={verificationData.tags}
          satelliteImageUrl={verificationData.satelliteImageUrl}
          centerLat={verificationData.finalCoords?.lat || lat}
          centerLng={verificationData.finalCoords?.lng || lng}
          pipelineEntryId={propertyId}
          onAccept={handleAcceptMeasurements}
          onReject={handleRejectMeasurements}
        />
      )}
    </>
  );
}
