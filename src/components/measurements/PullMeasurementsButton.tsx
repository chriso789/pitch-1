import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { calculateImageBounds } from '@/utils/gpsCalculations';
import { Loader2, CheckCircle2, Pencil, Crosshair } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useImageCache } from '@/contexts/ImageCacheContext';
import { StructureSelectionMap } from './StructureSelectionMap';
import { useMeasurementCoordinates } from '@/hooks/useMeasurementCoordinates';
import { RoofrStyleReportPreview } from './RoofrStyleReportPreview';
import { triggerAutomation, AUTOMATION_EVENTS } from '@/lib/automations/triggerAutomation';
import { useMeasurementJob } from '@/hooks/useMeasurementJob';
import { EdgeConfirmationWizard } from './EdgeConfirmationWizard';
import type { PlanEdge, EdgeType, AerialBackground } from './DimensionedPlanDrawing';

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

function getLiveAerialImageUrl(lat: number, lng: number, zoom = 20, width = 640, height = 640) {
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapboxToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  if (googleKey) {
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&scale=2&maptype=satellite&key=${googleKey}`;
  }

  if (mapboxToken) {
    return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom}/${width}x${height}@2x?access_token=${mapboxToken}`;
  }

  if (supabaseUrl) {
    return `${supabaseUrl}/functions/v1/satellite-tile?lat=${lat}&lng=${lng}&zoom=${zoom}&size=${Math.max(width, height)}`;
  }

  return null;
}

function normalizeAerialBounds(input: any): [number, number, number, number] | null {
  if (!input) return null;

  if (Array.isArray(input) && input.length === 4) {
    const values = input.map(Number);
    if (values.every(Number.isFinite)) {
      return values as [number, number, number, number];
    }
  }

  if (input?.topLeft && input?.bottomRight) {
    const west = Number(input.topLeft.lng);
    const north = Number(input.topLeft.lat);
    const east = Number(input.bottomRight.lng);
    const south = Number(input.bottomRight.lat);
    if ([west, south, east, north].every(Number.isFinite)) {
      return [west, south, east, north];
    }
  }

  return null;
}

function computeStaticAerialBounds(lat: number, lng: number, zoom = 20, width = 640, height = 640): [number, number, number, number] {
  const bounds = calculateImageBounds(lat, lng, zoom, width, height);
  return [bounds.topLeft.lng, bounds.bottomLeft.lat, bounds.topRight.lng, bounds.topLeft.lat];
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
  const [verificationReady, setVerificationReady] = useState(false);
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
  const [seedAerial, setSeedAerial] = useState<AerialBackground | null>(null);
  const [seedFootprint, setSeedFootprint] = useState<Array<[number, number]> | undefined>(undefined);
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
    setVerificationReady(false);

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

      // Fetch the latest AI measurement to validate it exists, but do not auto-open
      // the heavy verification/report UI after completion. Users can open the report
      // from the latest measurement card; auto-opening was causing blank-page crashes.
      (async () => {
        try {
          const { data } = await supabase
            .from('roof_measurements')
            .select(`
              id, requires_manual_review,
              total_ridge_length, total_hip_length, total_valley_length, total_eave_length, total_rake_length,
              linear_features_wkt, perimeter_wkt, footprint_vertices_geo,
              mapbox_image_url, google_maps_image_url, satellite_overlay_url,
              gps_coordinates, analysis_zoom, analysis_image_size, image_bounds
            `)
            .eq('customer_id', propertyId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          // Gate-aware UX: auto-ship if 3% accuracy gate passed; only prompt
          // for edge verification if the measurement was flagged for manual review.
          const gateFailed = Boolean((data as any)?.requires_manual_review);
          setVerificationReady(gateFailed);
          if (gateFailed) {
            toast({
              title: "⚠️ Verify Edges — Accuracy Gate Failed",
              description: "Confirm each edge to lock in the measurement.",
            });
          } else {
            toast({
              title: "✅ AI Measurement Complete",
              description: "Accuracy gate passed — measurement is ready to use.",
            });
          }

          let seeds: PlanEdge[] = [];
          let footprintGeo: Array<[number, number]> | undefined;
          let aerial: AerialBackground | null = null;

          // 1) Parse linear_features_wkt → real geo-anchored edges
          const features: Array<{ wkt: string; type: string; length_ft: number }> =
            Array.isArray(data?.linear_features_wkt) ? (data!.linear_features_wkt as any[]) : [];

          const parseLineString = (wkt: string): Array<[number, number]> | null => {
            const m = wkt?.match(/LINESTRING\s*\(([^)]+)\)/i);
            if (!m) return null;
            return m[1].split(',').map(pair => {
              const [lng, lat] = pair.trim().split(/\s+/).map(Number);
              return [lng, lat] as [number, number];
            });
          };

          // Helper: convert lng/lat → relative feet (equirectangular projection
          // around the local centroid — accurate for parcel-size areas).
          const FT_PER_DEG_LAT = 364000; // ≈ feet
          const allGeoPts: Array<[number, number]> = [];
          features.forEach(f => {
            const pts = parseLineString(f.wkt);
            if (pts && pts.length >= 2) allGeoPts.push(...pts);
          });

          // 2) Parse footprint vertices
          const fp = data?.footprint_vertices_geo as any;
          if (Array.isArray(fp) && fp.length >= 3) {
            footprintGeo = fp
              .map((v: any) => [Number(v.lng ?? v[0]), Number(v.lat ?? v[1])] as [number, number])
              .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
            allGeoPts.push(...footprintGeo);
          }

          // Compute geographic bounds from all points
          let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
          allGeoPts.forEach(([lng, lat]) => {
            if (lng < west) west = lng;
            if (lng > east) east = lng;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
          });

          const centerLat = Number.isFinite(south) ? (south + north) / 2 : (data?.gps_coordinates as any)?.lat ?? lat;
          const ftPerDegLng = Math.cos((centerLat * Math.PI) / 180) * FT_PER_DEG_LAT;

          const geoToFt = (lng: number, lat: number): [number, number] => [
            (lng - west) * ftPerDegLng,
            (north - lat) * FT_PER_DEG_LAT, // y grows downward
          ];

          // Build PlanEdges from geo features
          features.forEach((f, i) => {
            const pts = parseLineString(f.wkt);
            if (!pts || pts.length < 2) return;
            const a = pts[0];
            const b = pts[pts.length - 1];
            const type = (['ridge', 'hip', 'valley', 'eave', 'rake'].includes(f.type) ? f.type : 'eave') as EdgeType;
            seeds.push({
              id: `geo-${i}`,
              type,
              p1: geoToFt(a[0], a[1]),
              p2: geoToFt(b[0], b[1]),
              geo_p1: a,
              geo_p2: b,
              length_ft: Number(f.length_ft) || Math.hypot(geoToFt(b[0], b[1])[0] - geoToFt(a[0], a[1])[0], geoToFt(b[0], b[1])[1] - geoToFt(a[0], a[1])[1]),
              confirmed: false,
            });
          });

          // 3) Fallback: synthetic edges from totals if no WKT features
          if (seeds.length === 0 && data) {
            const addRun = (type: EdgeType, total: number) => {
              const len = Number(total) || 0;
              if (len <= 0) return;
              seeds.push({
                id: `ai-${type}-${seeds.length}`,
                type,
                p1: [0, seeds.length * 8],
                p2: [len, seeds.length * 8],
                length_ft: len,
                confirmed: false,
              });
            };
            addRun('eave', data.total_eave_length || 0);
            addRun('rake', data.total_rake_length || 0);
            addRun('ridge', data.total_ridge_length || 0);
            addRun('hip', data.total_hip_length || 0);
            addRun('valley', data.total_valley_length || 0);
          }

          // 4) Build aerial background. If the DB row missed the cached URL,
          // fetch a live static aerial because existing properties should still render.
          const size = (data?.analysis_image_size as any) || { width: 640, height: 640 };
          const logicalWidth = Number(size.logicalWidth || (size.width && size.rasterScale ? size.width / size.rasterScale : size.width)) || 640;
          const logicalHeight = Number(size.logicalHeight || (size.height && size.rasterScale ? size.height / size.rasterScale : size.height)) || 640;
          const zoom = Number(data?.analysis_zoom) || 20;
          const fallbackLat = Number((data?.gps_coordinates as any)?.lat ?? lat);
          const fallbackLng = Number((data?.gps_coordinates as any)?.lng ?? lng);
          const imageUrl = data?.mapbox_image_url || data?.satellite_overlay_url || data?.google_maps_image_url || getLiveAerialImageUrl(
            fallbackLat,
            fallbackLng,
            zoom,
            logicalWidth,
            logicalHeight,
          );

          let bounds = normalizeAerialBounds((data as any)?.image_bounds);
          if (!bounds && Number.isFinite(west) && Number.isFinite(east) && allGeoPts.length > 0) {
            const lngPad = Math.max((east - west) * 0.15, 0.0002);
            const latPad = Math.max((north - south) * 0.15, 0.0002);
            bounds = [west - lngPad, south - latPad, east + lngPad, north + latPad];
          }
          if (!bounds && Number.isFinite(fallbackLat) && Number.isFinite(fallbackLng)) {
            bounds = computeStaticAerialBounds(
              fallbackLat,
              fallbackLng,
              zoom,
              logicalWidth,
              logicalHeight,
            );
          }

          if (imageUrl && bounds) {
            aerial = {
              imageUrl,
              imageWidth: logicalWidth,
              imageHeight: logicalHeight,
              bounds,
            };
          }

          // Structured diagnostic log so we can trace why imagery may be missing/incomplete
          const urlSource = data?.mapbox_image_url
            ? 'db.mapbox_image_url'
            : data?.satellite_overlay_url
              ? 'db.satellite_overlay_url'
              : data?.google_maps_image_url
                ? 'db.google_maps_image_url'
                : 'live-fallback';
          const boundsSource = normalizeAerialBounds((data as any)?.image_bounds)
            ? 'db.image_bounds'
            : (Number.isFinite(west) && Number.isFinite(east) && allGeoPts.length > 0)
              ? 'derived-from-wkt'
              : 'computed-static';
          console.info('[verify-wizard][aerial]', {
            propertyId,
            measurementId: (data as any)?.id ?? null,
            lat: fallbackLat,
            lng: fallbackLng,
            zoom,
            size: { width: logicalWidth, height: logicalHeight },
            urlSource,
            imageUrl: imageUrl ? String(imageUrl).slice(0, 140) + (String(imageUrl).length > 140 ? '…' : '') : null,
            boundsSource,
            bounds,
            seededEdges: seeds.length,
            footprintVertices: footprintGeo?.length ?? 0,
            aerialReady: Boolean(imageUrl && bounds),
            missing: {
              imageUrl: !imageUrl,
              bounds: !bounds,
              dbMapboxUrl: !data?.mapbox_image_url,
              dbBounds: !((data as any)?.image_bounds),
              dbWkt: !((data as any)?.linear_features_wkt),
            },
          });

          setSeedEdges(seeds.length > 0 ? seeds : undefined);
          setSeedFootprint(footprintGeo);
          setSeedAerial(aerial);
        } catch (e) {
          console.warn('Could not seed verify wizard from AI measurement:', e);
          setSeedEdges(undefined);
          setSeedAerial(null);
          setSeedFootprint(undefined);
        } finally {
          setShowVerifyWizard(false);
        }
      })();
    } else if (job.status === 'failed' && prevJobStatus !== 'failed') {
      setShouldNotifyJobStatus(false);
      setVerificationReady(false);
      const errMsg = job.error || "AI measurement could not complete.";
      const isInternalReview = /internal review|needs_internal_review/i.test(errMsg);
      toast({
        title: isInternalReview ? "Flagged for Internal Review" : "Analysis Failed",
        description: isInternalReview
          ? "Roof slopes could not be reliably segmented from satellite imagery. This property has been flagged for internal review — no customer-facing report will be generated."
          : errMsg,
        variant: isInternalReview ? "default" : "destructive",
      });
    }
    
    setPrevJobStatus(job.status);
  }, [job, lat, lng, prevJobStatus, propertyId, queryClient, shouldNotifyJobStatus, toast, trackedJobId]);

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

        {(success || verificationReady) && (
          <>
            <Button
              onClick={() => setShowVerifyWizard(true)}
              variant="default"
              size="sm"
              title="Walk through each edge to confirm the AI measurement"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Verify Edges
            </Button>
            <Badge variant="outline" className="text-green-600 border-green-600">
              ✓ Tags Ready
            </Badge>
          </>
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
        aerial={seedAerial}
        footprintGeo={seedFootprint}
        onRerunMeasurement={() => {
          setShowVerifyWizard(false);
          handleOpenStructureSelector();
        }}
        onSaved={() => {
          setVerificationReady(false);
          queryClient.invalidateQueries({ queryKey: ['measurement-approvals', propertyId] });
          queryClient.invalidateQueries({ queryKey: ['measurement-context', propertyId] });
          queryClient.invalidateQueries({ queryKey: ['ai-measurements', propertyId] });
          onSuccess?.({}, {});
        }}
      />
    </>
  );
}
