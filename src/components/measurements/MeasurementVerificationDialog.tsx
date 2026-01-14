import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2, Edit3, X, Satellite, AlertCircle, RefreshCw, Home, ArrowRight as ArrowRightIcon, ChevronDown, ChevronRight, Split, Info, MapPin, ZoomIn, Maximize2, Minimize2, ImageIcon, History, FileText, Trash2, AlertTriangle, Sparkles, Loader2, Pencil } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PolygonEditor } from './PolygonEditor';
import { ComprehensiveMeasurementOverlay } from './ComprehensiveMeasurementOverlay';
import { ManualMeasurementEditor } from './ManualMeasurementEditor';
import { FacetSplitterOverlay } from './FacetSplitterOverlay';
import { SchematicRoofDiagram } from './SchematicRoofDiagram';
import { RoofTracerOverlay } from './RoofTracerOverlay';
import { MeasurementTracePanel } from './MeasurementTracePanel';
import { MeasurementSystemLimitations } from '@/components/documentation/MeasurementSystemLimitations';
import { ImageryAgeWarning } from './ImageryAgeWarning';
import { HistoricalImageryComparison } from './HistoricalImageryComparison';
import { MeasurementValidationReport } from './MeasurementValidationReport';
import { ObstructionDetectionWarning } from './ObstructionDetectionWarning';
import { parseWKTPolygon, calculatePolygonAreaSqft, calculatePerimeterFt } from '@/utils/geoCoordinates';
import { useManualVerification, useRepullMeasurement } from '@/hooks/useMeasurement';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { detectRoofType } from '@/utils/measurementGeometry';
import { saveMeasurementWithOfflineSupport } from '@/services/offlineMeasurementSync';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { EagleViewStyleReport } from './EagleViewStyleReport';
import { MeasurementDebugPanel } from './MeasurementDebugPanel';

// Industry-standard roof pitch multipliers: slope_factor = sqrt(1 + (X/12)^2)
const PITCH_MULTIPLIERS: Record<string, number> = {
  'flat': 1.0000,
  '1/12': 1.0035,
  '2/12': 1.0138,
  '3/12': 1.0308,
  '4/12': 1.0541,
  '5/12': 1.0833,
  '6/12': 1.1180,
  '7/12': 1.1577,
  '8/12': 1.2019,
  '9/12': 1.2500,
  '10/12': 1.3017,
  '11/12': 1.3566,
  '12/12': 1.4142,
};

// Resolution options for satellite imagery
type ResolutionOption = 'standard' | 'hd' | 'ultra';
const RESOLUTION_CONFIG: Record<ResolutionOption, { width: number; height: number; label: string }> = {
  standard: { width: 640, height: 500, label: 'Standard' },
  hd: { width: 1280, height: 1000, label: 'HD' },
  ultra: { width: 1920, height: 1500, label: 'Ultra HD' },
};

// Parse linear_features from array format (database) or object format (API)
// FIX: Prioritize DATABASE values first (most reliable), then tags, then measurement prop
// FIX: Use explicit > 0 checks instead of truthy to distinguish between 0 and undefined
const extractLinearFeatures = (
  measurement: any, 
  dbMeasurement: any, 
  tags: Record<string, any>
): { ridge: number; hip: number; valley: number; eave: number; rake: number; step: number; perimeter: number } => {
  // Helper to sum array by type (database stores linear_features as array)
  const sumArrayByType = (features: any[], type: string): number => {
    if (!Array.isArray(features)) return 0;
    return features
      .filter(f => f.type?.toLowerCase() === type.toLowerCase())
      .reduce((sum, f) => sum + (f.length_ft || f.length || 0), 0);
  };
  
  // Helper to check if a value is valid (not undefined/null and > 0 for positive values, or explicitly 0)
  const isValidValue = (val: any): val is number => {
    return val !== undefined && val !== null && typeof val === 'number';
  };
  
  // Helper to get a positive value (returns value if > 0, otherwise checks next source)
  const getPositiveValue = (val: any): number | null => {
    if (isValidValue(val) && val > 0) return val;
    return null;
  };
  
  const dbLinear = dbMeasurement?.linear_features;
  const mLinear = measurement?.linear_features;
  
  // FIXED PRIORITY ORDER: Database first (most reliable), then tags, then measurement prop
  const getRidge = () => {
    // Priority 1: Database summary (most reliable - verified data)
    const dbSummary = getPositiveValue(dbMeasurement?.summary?.ridge_ft);
    if (dbSummary !== null) return dbSummary;
    
    // Priority 2: Tags from fresh API call (only if > 0)
    const tagValue = getPositiveValue(tags['lf.ridge']);
    if (tagValue !== null) return tagValue;
    
    // Priority 3: Measurement prop summary
    const mSummary = getPositiveValue(measurement?.summary?.ridge_ft);
    if (mSummary !== null) return mSummary;
    
    // Priority 4: Parse from database linear_features array
    if (Array.isArray(dbLinear)) {
      const arrValue = sumArrayByType(dbLinear, 'ridge');
      if (arrValue > 0) return arrValue;
    }
    
    // Priority 5: Parse from measurement linear_features array
    if (Array.isArray(mLinear)) {
      const arrValue = sumArrayByType(mLinear, 'ridge');
      if (arrValue > 0) return arrValue;
    }
    
    // Priority 6: Object format fallbacks
    if (typeof mLinear === 'object' && !Array.isArray(mLinear) && isValidValue(mLinear?.ridge) && mLinear.ridge > 0) return mLinear.ridge;
    if (typeof dbLinear === 'object' && !Array.isArray(dbLinear) && isValidValue(dbLinear?.ridge) && dbLinear.ridge > 0) return dbLinear.ridge;
    
    return 0;
  };
  
  const getHip = () => {
    const dbSummary = getPositiveValue(dbMeasurement?.summary?.hip_ft);
    if (dbSummary !== null) return dbSummary;
    
    const tagValue = getPositiveValue(tags['lf.hip']);
    if (tagValue !== null) return tagValue;
    
    const mSummary = getPositiveValue(measurement?.summary?.hip_ft);
    if (mSummary !== null) return mSummary;
    
    if (Array.isArray(dbLinear)) {
      const arrValue = sumArrayByType(dbLinear, 'hip');
      if (arrValue > 0) return arrValue;
    }
    if (Array.isArray(mLinear)) {
      const arrValue = sumArrayByType(mLinear, 'hip');
      if (arrValue > 0) return arrValue;
    }
    if (typeof mLinear === 'object' && !Array.isArray(mLinear) && isValidValue(mLinear?.hip) && mLinear.hip > 0) return mLinear.hip;
    if (typeof dbLinear === 'object' && !Array.isArray(dbLinear) && isValidValue(dbLinear?.hip) && dbLinear.hip > 0) return dbLinear.hip;
    return 0;
  };
  
  const getValley = () => {
    // CRITICAL FIX: Database summary first - this had valley_ft: 131.99 but was being ignored!
    const dbSummary = getPositiveValue(dbMeasurement?.summary?.valley_ft);
    if (dbSummary !== null) {
      console.log('✅ Valley from DB summary:', dbSummary);
      return dbSummary;
    }
    
    const tagValue = getPositiveValue(tags['lf.valley']);
    if (tagValue !== null) return tagValue;
    
    const mSummary = getPositiveValue(measurement?.summary?.valley_ft);
    if (mSummary !== null) return mSummary;
    
    if (Array.isArray(dbLinear)) {
      const arrValue = sumArrayByType(dbLinear, 'valley');
      if (arrValue > 0) return arrValue;
    }
    if (Array.isArray(mLinear)) {
      const arrValue = sumArrayByType(mLinear, 'valley');
      if (arrValue > 0) return arrValue;
    }
    if (typeof mLinear === 'object' && !Array.isArray(mLinear) && isValidValue(mLinear?.valley) && mLinear.valley > 0) return mLinear.valley;
    if (typeof dbLinear === 'object' && !Array.isArray(dbLinear) && isValidValue(dbLinear?.valley) && dbLinear.valley > 0) return dbLinear.valley;
    return 0;
  };
  
  const getEave = () => {
    const dbSummary = getPositiveValue(dbMeasurement?.summary?.eave_ft);
    if (dbSummary !== null) return dbSummary;
    
    const tagValue = getPositiveValue(tags['lf.eave']);
    if (tagValue !== null) return tagValue;
    
    const mSummary = getPositiveValue(measurement?.summary?.eave_ft);
    if (mSummary !== null) return mSummary;
    
    if (Array.isArray(dbLinear)) {
      const arrValue = sumArrayByType(dbLinear, 'eave');
      if (arrValue > 0) return arrValue;
    }
    if (Array.isArray(mLinear)) {
      const arrValue = sumArrayByType(mLinear, 'eave');
      if (arrValue > 0) return arrValue;
    }
    if (typeof mLinear === 'object' && !Array.isArray(mLinear) && isValidValue(mLinear?.eave) && mLinear.eave > 0) return mLinear.eave;
    if (typeof dbLinear === 'object' && !Array.isArray(dbLinear) && isValidValue(dbLinear?.eave) && dbLinear.eave > 0) return dbLinear.eave;
    return 0;
  };
  
  const getRake = () => {
    const dbSummary = getPositiveValue(dbMeasurement?.summary?.rake_ft);
    if (dbSummary !== null) return dbSummary;
    
    const tagValue = getPositiveValue(tags['lf.rake']);
    if (tagValue !== null) return tagValue;
    
    const mSummary = getPositiveValue(measurement?.summary?.rake_ft);
    if (mSummary !== null) return mSummary;
    
    if (Array.isArray(dbLinear)) {
      const arrValue = sumArrayByType(dbLinear, 'rake');
      if (arrValue > 0) return arrValue;
    }
    if (Array.isArray(mLinear)) {
      const arrValue = sumArrayByType(mLinear, 'rake');
      if (arrValue > 0) return arrValue;
    }
    if (typeof mLinear === 'object' && !Array.isArray(mLinear) && isValidValue(mLinear?.rake) && mLinear.rake > 0) return mLinear.rake;
    if (typeof dbLinear === 'object' && !Array.isArray(dbLinear) && isValidValue(dbLinear?.rake) && dbLinear.rake > 0) return dbLinear.rake;
    return 0;
  };
  
  const getStep = () => {
    const dbSummary = getPositiveValue(dbMeasurement?.summary?.step_ft);
    if (dbSummary !== null) return dbSummary;
    
    const tagValue = getPositiveValue(tags['lf.step']);
    if (tagValue !== null) return tagValue;
    
    const mSummary = getPositiveValue(measurement?.summary?.step_ft);
    if (mSummary !== null) return mSummary;
    
    if (Array.isArray(dbLinear)) {
      const arrValue = sumArrayByType(dbLinear, 'step');
      if (arrValue > 0) return arrValue;
    }
    if (Array.isArray(mLinear)) {
      const arrValue = sumArrayByType(mLinear, 'step');
      if (arrValue > 0) return arrValue;
    }
    if (typeof mLinear === 'object' && !Array.isArray(mLinear) && isValidValue(mLinear?.step) && mLinear.step > 0) return mLinear.step;
    if (typeof dbLinear === 'object' && !Array.isArray(dbLinear) && isValidValue(dbLinear?.step) && dbLinear.step > 0) return dbLinear.step;
    return 0;
  };
  
  const ridge = getRidge();
  const hip = getHip();
  const valley = getValley();
  const eave = getEave();
  const rake = getRake();
  const step = getStep();
  
  // Log extracted values for debugging
  console.log('📏 Extracted linear features:', { ridge, hip, valley, eave, rake, step });
  
  // Perimeter = eave + rake (or from summary if available)
  const perimeter = dbMeasurement?.summary?.perimeter_ft || 
                    measurement?.summary?.perimeter_ft || 
                    (eave + rake);
  
  return { ridge, hip, valley, eave, rake, step, perimeter };
};

interface MeasurementVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measurement: any;
  tags: Record<string, any>;
  satelliteImageUrl?: string;
  centerLat: number;
  centerLng: number;
  pipelineEntryId?: string;
  onAccept: (adjustedMeasurement?: any) => void;
  onReject: () => void;
}

export function MeasurementVerificationDialog({
  open,
  onOpenChange,
  measurement,
  tags,
  satelliteImageUrl: initialSatelliteImageUrl,
  centerLat,
  centerLng,
  pipelineEntryId,
  onAccept,
  onReject
}: MeasurementVerificationDialogProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isOnline } = useOfflineSync();
  const [isAccepting, setIsAccepting] = useState(false);
  const [adjustedPolygon, setAdjustedPolygon] = useState<[number, number][] | null>(null);
  const [adjustedArea, setAdjustedArea] = useState<number | null>(null);
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [showFacetSplitter, setShowFacetSplitter] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [satelliteImageUrl, setSatelliteImageUrl] = useState(initialSatelliteImageUrl);
  const [autoRegenerateAttempted, setAutoRegenerateAttempted] = useState(false);
  const [adjustedCenterLat, setAdjustedCenterLat] = useState(centerLat);
  const [adjustedCenterLng, setAdjustedCenterLng] = useState(centerLng);
  const [manualZoom, setManualZoom] = useState(0); // Range: -1 to +2
  const [verifiedAddressLat, setVerifiedAddressLat] = useState<number | null>(null);
  const [verifiedAddressLng, setVerifiedAddressLng] = useState<number | null>(null);
  const [coordinateMismatchDistance, setCoordinateMismatchDistance] = useState<number>(0);
  const [hasAutoFixedMismatch, setHasAutoFixedMismatch] = useState(false);
  const [regenerationError, setRegenerationError] = useState<string | null>(null);
  // Auto-calculate optimal zoom based on roof size
  // FIXED: Default to zoom 20 to match IMAGE_ZOOM in edge function (analyze-roof-aerial)
  // This ensures WKT coordinates from AI analysis align with satellite imagery
  const optimalZoom = useMemo(() => {
    const totalArea = measurement?.summary?.total_area_sqft || 0;
    if (totalArea < 1000) return 21;  // Only zoom in for very small roofs
    if (totalArea < 2500) return 20;  // Standard zoom (matches analysis)
    return 19; // Zoom out for large roofs
  }, [measurement?.summary?.total_area_sqft]);
  
  // Get analysis zoom from measurement record if available, otherwise use 20 (IMAGE_ZOOM constant)
  const analysisZoom = measurement?.analysis_zoom || 20;
  
  const [satelliteZoom, setSatelliteZoom] = useState(20); // Default 20 to match AI analysis zoom
  const [resolution, setResolution] = useState<ResolutionOption>('hd'); // Resolution selector
  const [isMaximized, setIsMaximized] = useState(false); // Fullscreen toggle
  const [showHistoricalComparison, setShowHistoricalComparison] = useState(false); // Historical imagery dialog
  const [validationOpen, setValidationOpen] = useState(false); // Validation report collapsible
  const [showReportPreview, setShowReportPreview] = useState(false); // Roofr-style report preview
  
  // View mode toggle: 'satellite' for overlay, 'schematic' for clean diagram, 'trace' for manual roof tracing
  const [viewMode, setViewMode] = useState<'satellite' | 'schematic' | 'trace'>('schematic');
  
  // Manual overlay offset adjustment controls
  const [overlayOffsetX, setOverlayOffsetX] = useState(0); // Horizontal offset in pixels
  const [overlayOffsetY, setOverlayOffsetY] = useState(0); // Vertical offset in pixels
  const [showDebugOverlay, setShowDebugOverlay] = useState(false); // Show AI detection boundaries
  
  const manualVerify = useManualVerification();
  const { repull, isRepulling } = useRepullMeasurement();
  
  // Database measurement fallback - loads from DB when AI returns empty values
  const [dbMeasurement, setDbMeasurement] = useState<any>(null);
  const [isLoadingDbMeasurement, setIsLoadingDbMeasurement] = useState(false);
  
  // Tenant ID for approval workflow
  const [tenantId, setTenantId] = useState<string | null>(null);
  
  // Fetch tenant ID on mount
  useEffect(() => {
    const fetchTenantId = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .single();
        if (profile?.tenant_id) {
          setTenantId(profile.tenant_id);
        }
      }
    };
    if (open) fetchTenantId();
  }, [open]);
  
  // Smart roof type detection
  const [detectedRoofType, setDetectedRoofType] = useState<ReturnType<typeof detectRoofType> | null>(null);
  
  useEffect(() => {
    if (measurement && tags) {
      const detection = detectRoofType(measurement, tags);
      setDetectedRoofType(detection);
    }
  }, [measurement, tags]);
  
  // Auto-apply optimal zoom on dialog open - prioritize analysis zoom for accurate overlay alignment
  useEffect(() => {
    if (open) {
      // FIXED: Use analysis zoom from measurement if available (most accurate for overlay alignment)
      const measurementAnalysisZoom = measurement?.analysis_zoom;
      if (measurementAnalysisZoom) {
        console.log(`🔍 Using analysis zoom from measurement: ${measurementAnalysisZoom}`);
        setSatelliteZoom(measurementAnalysisZoom);
        return;
      }
      
      // Fallback: Calculate based on roof size
      const area = measurement?.summary?.total_area_sqft || 0;
      let autoZoom = 20; // Default matches IMAGE_ZOOM in edge function
      if (area < 1000) autoZoom = 21;
      else if (area > 2500) autoZoom = 19;
      
      console.log(`🔍 Auto-zoom: ${autoZoom} for ${area} sqft roof (no analysis_zoom stored)`);
      setSatelliteZoom(autoZoom);
    }
  }, [open, measurement?.summary?.total_area_sqft, measurement?.analysis_zoom]);
  
  // ALWAYS load measurement from database to get complete linear features (ridges, hips, valleys)
  // The API may return area but miss linear features - database has the complete picture
  // CRITICAL FIX: Also load from roof_measurements which has WKT geometry for overlay alignment
  useEffect(() => {
    const loadMeasurementFromDatabase = async () => {
      if (!pipelineEntryId || !open) return;
      
      // Don't skip just because we have area - we need linear features too!
      // The bug was: returning early when currentArea > 0 prevented loading valleys/hips from DB
      if (dbMeasurement || isLoadingDbMeasurement) return; // Only skip if already loaded
      
      setIsLoadingDbMeasurement(true);
      console.log('📊 ALWAYS loading measurement from database to get complete linear features...');
      
      try {
        // Run both queries in parallel for efficiency
        const [measurementResult, roofMeasurementResult] = await Promise.all([
          // Query 1: measurements table - has summary totals
          supabase
            .from('measurements')
            .select('*')
            .eq('property_id', pipelineEntryId)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          
          // Query 2: roof_measurements table - has WKT geometry for overlay alignment + footprint tracking
          supabase
            .from('roof_measurements')
            .select('id, linear_features_wkt, perimeter_wkt, analysis_zoom, gps_coordinates, footprint_source, footprint_confidence, footprint_vertices_geo, dsm_available')
            .eq('customer_id', pipelineEntryId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        ]);
        
        let measurementData = (measurementResult as any)?.data;
        const summary = measurementData?.summary;
        
        // CRITICAL FIX: Merge WKT linear features from roof_measurements
        const roofMeasData = (roofMeasurementResult as any)?.data;
        if (roofMeasData?.linear_features_wkt) {
          console.log('✅ Found WKT linear features from roof_measurements:', 
            roofMeasData.linear_features_wkt.length, 'features');
          
          // Merge WKT data into measurement object so overlay can use it
          measurementData = {
            ...measurementData,
            linear_features: roofMeasData.linear_features_wkt, // Use WKT array as linear_features
            perimeter_wkt: roofMeasData.perimeter_wkt,
            analysis_zoom: roofMeasData.analysis_zoom || 20,
            gps_coordinates: roofMeasData.gps_coordinates,
            // Footprint tracking fields for source badge
            footprint_source: roofMeasData.footprint_source,
            footprint_confidence: roofMeasData.footprint_confidence,
            footprint_vertices_geo: roofMeasData.footprint_vertices_geo,
            dsm_available: roofMeasData.dsm_available,
          };
          
          console.log('📐 WKT features merged:', {
            types: [...new Set(roofMeasData.linear_features_wkt.map((f: any) => f.type))],
            hasPerimeter: !!roofMeasData.perimeter_wkt,
            analysisZoom: roofMeasData.analysis_zoom,
            gps_coordinates: roofMeasData.gps_coordinates,
          });
        } else {
          console.log('⚠️ No WKT data in roof_measurements for:', pipelineEntryId);
        }
        
        if (summary?.total_area_sqft || roofMeasData?.linear_features_wkt) {
          console.log('✅ Found measurement in database:', summary?.total_area_sqft?.toFixed(0) || 0, 'sq ft');
          setDbMeasurement(measurementData);
        } else {
          console.log('⚠️ No measurement found in database for property:', pipelineEntryId);
        }
      } catch (error) {
        console.error('Failed to load measurement from database:', error);
      } finally {
        setIsLoadingDbMeasurement(false);
      }
    };
    
    loadMeasurementFromDatabase();
  }, [open, pipelineEntryId, tags, measurement?.summary?.total_area_sqft]);
  
  // Manual refresh measurements from database
  const handleRefreshMeasurements = async () => {
    if (!pipelineEntryId) return;
    
    setIsLoadingDbMeasurement(true);
    console.log('🔄 Manually refreshing measurements from database...');
    
    try {
      // Query both tables in parallel
      const [measurementResult, roofMeasurementResult] = await Promise.all([
        supabase
          .from('measurements')
          .select('*')
          .eq('property_id', pipelineEntryId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        
        supabase
          .from('roof_measurements')
          .select('id, linear_features_wkt, perimeter_wkt, analysis_zoom, gps_coordinates, footprint_source, footprint_confidence, footprint_vertices_geo, dsm_available')
          .eq('customer_id', pipelineEntryId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ]);
      
      let measurementData = (measurementResult as any)?.data;
      const summary = measurementData?.summary;
      
      // Merge WKT data from roof_measurements
      const roofMeasData = (roofMeasurementResult as any)?.data;
      if (roofMeasData?.linear_features_wkt) {
        measurementData = {
          ...measurementData,
          linear_features: roofMeasData.linear_features_wkt,
          perimeter_wkt: roofMeasData.perimeter_wkt,
          analysis_zoom: roofMeasData.analysis_zoom || 20,
          gps_coordinates: roofMeasData.gps_coordinates,
          // Footprint tracking fields for source badge
          footprint_source: roofMeasData.footprint_source,
          footprint_confidence: roofMeasData.footprint_confidence,
          footprint_vertices_geo: roofMeasData.footprint_vertices_geo,
          dsm_available: roofMeasData.dsm_available,
        };
        console.log('✅ Merged WKT features:', roofMeasData.linear_features_wkt.length, 'gps:', roofMeasData.gps_coordinates);
      }
      
      if (summary || roofMeasData?.linear_features_wkt) {
        console.log('✅ Refreshed measurement from database:', summary);
        setDbMeasurement(measurementData);
        toast({
          title: "Measurements Refreshed",
          description: `${roofMeasData?.linear_features_wkt?.length || 0} WKT features loaded`,
        });
      } else {
        toast({
          title: "No Data Found",
          description: "No measurement data in database for this property",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Failed to refresh measurements:', error);
      toast({
        title: "Refresh Failed",
        description: "Could not load measurements from database",
        variant: "destructive",
      });
    } finally {
      setIsLoadingDbMeasurement(false);
    }
  };
  
  // Clear all measurement history for this property
  const handleClearMeasurementHistory = async () => {
    if (!pipelineEntryId) return;
    
    try {
      // Deactivate all measurements for this property
      const { error } = await supabase
        .from('measurements')
        .update({ is_active: false })
        .eq('property_id', pipelineEntryId);
      
      if (error) throw error;
      
      // Clear the local state
      setDbMeasurement(null);
      
      toast({
        title: "Measurements Cleared",
        description: "All measurement history has been cleared. Pull new measurements when ready.",
      });
      
      // Close the dialog
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to clear measurements:', error);
      toast({
        title: "Clear Failed",
        description: "Could not clear measurement history",
        variant: "destructive",
      });
    }
  };
  
  // PHASE 1: Fetch clean Google Maps satellite image via proxy
  const [cleanSatelliteImageUrl, setCleanSatelliteImageUrl] = useState<string>('');
  const [isLoadingSatellite, setIsLoadingSatellite] = useState(false);
  
  // ✅ CRITICAL FIX: Single source of truth for overlay center coordinates
  // Both satellite image AND overlay MUST use these EXACT same values
  // PRIORITY: gps_coordinates from roof_measurements > user-pin > verified address > props
  const overlayCoordinates = useMemo(() => {
    // Priority 1: gps_coordinates from roof_measurements (used during AI analysis - MOST ACCURATE)
    // This ensures satellite image matches the EXACT coordinates where WKT geometry was generated
    if (dbMeasurement?.gps_coordinates?.lat && dbMeasurement?.gps_coordinates?.lng) {
      console.log('📍 Using gps_coordinates from roof_measurements:', dbMeasurement.gps_coordinates);
      return { 
        lat: dbMeasurement.gps_coordinates.lat, 
        lng: dbMeasurement.gps_coordinates.lng, 
        source: 'roof_measurements' 
      };
    }
    // Priority 2: User-selected PIN (from StructureSelectionMap)
    if (adjustedCenterLat && adjustedCenterLng && adjustedCenterLat !== 0) {
      return { lat: adjustedCenterLat, lng: adjustedCenterLng, source: 'user-pin' };
    }
    // Priority 3: Verified address
    if (verifiedAddressLat && verifiedAddressLng) {
      return { lat: verifiedAddressLat, lng: verifiedAddressLng, source: 'verified' };
    }
    // Priority 4: Props (fallback)
    if (centerLat && centerLng && centerLat !== 0) {
      return { lat: centerLat, lng: centerLng, source: 'props' };
    }
    return { lat: 0, lng: 0, source: 'none' };
  }, [dbMeasurement?.gps_coordinates, adjustedCenterLat, adjustedCenterLng, centerLat, centerLng, verifiedAddressLat, verifiedAddressLng]);
  
  useEffect(() => {
    const fetchMapboxSatelliteImage = async () => {
      const { lat, lng, source } = overlayCoordinates;
      
      // Only fetch if we have valid coordinates
      if (!lat || !lng || lat === 0) {
        console.log('⏳ No valid coordinates for satellite image...');
        return;
      }
      
      console.log(`📍 Fetching Mapbox satellite at zoom ${satelliteZoom} from ${source}: ${lat}, ${lng}`);
      setIsLoadingSatellite(true);
      try {
        // Fetch Mapbox token from edge function
        const { data: tokenData, error: tokenError } = await supabase.functions.invoke('get-mapbox-token');
        
        if (tokenError || !tokenData?.token) {
          throw new Error('Failed to get Mapbox token');
        }
        
        // Build Mapbox Static API URL - dynamic resolution based on resolution selector
        const { width: imageWidth, height: imageHeight, label: resLabel } = RESOLUTION_CONFIG[resolution];
        const mapboxUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${satelliteZoom},0/${imageWidth}x${imageHeight}?access_token=${tokenData.token}`;
        
        setCleanSatelliteImageUrl(mapboxUrl);
        console.log(`✅ Mapbox satellite image URL generated (zoom ${satelliteZoom}, ${resLabel} ${imageWidth}x${imageHeight})`);
      } catch (error) {
        console.error('Failed to fetch Mapbox satellite image:', error);
        toast({
          title: 'Image Load Error',
          description: 'Could not load satellite image from Mapbox',
          variant: 'destructive'
        });
      } finally {
        setIsLoadingSatellite(false);
      }
    };
    
    fetchMapboxSatelliteImage();
  }, [overlayCoordinates.lat, overlayCoordinates.lng, satelliteZoom, resolution]);
  
  // Update satellite image URL when prop changes
  useEffect(() => {
    setSatelliteImageUrl(initialSatelliteImageUrl);
  }, [initialSatelliteImageUrl]);
  
  // Load verified address coordinates from contacts table (PRIORITY #1)
  useEffect(() => {
    const loadVerifiedCoordinates = async () => {
      if (!pipelineEntryId || !open) return;
      
      try {
        const { data: pipelineData } = await supabase
          .from('pipeline_entries')
          .select('contact_id, metadata, contacts!inner(verified_address, latitude, longitude)')
          .eq('id', pipelineEntryId)
          .single();
        
        if (pipelineData) {
          const contact = (pipelineData as any)?.contacts;
          let vLat: number | undefined;
          let vLng: number | undefined;
          
          // Priority #1: contact.verified_address (Google-verified)
          if (contact?.verified_address?.lat && contact?.verified_address?.lng) {
            vLat = contact.verified_address.lat;
            vLng = contact.verified_address.lng;
            
            // Validate verified address against contact coordinates
            if (contact?.latitude && contact?.longitude) {
              const latDiff = Math.abs(vLat - contact.latitude);
              const lngDiff = Math.abs(vLng - contact.longitude);
              const distanceMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000;
              
              if (distanceMeters > 100) {
                console.warn('⚠️ Verified address coordinates significantly different from contact coordinates:', {
                  verifiedAddress: { lat: vLat, lng: vLng },
                  contactCoords: { lat: contact.latitude, lng: contact.longitude },
                  distance: Math.round(distanceMeters) + 'm',
                  action: 'Using contact coordinates instead'
                });
                
                // Override with contact coordinates
                vLat = contact.latitude;
                vLng = contact.longitude;
                
                toast({
                  title: "Coordinate Discrepancy Detected",
                  description: `Verified address is ${Math.round(distanceMeters)}m from contact coordinates. Using contact coordinates for accuracy.`,
                  variant: "default",
                  duration: 8000,
                });
              }
            }
          } 
          // Priority #2: contact.latitude/longitude (legacy fallback)
          else if (contact?.latitude && contact?.longitude) {
            vLat = contact.latitude;
            vLng = contact.longitude;
          }
          // Priority #3: pipeline metadata (last resort)
          else if (pipelineData.metadata) {
            const metadata = pipelineData.metadata as any;
            if (metadata.verified_address?.geometry?.location) {
              vLat = metadata.verified_address.geometry.location.lat;
              vLng = metadata.verified_address.geometry.location.lng;
            } else if (metadata.verified_address?.lat && metadata.verified_address?.lng) {
              vLat = metadata.verified_address.lat;
              vLng = metadata.verified_address.lng;
            }
          }
          
          if (vLat && vLng) {
            setVerifiedAddressLat(vLat);
            setVerifiedAddressLng(vLng);
            
            // Calculate distance between verified address and visualization center
            const latDiff = Math.abs(vLat - centerLat);
            const lngDiff = Math.abs(vLng - centerLng);
            const distanceMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000;
            setCoordinateMismatchDistance(distanceMeters);
            
            // Show warning if coordinate mismatch > 30 meters
            if (distanceMeters > 30) {
              const severity = distanceMeters > 50 ? 'destructive' : 'default';
              toast({
                title: "⚠️ Coordinate Mismatch Detected",
                description: `Visualization is ${Math.round(distanceMeters)}m off from verified address. ${distanceMeters > 50 ? 'House may not be visible.' : 'Click on the house to recenter.'}`,
                variant: severity as any,
                duration: distanceMeters > 50 ? 15000 : 10000,
              });
              
              // PHASE 3: Force correct initial centering - immediately use verified coords
              if (distanceMeters > 50 && !hasAutoFixedMismatch) {
                console.warn('🔄 Auto-fixing critical coordinate mismatch (>50m) - using verified address coordinates');
                setHasAutoFixedMismatch(true);
                setAdjustedCenterLat(vLat);
                setAdjustedCenterLng(vLng);
                setTimeout(() => {
                  handleRegenerateVisualization(vLat, vLng, 0);
                }, 1000);
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to load verified coordinates:', error);
      }
    };
    
    loadVerifiedCoordinates();
  }, [open, pipelineEntryId, centerLat, centerLng, hasAutoFixedMismatch]);
  
  // Auto-regenerate visualization if missing Mapbox URL on open
  useEffect(() => {
    const shouldAutoRegenerate = 
      open && 
      !autoRegenerateAttempted && 
      measurement?.id && 
      !measurement?.mapbox_visualization_url &&
      centerLat &&
      centerLng;
      
    if (shouldAutoRegenerate) {
      setAutoRegenerateAttempted(true);
      handleRegenerateVisualization();
    }
  }, [open, measurement?.id, measurement?.mapbox_visualization_url, centerLat, centerLng, autoRegenerateAttempted]);
  
  // Editable pitch and waste
  // Helper function to derive pitch from pitch factor
  const derivePitchFromFactor = (factor: number): string => {
    if (!factor) return '4/12';
    
    let closestPitch = '4/12';
    let minDiff = Infinity;
    
    for (const [pitch, multiplier] of Object.entries(PITCH_MULTIPLIERS)) {
      const diff = Math.abs(multiplier - factor);
      if (diff < minDiff) {
        minDiff = diff;
        closestPitch = pitch;
      }
    }
    
    return closestPitch;
  };

  const defaultPitch = measurement?.faces?.[0]?.pitch || derivePitchFromFactor(tags['roof.pitch_factor']) || '4/12';
  const [selectedPitch, setSelectedPitch] = useState(defaultPitch);
  const [pitchFactor, setPitchFactor] = useState(tags['roof.pitch_factor'] || 1.0541);
  const normalizeWaste = (value: number) => {
    const options = [10, 12, 15, 20];
    return options.reduce((prev, curr) => 
      Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
    );
  };
  const [wastePercent, setWastePercent] = useState(
    normalizeWaste(tags['roof.waste_pct'] || 12)
  );
  const [faceCount, setFaceCount] = useState(tags['roof.faces_count'] || 0);
  const [numberOfStories, setNumberOfStories] = useState(1);
  
  // Material quantities (recalculated)
  const [shingleBundles, setShingleBundles] = useState(0);
  const [ridgeCapBundles, setRidgeCapBundles] = useState(0);
  const [valleyRolls, setValleyRolls] = useState(0);
  const [dripEdgeSticks, setDripEdgeSticks] = useState(0);
  
  // Penetrations state
  const [pipeVents, setPipeVents] = useState(tags['pen.pipe_vent'] || 0);
  const [skylights, setSkylights] = useState(tags['pen.skylight'] || 0);
  const [chimneys, setChimneys] = useState(tags['pen.chimney'] || 0);
  const [hvacUnits, setHvacUnits] = useState(tags['pen.hvac'] || 0);
  const [otherPenetrations, setOtherPenetrations] = useState(tags['pen.other'] || 0);

  const handlePitchChange = (pitch: string) => {
    setSelectedPitch(pitch);
    setPitchFactor(PITCH_MULTIPLIERS[pitch]);
  };

  const handleAccept = async () => {
    setIsAccepting(true);
    
    // PHASE 3 FIX: Clear field semantics to prevent double-application of pitch/waste
    // - plan_area_sqft: flat footprint from perimeter polygon (no pitch, no waste)
    // - roof_area_sqft: plan_area * pitch_factor (pitched but no waste)
    // - total_with_waste_sqft: roof_area * (1 + waste_pct/100) (final number for ordering)
    
    // Determine source: Check if we already have a plan area (pre-pitch) vs roof area (post-pitch)
    const hasRawPlanArea = measurement?.summary?.plan_area_sqft > 0 || tags['roof.plan_area'] > 0;
    const isPitchAlreadyApplied = measurement?.summary?.pitch_applied === true;
    const isWasteAlreadyApplied = measurement?.summary?.waste_applied === true;
    
    // Get the base area - prefer plan area if available
    let planArea: number;
    if (adjustedArea && adjustedArea > 0) {
      // User manually adjusted - this is treated as the new plan area
      planArea = adjustedArea;
    } else if (hasRawPlanArea) {
      planArea = measurement?.summary?.plan_area_sqft || tags['roof.plan_area'] || 0;
    } else {
      // Fallback: Use total_area and assume it might already have pitch applied
      const fallbackArea = measurement?.summary?.total_area_sqft || tags['roof.total_area'] || 0;
      if (isPitchAlreadyApplied && pitchFactor > 1) {
        // Reverse the pitch to get plan area
        planArea = fallbackArea / pitchFactor;
      } else {
        planArea = fallbackArea;
      }
    }
    
    // Apply pitch only if not already applied
    const roofArea = isPitchAlreadyApplied ? planArea : planArea * pitchFactor;
    
    // Apply waste only if not already applied  
    const totalWithWaste = isWasteAlreadyApplied ? roofArea : roofArea * (1 + wastePercent / 100);
    const squares = totalWithWaste / 100;
    
    const perimeter = buildingPolygon.length > 0 
      ? calculatePerimeterFt(adjustedPolygon || buildingPolygon)
      : (tags['roof.perimeter'] || measurement?.summary?.perimeter_ft || 0);

    console.log('📏 handleAccept calculation breakdown:', {
      source: adjustedArea ? 'adjusted' : hasRawPlanArea ? 'plan_area' : 'fallback',
      planArea,
      pitchFactor,
      isPitchAlreadyApplied,
      roofArea,
      wastePercent,
      isWasteAlreadyApplied,
      totalWithWaste,
      squares,
    });

    const updatedMeasurement = {
      ...measurement,
      adjustedPolygon,
      adjustedPlanArea: planArea,
      adjustedRoofArea: roofArea,
      adjustedTotalArea: totalWithWaste,
      adjustedSquares: squares,
      adjustedPitch: selectedPitch,
      adjustedPitchFactor: pitchFactor,
      adjustedWastePercent: wastePercent,
      adjustedPerimeter: perimeter,
      adjustedFaceCount: faceCount,
      adjustedArea: roofArea,
      pitch: selectedPitch,
      wastePct: wastePercent,
      complexity: faceCount > 6 ? 'complex' : faceCount > 3 ? 'moderate' : 'simple',
      penetrations: {
        pipe_vent: pipeVents,
        skylight: skylights,
        chimney: chimneys,
        hvac: hvacUnits,
        other: otherPenetrations,
      },
      numberOfStories: numberOfStories,
      summary: {
        ...measurement?.summary,
        plan_area_sqft: planArea,
        roof_area_sqft: roofArea,
        total_area_sqft: totalWithWaste,
        pitch_applied: true,
        waste_applied: true,
      },
      tags: {
        ...tags,
        // FIXED: Store distinct values for each stage
        'roof.plan_area': planArea,           // Flat footprint (no pitch/waste)
        'roof.total_area': roofArea,          // With pitch, no waste
        'roof.total_area_with_waste': totalWithWaste, // Final ordering area
        'roof.squares': squares,              // Squares with waste
        'roof.pitch': selectedPitch,
        'roof.pitch_factor': pitchFactor,
        'roof.waste_pct': wastePercent,
        'roof.perimeter': perimeter,
      }
    };

    // Persist adjusted measurements with offline support
    try {
      if (measurement?.id && pipelineEntryId) {
        const result = await saveMeasurementWithOfflineSupport({
          measurementId: measurement.id,
          propertyId: pipelineEntryId,
          facets: measurement.faces || [],
          linearFeatures: measurement.linear_features || [],
          summary: {
            total_area_sqft: roofArea,
            total_squares: squares,
            waste_pct: wastePercent,
            pitch: selectedPitch,
            pitch_factor: pitchFactor,
            perimeter: perimeter,
            stories: numberOfStories,
          },
          metadata: updatedMeasurement,
        });
        
        if (!result.success) {
          console.error('Failed to save measurement:', result.error);
          toast({
            title: isOnline ? "Save Failed" : "Saved Offline",
            description: isOnline 
              ? "Measurements queued for retry when connection improves" 
              : "Changes will sync when connection is restored",
            variant: isOnline ? "destructive" : "default",
          });
        } else if (!isOnline) {
          toast({
            title: "Saved Offline",
            description: "Changes will sync when connection is restored",
          });
        }
      }
    } catch (error) {
      console.error('Failed to save adjusted measurements:', error);
      toast({
        title: "Warning",
        description: "Measurements accepted but may not have saved",
        variant: "destructive",
      });
    }

    await onAccept(updatedMeasurement);
    setIsAccepting(false);
    onOpenChange(false);
  };

  const handleAcceptAndCreateEstimate = async () => {
    await handleAccept();
    
    if (pipelineEntryId) {
      navigate(`/lead/${pipelineEntryId}?tab=estimate&autoPopulate=true`);
    } else {
      toast({
        title: "Cannot Navigate",
        description: "Missing pipeline entry ID",
        variant: "destructive",
      });
    }
  };

  const handleReject = () => {
    onReject();
    onOpenChange(false);
  };

  const handleManualMeasurementSave = async (updatedMeasurement: any, updatedTags: Record<string, any>) => {
    try {
      const propertyId = measurement?.property_id || '';
      await manualVerify(propertyId, updatedMeasurement, updatedTags);
      
      // Update local state with manually verified measurements
      Object.assign(measurement, updatedMeasurement);
      Object.assign(tags, updatedTags);
      
      setShowManualEditor(false);
    } catch (error) {
      console.error('Manual verification error:', error);
      throw error;
    }
  };
  
  const handleFacetSplitterSave = async (splitFacets: any[]) => {
    try {
      // Update measurement with split facets
      const updatedMeasurement = {
        ...measurement,
        faces: splitFacets.map((facet, index) => ({
          id: facet.id,
          pitch_angle: measurement.summary?.pitch || '6/12',
          azimuth_angle: measurement.summary?.predominant_direction || 0,
          area_sqft: facet.area,
          plan_area_sqft: facet.area,
          geometry_wkt: `POLYGON((${facet.points.map((p: [number, number]) => `${p[0]} ${p[1]}`).join(', ')}, ${facet.points[0][0]} ${facet.points[0][1]}))`,
        })),
        summary: {
          ...measurement.summary,
          facet_count: splitFacets.length,
        },
      };
      
      // Save to database with offline support
      if (measurement?.id && pipelineEntryId) {
        const totalArea = updatedMeasurement.faces.reduce((sum: number, f: any) => sum + f.area_sqft, 0);
        const result = await saveMeasurementWithOfflineSupport({
          measurementId: measurement.id,
          propertyId: pipelineEntryId,
          facets: updatedMeasurement.faces,
          linearFeatures: measurement.linear_features || [],
          summary: {
            total_area_sqft: totalArea,
            total_squares: totalArea / 100,
            waste_pct: wastePercent,
            pitch: updatedMeasurement.summary.pitch || '6/12',
            perimeter: tags['roof.perimeter'] || 0,
            stories: numberOfStories,
          },
          metadata: updatedMeasurement,
        });
        
        if (!result.success) throw new Error(result.error);
      }
      
      // Update local state
      Object.assign(measurement, updatedMeasurement);
      
      toast({
        title: "Facets Saved",
        description: `Successfully split into ${splitFacets.length} roof facets.`,
      });
      
      setShowFacetSplitter(false);
      
      // Trigger visualization regeneration with new facet geometries
      handleRegenerateVisualization();
    } catch (error) {
      console.error('Facet split save error:', error);
      toast({
        title: "Save Failed",
        description: "Could not save split facets. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getConfidenceLevel = () => {
    const confidence = measurement?.confidence || 0;
    if (confidence >= 0.8) return { label: 'High', variant: 'default' as const, dots: 5 };
    if (confidence >= 0.6) return { label: 'Medium', variant: 'secondary' as const, dots: 3 };
    return { label: 'Low', variant: 'destructive' as const, dots: 2 };
  };

  const confidence = getConfidenceLevel();

  // Extract building polygon for editor
  const buildingPolygon = measurement?.faces?.[0]?.wkt 
    ? parseWKTPolygon(measurement.faces[0].wkt)
    : [];

  const handlePolygonChange = (coords: [number, number][], areaSqft: number) => {
    setAdjustedPolygon(coords);
    setAdjustedArea(areaSqft);
  };

  // Helper function to calculate flat area (pitch ≤ 2/12 only)
  const calculateFlatArea = (): number => {
    if (!measurement?.faces || measurement.faces.length === 0) {
      return 0;
    }
    
    let flatArea = 0;
    for (const facet of measurement.faces) {
      if (!facet.pitch) continue;
      
      // Parse pitch string (e.g., "6/12", "2/12")
      const pitchMatch = facet.pitch.match(/^(\d+)\/12$/);
      if (!pitchMatch) continue;
      
      const pitchNumerator = parseInt(pitchMatch[1]);
      
      // Include only pitches ≤ 2/12
      if (pitchNumerator <= 2) {
        flatArea += facet.plan_area_sqft || 0;
      }
    }
    
    return flatArea;
  };

  // Calculate measurements (use adjusted values if available, with comprehensive fallbacks including database)
  const planArea = adjustedArea 
    || tags['roof.plan_area'] 
    || tags['roof.plan_sqft'] 
    || measurement?.summary?.total_area_sqft 
    || measurement?.summary?.plan_area_sqft
    || measurement?.total_area_sqft
    || dbMeasurement?.summary?.total_area_sqft  // Database fallback
    || dbMeasurement?.total_area_sqft
    || 0;
  const flatArea = calculateFlatArea();
  const roofAreaNoWaste = planArea * pitchFactor;
  const totalAreaWithWaste = roofAreaNoWaste * (1 + wastePercent / 100);
  const roofSquares = totalAreaWithWaste / 100;
  
  // Extract linear features using the comprehensive helper function
  const extractedLinear = extractLinearFeatures(measurement, dbMeasurement, tags);
  const ridge = extractedLinear.ridge;
  const hip = extractedLinear.hip;
  const valley = extractedLinear.valley;
  const eave = extractedLinear.eave;
  const rake = extractedLinear.rake;
  const step = extractedLinear.step;
  
  const perimeter = buildingPolygon.length > 0 
    ? calculatePerimeterFt(adjustedPolygon || buildingPolygon)
    : extractedLinear.perimeter;

  // Recalculate materials when measurements change
  useEffect(() => {
    setShingleBundles(Math.ceil(roofSquares * 3));
    setRidgeCapBundles(Math.ceil((ridge + hip) / 33));
    setValleyRolls(Math.ceil(valley / 50));
    setDripEdgeSticks(Math.ceil((eave + rake) / 10));
  }, [roofSquares, ridge, hip, valley, eave, rake]);

  // PHASE 5: Keyboard shortcuts for power users
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent keyboard shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          handlePan('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          handlePan('down');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handlePan('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          handlePan('right');
          break;
        case '+':
        case '=':
          e.preventDefault();
          handleZoomAdjust('in');
          break;
        case '-':
        case '_':
          e.preventDefault();
          handleZoomAdjust('out');
          break;
        case 'h':
        case 'H':
          e.preventDefault();
          if (verifiedAddressLat && verifiedAddressLng) {
            setAdjustedCenterLat(verifiedAddressLat);
            setAdjustedCenterLng(verifiedAddressLng);
            handleRegenerateVisualization(verifiedAddressLat, verifiedAddressLng, manualZoom);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isRegenerating, isOnline, adjustedCenterLat, adjustedCenterLng, manualZoom, verifiedAddressLat, verifiedAddressLng]);

  // PHASE 1: Dynamically recalculate coordinate mismatch as user moves map
  useEffect(() => {
    if (verifiedAddressLat && verifiedAddressLng) {
      const latDiff = Math.abs(verifiedAddressLat - adjustedCenterLat);
      const lngDiff = Math.abs(verifiedAddressLng - adjustedCenterLng);
      const distanceMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000;
      setCoordinateMismatchDistance(distanceMeters);
    }
  }, [adjustedCenterLat, adjustedCenterLng, verifiedAddressLat, verifiedAddressLng]);

  const source = measurement?.source || 'Unknown';

  const handlePan = (direction: 'up' | 'down' | 'left' | 'right') => {
    const delta = 0.00005; // ~5 meters at equator
    let newLat = adjustedCenterLat;
    let newLng = adjustedCenterLng;

    switch (direction) {
      case 'up':
        newLat += delta;
        break;
      case 'down':
        newLat -= delta;
        break;
      case 'left':
        newLng -= delta;
        break;
      case 'right':
        newLng += delta;
        break;
    }

    setAdjustedCenterLat(newLat);
    setAdjustedCenterLng(newLng);
    
    // Auto-regenerate after pan
    handleRegenerateVisualization(newLat, newLng);
  };
  
  const handleZoomAdjust = (direction: 'in' | 'out' | 'reset') => {
    let newZoom = manualZoom;
    
    if (direction === 'in') {
      newZoom = Math.min(manualZoom + 1, 2); // Max +2 zoom
    } else if (direction === 'out') {
      newZoom = Math.max(manualZoom - 1, -1); // Max -1 zoom
    } else if (direction === 'reset') {
      newZoom = 0; // Reset to optimal
    }
    
    setManualZoom(newZoom);
    handleRegenerateVisualization(adjustedCenterLat, adjustedCenterLng, newZoom);
    
    toast({
      title: "Zoom Adjusted",
      description: `Zoom level: ${newZoom > 0 ? '+' : ''}${newZoom}`,
    });
  };

  const handleRegenerateVisualization = async (lat?: number, lng?: number, zoomAdjust?: number) => {
    if (!measurement?.id) {
      toast({
        title: "Cannot Regenerate",
        description: "Measurement ID is required",
        variant: "destructive"
      });
      return;
    }
    
    if (!isOnline) {
      setRegenerationError("Cannot update satellite view while offline");
      return;
    }

    setIsRegenerating(true);
    setRegenerationError(null);

    try {
      // PHASE 4: Comprehensive logging for debugging
      console.log('🗺️ Regenerating visualization with params:', {
        measurement_id: measurement.id,
        property_id: measurement.property_id,
        center_lat: lat ?? adjustedCenterLat,
        center_lng: lng ?? adjustedCenterLng,
        zoom_adjustment: zoomAdjust ?? manualZoom,
        verified_address_lat: verifiedAddressLat,
        verified_address_lng: verifiedAddressLng,
      });

      // Try to fetch verified address coordinates for accurate centering
      let verifiedLat: number | undefined = verifiedAddressLat ?? undefined;
      let verifiedLng: number | undefined = verifiedAddressLng ?? undefined;
      
      if (pipelineEntryId && !verifiedLat) {
        const { data: pipelineData } = await supabase
          .from('pipeline_entries')
          .select('metadata')
          .eq('id', pipelineEntryId)
          .single();
        
        if (pipelineData?.metadata) {
          const metadata = pipelineData.metadata as any;
          if (metadata.verified_address?.geometry?.location) {
            verifiedLat = metadata.verified_address.geometry.location.lat;
            verifiedLng = metadata.verified_address.geometry.location.lng;
          } else if (metadata.verified_address?.lat && metadata.verified_address?.lng) {
            verifiedLat = metadata.verified_address.lat;
            verifiedLng = metadata.verified_address.lng;
          }
        }
      }

      const { data, error } = await supabase.functions.invoke('generate-measurement-visualization', {
        body: {
          measurement_id: measurement.id,
          property_id: measurement.property_id,
          center_lat: lat ?? adjustedCenterLat,
          center_lng: lng ?? adjustedCenterLng,
          verified_address_lat: verifiedLat,
          verified_address_lng: verifiedLng,
          zoom_adjustment: zoomAdjust ?? manualZoom,
        }
      });

      if (error) {
        console.error('🚨 Edge function error:', error);
        throw error;
      }
      if (!data?.ok) {
        console.error('🚨 Edge function returned not OK:', data);
        throw new Error(data?.error || 'Regeneration failed');
      }

      console.log('✅ Visualization regenerated successfully:', data.data);

      // Update the satellite image URL with the new visualization
      const newVisualizationUrl = data.data.visualization_url;
      setSatelliteImageUrl(newVisualizationUrl);
      
      // Add cache buster to force reload
      const urlWithCacheBuster = `${newVisualizationUrl}?t=${Date.now()}`;
      setSatelliteImageUrl(urlWithCacheBuster);

      toast({
        title: "✅ Visualization Updated",
        description: "Satellite imagery centered on new location",
      });

    } catch (err: any) {
      console.error('❌ Regenerate visualization error:', err);
      const errorMsg = err.message || "Could not regenerate visualization";
      setRegenerationError(errorMsg);
      
      // PHASE 4: Provide retry button in error toast
      toast({
        title: "Regeneration Failed",
        description: `${errorMsg}. Try using pan/zoom controls or "Reset to Home".`,
        variant: "destructive",
        duration: 10000,
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  // Collapsible section states
  const [geometryOpen, setGeometryOpen] = useState(false);
  const [linearOpen, setLinearOpen] = useState(false);
  const [penetrationsOpen, setPenetrationsOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [showTracePanel, setShowTracePanel] = useState(false);

  // Perimeter-only mode detection
  const isPerimeterOnly = useMemo(() => {
    const manualReview = measurement?.manual_review_recommended === true ||
                         measurement?.overlay_schema?.manualReviewRecommended === true ||
                         dbMeasurement?.manual_review_recommended === true;
    const lowQuality = (measurement?.split_quality !== undefined && measurement.split_quality < 0.6) ||
                       (dbMeasurement?.split_quality !== undefined && dbMeasurement.split_quality < 0.6);
    const noFacets = (measurement?.facet_count === 0 && !measurement?.faces?.length) ||
                     (dbMeasurement?.facet_count === 0 && !dbMeasurement?.faces?.length);
    return manualReview || lowQuality || noFacets;
  }, [measurement, dbMeasurement]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent className={isMaximized ? "max-w-[95vw] w-[95vw] max-h-[95vh] h-[95vh] p-0 gap-0 overflow-hidden" : "max-w-4xl max-h-[85vh] p-0 gap-0 overflow-hidden"}>
        <TooltipProvider>
        {/* Compact Header */}
        <DialogHeader className="px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Satellite className="h-4 w-4 shrink-0" />
              <DialogTitle className="text-base truncate">
                {tags['prop.address'] || 'Verify Measurements'}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {detectedRoofType && (
                <Badge variant="outline" className="text-xs">
                  {detectedRoofType.type} • {Math.round(detectedRoofType.confidence * 100)}%
                </Badge>
              )}
              <Badge variant={confidence.variant} className="text-xs">
                {confidence.label}
              </Badge>
              <Badge variant={isOnline ? 'secondary' : 'destructive'} className="text-xs">
                {isOnline ? 'Online' : 'Offline'}
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7 text-destructive hover:text-destructive" 
                    onClick={handleClearMeasurementHistory}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear Measurement History</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsMaximized(!isMaximized)}>
                    {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isMaximized ? 'Exit Fullscreen' : 'Fullscreen'}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 h-[calc(85vh-120px)]">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr,340px] gap-4 p-4">
            {/* Perimeter-Only Mode Banner */}
            {isPerimeterOnly && (
              <div className="lg:col-span-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-amber-800 dark:text-amber-200">Perimeter Only Mode</h4>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    Facet geometry could not be computed automatically. Area and linear measurements shown are preliminary and require manual verification.
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                    onClick={() => setShowManualEditor(true)}
                  >
                    <Edit3 className="h-4 w-4 mr-2" />
                    Fix Outline & Lines
                  </Button>
                </div>
              </div>
            )}
            
            {/* Imagery Age Warning - Show at top if imagery is old */}
            {(() => {
              const imageryDate = measurement?.metadata?.imageryDate || 
                                  measurement?.solar_api_response?.imageryDate ||
                                  dbMeasurement?.solar_api_response?.imageryDate;
              return imageryDate ? (
                <div className="lg:col-span-2">
                  <ImageryAgeWarning
                    imageryDate={imageryDate}
                    onDrawManually={() => setShowManualEditor(true)}
                    onViewHistory={() => setShowHistoricalComparison(true)}
                  />
                </div>
              ) : null;
            })()}
            
            {/* Obstruction Detection Warning - Show when hip=0 or ridge<40ft */}
            {(() => {
              const imageryDate = measurement?.metadata?.imageryDate || 
                                  measurement?.solar_api_response?.imageryDate ||
                                  dbMeasurement?.solar_api_response?.imageryDate;
              const imageryYear = imageryDate?.year;
              
              return (hip === 0 || (ridge > 0 && ridge < 40)) ? (
                <div className="lg:col-span-2">
                  <ObstructionDetectionWarning
                    hip={hip}
                    ridge={ridge}
                    imageryYear={imageryYear}
                    onDrawHipManually={() => {
                      toast({
                        title: "Draw Hip Lines",
                        description: "Use the manual editor to draw hip lines on the roof",
                      });
                      setShowManualEditor(true);
                    }}
                    onDrawRidgeManually={() => {
                      toast({
                        title: "Draw Ridge Lines",
                        description: "Use the manual editor to draw ridge lines on the roof",
                      });
                      setShowManualEditor(true);
                    }}
                  />
                </div>
              ) : null;
            })()}
            
            {/* Left Panel: Visual Editor */}
            {(measurement?.faces || buildingPolygon.length > 0) && (
              <div className="space-y-3">
                {/* View Mode Toggle + Controls */}
                <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg border flex-wrap">
                  {/* View Mode Toggle */}
                  <div className="flex items-center gap-1 bg-background rounded-md p-0.5 border">
                    <Button
                      variant={viewMode === 'schematic' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs px-3"
                      onClick={() => setViewMode('schematic')}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                      Schematic
                    </Button>
                    <Button
                      variant={viewMode === 'satellite' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs px-3"
                      onClick={() => setViewMode('satellite')}
                    >
                      <Satellite className="h-3.5 w-3.5 mr-1.5" />
                      Satellite
                    </Button>
                    <Button
                      variant={viewMode === 'trace' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs px-3"
                      onClick={() => setViewMode('trace')}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Trace
                    </Button>
                  </div>
                  
                  {/* Re-analyze Roof Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={async () => {
                          if (!pipelineEntryId) {
                            toast({ title: 'Missing property ID', variant: 'destructive' });
                            return;
                          }
                          try {
                            toast({ title: 'Re-analyzing roof topology...', description: 'Fetching fresh data from Google Solar' });
                            const result = await repull(pipelineEntryId, centerLat, centerLng);
                            // Reload dbMeasurement from database
                            setIsLoadingDbMeasurement(true);
                            const { data: freshDb } = await supabase
                              .from('roof_measurements')
                              .select('*')
                              .eq('customer_id', pipelineEntryId)
                              .order('created_at', { ascending: false })
                              .limit(1)
                              .single();
                            if (freshDb) {
                              setDbMeasurement(freshDb);
                            }
                            setIsLoadingDbMeasurement(false);
                            toast({ title: 'Roof re-analyzed!', description: `Found ${freshDb?.facet_count || 0} facets with updated topology` });
                          } catch (err: any) {
                            console.error('Re-analyze failed:', err);
                            toast({ title: 'Re-analysis failed', description: err.message, variant: 'destructive' });
                          }
                        }}
                        disabled={isRepulling || !pipelineEntryId}
                      >
                        {isRepulling ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Re-analyze
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Re-fetch measurement from Google Solar API with improved ridge/hip/valley detection</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* AI Detect Roof from Photo Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
                        onClick={async () => {
                          if (!satelliteImageUrl && !cleanSatelliteImageUrl) {
                            toast({ title: 'No satellite image available', variant: 'destructive' });
                            return;
                          }
                          
                          try {
                            toast({ 
                              title: 'AI Detecting Roof Structure...', 
                              description: 'Analyzing satellite image with AI vision' 
                            });
                            
                            // Fetch satellite image and convert to base64
                            const imgUrl = cleanSatelliteImageUrl || satelliteImageUrl;
                            const response = await fetch(imgUrl!);
                            const blob = await response.blob();
                            const base64 = await new Promise<string>((resolve) => {
                              const reader = new FileReader();
                              reader.onloadend = () => resolve(reader.result as string);
                              reader.readAsDataURL(blob);
                            });
                            
                            // Calculate image bounds for GPS conversion
                            const zoom = satelliteZoom;
                            const { width, height } = RESOLUTION_CONFIG[resolution];
                            const lat = overlayCoordinates.lat || centerLat;
                            const lng = overlayCoordinates.lng || centerLng;
                            
                            // Calculate meters per pixel at this zoom
                            const metersPerPixel = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
                            const degreesPerPixelLat = metersPerPixel / 111111;
                            const degreesPerPixelLng = metersPerPixel / (111111 * Math.cos(lat * Math.PI / 180));
                            
                            const halfWidth = (width / 2) * degreesPerPixelLng;
                            const halfHeight = (height / 2) * degreesPerPixelLat;
                            
                            const imageBounds = {
                              topLeft: { lat: lat + halfHeight, lng: lng - halfWidth },
                              bottomRight: { lat: lat - halfHeight, lng: lng + halfWidth },
                            };
                            
                            // Call AI detection edge function
                            const { data: aiResult, error: aiError } = await supabase.functions.invoke('detect-building-structure', {
                              body: {
                                imageBase64: base64,
                                imageBounds,
                                dimensions: { width, height },
                              },
                            });
                            
                            if (aiError) throw aiError;
                            if (!aiResult?.success) throw new Error(aiResult?.error || 'AI detection failed');
                            
                            console.log('🏠 AI Detection result:', aiResult);
                            
                            // Convert AI result to WKT format
                            const { convertAIAnalysisToDBFormat, mergeAIGeometryWithMeasurement } = await import('@/utils/aiGeometryConverter');
                            const gpsAnalysis = aiResult.gpsAnalysis || aiResult.aiAnalysis;
                            const convertedData = convertAIAnalysisToDBFormat(gpsAnalysis);
                            
                            // Save to database
                            if (pipelineEntryId) {
                              // Cast to JSON-compatible format for Supabase
                              const linearFeaturesJson = convertedData.linear_features_wkt as unknown as Record<string, any>[];
                              
                              const { error: updateError } = await supabase
                                .from('roof_measurements')
                                .update({
                                  linear_features_wkt: linearFeaturesJson,
                                  linear_features: linearFeaturesJson,
                                  perimeter_wkt: convertedData.perimeter_wkt,
                                  total_ridge_length: convertedData.summary.ridge_ft,
                                  total_hip_length: convertedData.summary.hip_ft,
                                  total_valley_length: convertedData.summary.valley_ft,
                                  total_eave_length: convertedData.summary.eave_ft,
                                  total_rake_length: convertedData.summary.rake_ft,
                                  facet_count: convertedData.summary.facet_count,
                                  predominant_pitch: convertedData.summary.predominant_pitch,
                                  summary: {
                                    ...measurement?.summary,
                                    ...convertedData.summary,
                                  },
                                  updated_at: new Date().toISOString(),
                                })
                                .eq('customer_id', pipelineEntryId);
                              
                              if (updateError) throw updateError;
                              
                              // Reload from database
                              const { data: freshDb } = await supabase
                                .from('roof_measurements')
                                .select('*')
                                .eq('customer_id', pipelineEntryId)
                                .order('created_at', { ascending: false })
                                .limit(1)
                                .single();
                              
                              if (freshDb) {
                                setDbMeasurement(freshDb);
                              }
                            }
                            
                            toast({ 
                              title: '✅ AI Detection Complete!', 
                              description: `Detected ${convertedData.summary.facet_count} facets, ${gpsAnalysis.roofType || 'unknown'} roof type`,
                            });
                            
                            // Switch to schematic view to see results
                            setViewMode('schematic');
                            
                          } catch (err: any) {
                            console.error('AI Detection failed:', err);
                            toast({ 
                              title: 'AI Detection Failed', 
                              description: err.message, 
                              variant: 'destructive' 
                            });
                          }
                        }}
                        disabled={isRepulling || (!satelliteImageUrl && !cleanSatelliteImageUrl)}
                      >
                        <Sparkles className="h-3.5 w-3.5 mr-1.5 text-purple-500" />
                        AI Detect
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Use AI vision to detect roof ridges, hips, valleys from satellite photo</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* Satellite-specific controls */}
                  {viewMode === 'satellite' && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center">
                            <ZoomIn className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Satellite Zoom Level</TooltipContent>
                      </Tooltip>
                      <Slider
                        value={[satelliteZoom]}
                        onValueChange={(value) => setSatelliteZoom(value[0])}
                        min={18}
                        max={22}
                        step={1}
                        className="flex-1 max-w-[120px]"
                        disabled={isLoadingSatellite}
                      />
                      <Badge variant="secondary" className="text-xs min-w-[32px] justify-center">
                        {satelliteZoom}
                      </Badge>
                      <div className="flex items-center gap-1.5 pl-2 border-l">
                        <Select value={resolution} onValueChange={(v) => setResolution(v as ResolutionOption)} disabled={isLoadingSatellite}>
                          <SelectTrigger className="h-7 w-[80px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="standard">Standard</SelectItem>
                            <SelectItem value="hd">HD</SelectItem>
                            <SelectItem value="ultra">Ultra HD</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {isLoadingSatellite && (
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </>
                  )}
                </div>
                
                {/* Roof Visualization */}
                <div className="relative rounded-lg overflow-hidden border">
                  {viewMode === 'trace' ? (
                    /* Trace Mode - Draw roof features on satellite photo */
                    <RoofTracerOverlay
                      satelliteImageUrl={cleanSatelliteImageUrl}
                      centerLat={overlayCoordinates.lat}
                      centerLng={overlayCoordinates.lng}
                      zoom={satelliteZoom}
                      canvasWidth={RESOLUTION_CONFIG[resolution].width}
                      canvasHeight={RESOLUTION_CONFIG[resolution].height}
                      onSave={async (linearFeatures) => {
                        // Save traced features to database
                        try {
                          if (!pipelineEntryId) {
                            toast({ title: 'Missing property ID', variant: 'destructive' });
                            return;
                          }
                          
                          // Calculate totals from traced features
                          const totals = {
                            ridge_ft: linearFeatures.filter(f => f.type === 'ridge').reduce((sum, f) => sum + f.length_ft, 0),
                            hip_ft: linearFeatures.filter(f => f.type === 'hip').reduce((sum, f) => sum + f.length_ft, 0),
                            valley_ft: linearFeatures.filter(f => f.type === 'valley').reduce((sum, f) => sum + f.length_ft, 0),
                            perimeter_ft: linearFeatures.filter(f => f.type === 'perimeter').reduce((sum, f) => sum + f.length_ft, 0),
                            eave_ft: linearFeatures.filter(f => f.type === 'eave').reduce((sum, f) => sum + f.length_ft, 0),
                            rake_ft: linearFeatures.filter(f => f.type === 'rake').reduce((sum, f) => sum + f.length_ft, 0),
                          };
                          
                          // Update the roof_measurements record with correct column names
                          const { error } = await supabase
                            .from('roof_measurements')
                            .update({
                              linear_features_wkt: linearFeatures, // Correct column name
                              linear_features: linearFeatures, // Also update legacy column
                              total_ridge_length: Math.round(totals.ridge_ft),
                              total_hip_length: Math.round(totals.hip_ft),
                              total_valley_length: Math.round(totals.valley_ft),
                              total_eave_length: Math.round(totals.eave_ft),
                              total_rake_length: Math.round(totals.rake_ft),
                              summary: {
                                ...measurement?.summary,
                                ...totals,
                              },
                              updated_at: new Date().toISOString(),
                            })
                            .eq('customer_id', pipelineEntryId);
                          
                          if (error) throw error;
                          
                          // Reload dbMeasurement
                          const { data: freshDb } = await supabase
                            .from('roof_measurements')
                            .select('*')
                            .eq('customer_id', pipelineEntryId)
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .single();
                          
                          if (freshDb) {
                            setDbMeasurement(freshDb);
                          }
                          
                          toast({
                            title: 'Traced Features Saved',
                            description: `Saved ${linearFeatures.length} roof features`,
                          });
                          
                          // Switch to schematic view to see results
                          setViewMode('schematic');
                        } catch (err: any) {
                          console.error('Failed to save traced features:', err);
                          toast({
                            title: 'Save Failed',
                            description: err.message,
                            variant: 'destructive',
                          });
                        }
                      }}
                      onCancel={() => setViewMode('schematic')}
                    />
                  ) : viewMode === 'schematic' ? (
                    /* Schematic Roof Diagram - Clean vector rendering */
                    <SchematicRoofDiagram
                      measurement={(() => {
                        const enriched = { ...measurement };
                        if (Array.isArray(dbMeasurement?.linear_features) && dbMeasurement.linear_features.length > 0) {
                          enriched.linear_features = dbMeasurement.linear_features;
                        }
                        if (dbMeasurement?.perimeter_wkt) {
                          enriched.perimeter_wkt = dbMeasurement.perimeter_wkt;
                        }
                        return enriched;
                      })()}
                      tags={tags}
                      width={RESOLUTION_CONFIG[resolution].width}
                      height={RESOLUTION_CONFIG[resolution].height}
                      showLengthLabels={true}
                      showLegend={true}
                      showCompass={true}
                      showTotals={true}
                    />
                  ) : measurement?.faces ? (
                    /* Satellite Overlay View */
                    <ComprehensiveMeasurementOverlay
                      satelliteImageUrl={cleanSatelliteImageUrl}
                      measurement={(() => {
                        // CRITICAL FIX: Merge database WKT linear features into measurement
                        // The roof_measurements table stores linear_features_wkt array with actual WKT coordinates
                        // This enables overlay to draw accurate ridge/hip/valley lines that match satellite imagery
                        const enriched = { ...measurement };
                        
                        // Priority 1: Database linear_features array with WKT (loaded from roof_measurements.linear_features_wkt)
                        if (Array.isArray(dbMeasurement?.linear_features) && dbMeasurement.linear_features.length > 0) {
                          const hasWkt = dbMeasurement.linear_features[0]?.wkt;
                          console.log('📐 Using linear_features from database:', dbMeasurement.linear_features.length, 'features, hasWKT:', !!hasWkt);
                          enriched.linear_features = dbMeasurement.linear_features;
                        }
                        
                        // Merge perimeter_wkt from database (for complete roof outline)
                        if (dbMeasurement?.perimeter_wkt) {
                          enriched.perimeter_wkt = dbMeasurement.perimeter_wkt;
                        }
                        
                        // CRITICAL: Use analysis_zoom from database for accurate coordinate transformation
                        // The WKT coordinates were generated at this zoom level
                        if (dbMeasurement?.analysis_zoom) {
                          enriched.analysis_zoom = dbMeasurement.analysis_zoom;
                        }
                        
                        // CRITICAL FIX: Pass analysis_image_size for proper scaling
                        // WKT was generated at 640x640, but display canvas may be larger
                        if (dbMeasurement?.analysis_image_size) {
                          enriched.analysis_image_size = dbMeasurement.analysis_image_size;
                        } else {
                          // Default to 640x640 (analyze-roof-aerial IMAGE_SIZE constant)
                          enriched.analysis_image_size = { width: 640, height: 640 };
                        }
                        return enriched;
                      })()}
                      tags={tags}
                      centerLng={overlayCoordinates.lng}
                      centerLat={overlayCoordinates.lat}
                      zoom={satelliteZoom}
                      onMeasurementUpdate={(updatedMeasurement, updatedTags) => {
                        Object.assign(measurement, updatedMeasurement);
                        Object.assign(tags, updatedTags);
                        const detection = detectRoofType(updatedMeasurement, updatedTags);
                        setDetectedRoofType(detection);
                      }}
                      canvasWidth={RESOLUTION_CONFIG[resolution].width}
                      canvasHeight={RESOLUTION_CONFIG[resolution].height}
                      verifiedAddressLat={overlayCoordinates.lat}
                      verifiedAddressLng={overlayCoordinates.lng}
                      offsetX={overlayOffsetX}
                      offsetY={overlayOffsetY}
                      showDebugOverlay={showDebugOverlay}
                    />
                  ) : (
                    <PolygonEditor
                      satelliteImageUrl={satelliteImageUrl}
                      buildingPolygon={buildingPolygon}
                      centerLng={adjustedCenterLng}
                      centerLat={adjustedCenterLat}
                    zoom={satelliteZoom}
                    onPolygonChange={handlePolygonChange}
                    canvasWidth={640}
                    canvasHeight={480}
                  />
                )}
                
                {/* Re-center Buttons - Only show in satellite mode */}
                {viewMode === 'satellite' && (
                <div className="absolute top-2 right-2 flex flex-col gap-1">
                  {/* Re-center on Roof Centroid Button */}
                  {measurement?.faces?.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        // Calculate centroid from WKT facets
                        const allCoords: [number, number][] = [];
                        measurement.faces?.forEach((face: any) => {
                          const wkt = face.wkt || '';
                          const match = wkt.match(/POLYGON\(\(([^)]+)\)\)/);
                          if (match) {
                            match[1].split(',').forEach((pair: string) => {
                              const [lng, lat] = pair.trim().split(' ').map(Number);
                              if (!isNaN(lat) && !isNaN(lng)) {
                                allCoords.push([lat, lng]);
                              }
                            });
                          }
                        });
                        
                        if (allCoords.length > 0) {
                          const centroidLat = allCoords.reduce((sum, [lat]) => sum + lat, 0) / allCoords.length;
                          const centroidLng = allCoords.reduce((sum, [, lng]) => sum + lng, 0) / allCoords.length;
                          console.log('🎯 Re-centering on roof centroid:', centroidLat, centroidLng);
                          setAdjustedCenterLat(centroidLat);
                          setAdjustedCenterLng(centroidLng);
                          toast({
                            title: "Re-centered on Roof",
                            description: "Satellite image centered on detected roof structure",
                          });
                        }
                      }}
                      disabled={isLoadingSatellite}
                      className="bg-background/95 backdrop-blur shadow-lg text-xs"
                    >
                      <MapPin className="h-3 w-3 mr-1" />
                      Center on Roof
                    </Button>
                  )}
                  
                  {/* Reset to Verified Address Button */}
                  {coordinateMismatchDistance > 20 && verifiedAddressLat && verifiedAddressLng && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        console.log('🏠 Resetting to verified address coordinates');
                        setAdjustedCenterLat(verifiedAddressLat);
                        setAdjustedCenterLng(verifiedAddressLng);
                        handleRegenerateVisualization(verifiedAddressLat, verifiedAddressLng, manualZoom);
                      }}
                      disabled={isRegenerating || !isOnline}
                      className="bg-background/95 backdrop-blur shadow-lg text-xs"
                      title="Center on house address"
                    >
                      <Home className="h-3 w-3 mr-1" />
                      Reset to Home
                    </Button>
                  )}
                </div>
                )}
                
                {/* Offline Notice */}
                {!isOnline && (
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-muted/90 backdrop-blur border px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg">
                    🔴 Offline — showing last saved view, cannot update satellite image
                  </div>
                )}
                
                {/* API Error Banner */}
                {regenerationError && isOnline && (
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-destructive/90 backdrop-blur text-destructive-foreground px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg max-w-md">
                    ⚠️ {regenerationError} — Last good image shown
                  </div>
                )}
                
                {/* Drag/Zoom Instructions */}
                <div className="absolute bottom-2 right-2 bg-muted/90 backdrop-blur border px-2 py-1 rounded-lg text-[10px] font-medium shadow-lg">
                  💡 Drag to pan • Scroll to zoom
                </div>
              </div>
              
              {/* Coordinate Accuracy Panel - Only show in satellite mode */}
              {viewMode === 'satellite' && verifiedAddressLat && verifiedAddressLng && (
                <div className={`p-3 rounded-lg border ${
                  coordinateMismatchDistance > 50 
                    ? 'bg-destructive/10 border-destructive' 
                    : coordinateMismatchDistance > 30
                    ? 'bg-yellow-500/10 border-yellow-500'
                    : 'bg-green-500/10 border-green-500'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Satellite className="h-4 w-4" />
                      <span className="text-sm font-semibold">Coordinate Accuracy</span>
                    </div>
                    <Badge variant={
                      coordinateMismatchDistance > 50 
                        ? 'destructive' 
                        : coordinateMismatchDistance > 30
                        ? 'secondary'
                        : 'default'
                    }>
                      {coordinateMismatchDistance < 10 
                        ? '✓ Accurate'
                        : coordinateMismatchDistance < 30
                        ? 'Good'
                        : coordinateMismatchDistance < 50
                        ? '⚠ Offset Detected'
                        : '⚠ Critical Offset'
                      }
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>Distance from verified address:</span>
                      <span className="font-medium">{Math.round(coordinateMismatchDistance)}m ({Math.round(coordinateMismatchDistance * 3.28084)}ft)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Source:</span>
                      <span className="font-medium">Google-verified coordinates</span>
                    </div>
                  </div>
                  {coordinateMismatchDistance > 30 && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        console.log('🔧 Auto-correcting coordinates to verified address');
                        setAdjustedCenterLat(verifiedAddressLat);
                        setAdjustedCenterLng(verifiedAddressLng);
                        handleRegenerateVisualization(verifiedAddressLat, verifiedAddressLng, 0);
                      }}
                      disabled={isRegenerating || !isOnline}
                      className="w-full mt-2"
                    >
                      <Home className="h-4 w-4 mr-1.5" />
                      Auto-Correct to Verified Address
                    </Button>
                  )}
                </div>
              )}
              
              {/* Smart Roof Type Detection Display */}
              {detectedRoofType && (
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Home className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Detected Roof Type:</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="default">{detectedRoofType.type}</Badge>
                      <Badge variant="outline" className="text-xs">
                        {Math.round(detectedRoofType.confidence * 100)}% confident
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        Complexity: {detectedRoofType.complexity}/5
                      </Badge>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Roof Feature Legend - Only show in satellite mode */}
              {viewMode === 'satellite' && (
              <div className="p-3 bg-muted/30 rounded-lg border">
                <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide text-muted-foreground">Overlay Legend</h4>
                <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-1 rounded-full" style={{ backgroundColor: '#22c55e' }} />
                    <span>Ridge</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-1 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
                    <span>Hip</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-1 rounded-full" style={{ backgroundColor: '#ef4444' }} />
                    <span>Valley</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-1 rounded-full" style={{ backgroundColor: '#06b6d4' }} />
                    <span>Eave</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-1 rounded-full" style={{ backgroundColor: '#d946ef' }} />
                    <span>Rake</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-1 rounded-full" style={{ backgroundColor: '#f97316' }} />
                    <span>Perimeter</span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Solid lines = AI Vision (high confidence) • Dashed = AI estimated
                </p>
              </div>
              )}
              {/* Source and Confidence */}
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Satellite className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Source: {source}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-2 w-2 rounded-full ${
                          i < confidence.dots ? 'bg-primary' : 'bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                
                {/* Visualization Status Indicator */}
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-xs text-muted-foreground">Image Source:</span>
                  <div className="flex items-center gap-2">
                    {/* Historical imagery badge */}
                    {measurement?.image_source?.includes('wayback') && (
                      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                        <History className="h-3 w-3" />
                        {measurement?.image_year || 'Historical'}
                      </Badge>
                    )}
                    {measurement?.mapbox_visualization_url ? (
                      <Badge variant="default" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Aerial Photo
                      </Badge>
                    ) : satelliteImageUrl?.includes('data:image') ? (
                      <Badge variant="secondary" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Satellite View
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <X className="h-3 w-3" />
                        No Image
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Regenerate Visualization Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRegenerateVisualization()}
                  disabled={isRegenerating || !measurement?.id || !isOnline}
                  className="w-full"
                >
                  {isRegenerating ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Regenerating...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh Satellite View
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

            {/* Right Panel: Measurement Details */}
            <div className="space-y-3">
              {/* PLAN vs SURFACE Area Cards */}
              <div className="grid grid-cols-2 gap-2">
                <Card className="p-2 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">PLAN Area (Footprint)</p>
                  <p className="text-lg font-bold">{planArea.toFixed(0)} sq ft</p>
                </Card>
                <Card className="p-2 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">SURFACE Area (Pitched)</p>
                  <p className="text-lg font-bold">{roofAreaNoWaste.toFixed(0)} sq ft</p>
                  <p className="text-[10px] text-muted-foreground">× {pitchFactor.toFixed(3)} slope factor</p>
                </Card>
              </div>
              
              {/* Order Quantity Card */}
              <Card className="p-3 bg-primary/10 border-primary/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Order Quantity (+{wastePercent}% waste)</p>
                    <p className="text-2xl font-bold text-primary">{roofSquares.toFixed(1)} squares</p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {selectedPitch} pitch
                  </Badge>
                </div>
              </Card>

              {/* Adjustments Section - Always visible */}
              <Card className="p-3 bg-primary/5 border-primary/20">
                <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide text-muted-foreground">Adjustments</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Pitch</label>
                    <Select value={selectedPitch} onValueChange={handlePitchChange}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(PITCH_MULTIPLIERS).map(p => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Waste</label>
                    <Select value={wastePercent.toString()} onValueChange={(v) => setWastePercent(Number(v))}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10%</SelectItem>
                        <SelectItem value="12">12%</SelectItem>
                        <SelectItem value="15">15%</SelectItem>
                        <SelectItem value="20">20%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Stories</label>
                    <Input type="number" value={numberOfStories} onChange={(e) => setNumberOfStories(parseInt(e.target.value) || 1)} className="h-8 text-xs" min="1" max="5" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Facets</label>
                    <Input type="number" value={faceCount} onChange={(e) => setFaceCount(Number(e.target.value))} className="h-8 text-xs" min="1" max="20" />
                  </div>
                </div>
              </Card>
              
              {/* Manual Overlay Offset Adjustment */}
              <Card className="p-3 bg-muted/30 border">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overlay Alignment</h4>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={showDebugOverlay}
                      onCheckedChange={setShowDebugOverlay}
                      className="scale-75"
                    />
                    <span className="text-[10px] text-muted-foreground">Debug</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-muted-foreground">Horizontal (←→)</label>
                      <span className="text-xs font-mono">{overlayOffsetX}px</span>
                    </div>
                    <Slider
                      value={[overlayOffsetX]}
                      onValueChange={([v]) => setOverlayOffsetX(v)}
                      min={-50}
                      max={50}
                      step={1}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-muted-foreground">Vertical (↑↓)</label>
                      <span className="text-xs font-mono">{overlayOffsetY}px</span>
                    </div>
                    <Slider
                      value={[overlayOffsetY]}
                      onValueChange={([v]) => setOverlayOffsetY(v)}
                      min={-50}
                      max={50}
                      step={1}
                      className="w-full"
                    />
                  </div>
                  {(overlayOffsetX !== 0 || overlayOffsetY !== 0) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setOverlayOffsetX(0); setOverlayOffsetY(0); }}
                      className="w-full h-7 text-xs"
                    >
                      Reset Offsets
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  💡 Nudge overlay if lines don't align with roof edges
                </p>
              </Card>

              {/* Collapsible: Roof Geometry */}
              <Collapsible open={geometryOpen} onOpenChange={setGeometryOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-md hover:bg-muted/50 text-sm font-medium">
                  <span>📐 Roof Geometry</span>
                  {geometryOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 text-xs pt-1">
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Plan Area:</span><span>{planArea.toFixed(0)} sq ft</span></div>
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Roof Area:</span><span>{roofAreaNoWaste.toFixed(0)} sq ft</span></div>
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">With Waste:</span><span>{totalAreaWithWaste.toFixed(0)} sq ft</span></div>
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Perimeter:</span><span>{perimeter.toFixed(0)} ft</span></div>
                  <div className="flex justify-between py-1"><span className="text-muted-foreground">Flat Area (≤2/12):</span><span>{flatArea.toFixed(0)} sq ft</span></div>
                </CollapsibleContent>
              </Collapsible>

              {/* Collapsible: Linear Features */}
              <Collapsible open={linearOpen} onOpenChange={setLinearOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-md hover:bg-muted/50 text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <span>📏 Linear Features</span>
                    {isLoadingDbMeasurement && (
                      <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {linearOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-1">
                  {isLoadingDbMeasurement ? (
                    <div className="flex items-center justify-center gap-2 p-4 text-muted-foreground">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span className="text-xs">Loading measurements from database...</span>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-1">
                        {[{ l: 'Ridge', v: ridge }, { l: 'Hip', v: hip }, { l: 'Valley', v: valley }, { l: 'Eave', v: eave }, { l: 'Rake', v: rake }, { l: 'Step', v: step }].map(({ l, v }) => (
                          <div key={l} className={`p-2 rounded text-center ${v === 0 ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-muted/30'}`}>
                            <div className="text-sm font-semibold">{v.toFixed(0)}'</div>
                            <div className="text-[10px] text-muted-foreground">{l}</div>
                          </div>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRefreshMeasurements}
                        disabled={isLoadingDbMeasurement || !pipelineEntryId}
                        className="w-full h-7 text-xs"
                      >
                        <RefreshCw className={`h-3 w-3 mr-1.5 ${isLoadingDbMeasurement ? 'animate-spin' : ''}`} />
                        Refresh from Database
                      </Button>
                    </>
                  )}
                </CollapsibleContent>
              </Collapsible>

              {/* Collapsible: Penetrations */}
              <Collapsible open={penetrationsOpen} onOpenChange={setPenetrationsOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-md hover:bg-muted/50 text-sm font-medium">
                  <span>🔧 Penetrations</span>
                  {penetrationsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="grid grid-cols-2 gap-2 pt-1">
                  {[
                    { label: 'Pipes', value: pipeVents, setter: setPipeVents },
                    { label: 'Skylights', value: skylights, setter: setSkylights },
                    { label: 'Chimneys', value: chimneys, setter: setChimneys },
                    { label: 'HVAC', value: hvacUnits, setter: setHvacUnits },
                  ].map(({ label, value, setter }) => (
                    <div key={label} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <Input type="number" value={value} onChange={(e) => setter(Number(e.target.value))} className="w-14 h-6 text-xs" min="0" />
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>

              {/* Collapsible: Materials */}
              <Collapsible open={materialsOpen} onOpenChange={setMaterialsOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-md hover:bg-muted/50 text-sm font-medium">
                  <span>📦 Materials</span>
                  {materialsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 text-xs pt-1">
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Shingles:</span><span>{shingleBundles} bundles</span></div>
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Ridge Cap:</span><span>{ridgeCapBundles} bundles</span></div>
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Valley:</span><span>{valleyRolls} rolls</span></div>
                  <div className="flex justify-between py-1"><span className="text-muted-foreground">Drip Edge:</span><span>{dripEdgeSticks} sticks</span></div>
                </CollapsibleContent>
              </Collapsible>

              {/* Collapsible: Validation Report */}
              <Collapsible open={validationOpen} onOpenChange={setValidationOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-md hover:bg-muted/50 text-sm font-medium">
                  <span>📋 Validation Report</span>
                  {validationOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1">
                  <MeasurementValidationReport
                    measurement={measurement}
                    tags={tags}
                    imageryDate={measurement?.metadata?.imageryDate || measurement?.solar_api_response?.imageryDate || dbMeasurement?.solar_api_response?.imageryDate}
                    onDrawManually={() => setShowManualEditor(true)}
                  />
                </CollapsibleContent>
              </Collapsible>

              {/* Collapsible: Measurement Trace */}
              <Collapsible open={showTracePanel} onOpenChange={setShowTracePanel}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-md hover:bg-muted/50 text-sm font-medium">
                  <span>🔍 Measurement Trace</span>
                  {showTracePanel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1">
                  <MeasurementTracePanel
                    measurement={dbMeasurement || measurement}
                    tags={tags}
                    onFixOutline={() => setShowManualEditor(true)}
                  />
                </CollapsibleContent>
              </Collapsible>

              {/* Measurement Debug Panel (Phase 5) */}
              <MeasurementDebugPanel
                measurement={measurement}
                dbMeasurement={dbMeasurement}
                tags={tags}
                centerLat={adjustedCenterLat}
                centerLng={adjustedCenterLng}
                satelliteZoom={satelliteZoom}
              />

              {/* View Historical Imagery Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHistoricalComparison(true)}
                className="w-full gap-2"
              >
                <History className="h-4 w-4" />
                Compare Historical Imagery
              </Button>

              {/* Warning for low confidence */}
              {confidence.dots < 3 && (
                <div className="flex items-center gap-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs">
                  <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                  <span className="text-destructive">Low confidence - verify manually</span>
                  <Button size="sm" variant="outline" className="ml-auto h-6 text-xs" onClick={() => setShowManualEditor(true)}>
                    <Edit3 className="h-3 w-3 mr-1" />Edit
                  </Button>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-1.5 px-4 py-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={handleReject} disabled={isAccepting}>
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cancel</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  const lat = verifiedAddressLat ?? centerLat;
                  const lng = verifiedAddressLng ?? centerLng;
                  toast({
                    title: "Force Regenerating Satellite View",
                    description: `Using ${verifiedAddressLat ? 'verified address' : 'bounds center'} coordinates`,
                  });
                  setManualZoom(0);
                  setAdjustedCenterLat(lat);
                  setAdjustedCenterLng(lng);
                  handleRegenerateVisualization(lat, lng, 0);
                }}
                disabled={isRegenerating}
              >
                <RefreshCw className={`h-4 w-4 ${isRegenerating ? 'animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Force Regenerate Satellite</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  if (!satelliteImageUrl) {
                    toast({ title: "Satellite Image Required", variant: "destructive" });
                    return;
                  }
                  setShowManualEditor(true);
                }}
                disabled={isAccepting || !satelliteImageUrl}
              >
                <Edit3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Verify Manually</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  if (!satelliteImageUrl) {
                    toast({ title: "Satellite Image Required", variant: "destructive" });
                    return;
                  }
                  setShowFacetSplitter(true);
                }}
                disabled={isAccepting || !satelliteImageUrl}
              >
                <Split className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split Facets</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowReportPreview(true)}
                disabled={isAccepting}
              >
                <FileText className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Preview Report</TooltipContent>
          </Tooltip>
          
          <div className="flex-1" />
          
          <Button onClick={handleAccept} disabled={isAccepting} variant="secondary" size="sm">
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {isAccepting ? 'Applying...' : 'Accept'}
          </Button>
          <Button onClick={handleAcceptAndCreateEstimate} disabled={isAccepting} size="sm">
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {isAccepting ? 'Processing...' : 'Accept & Estimate'}
          </Button>
         </DialogFooter>
         </TooltipProvider>
        
        {/* Documentation Section - Collapsible */}
        <div className="mt-4 px-6 pb-6">
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Info className="h-4 w-4" />
              About Measurement Data Sources
              <ChevronDown className="h-4 w-4 transition-transform duration-200" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <MeasurementSystemLimitations />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DialogContent>

      {/* Manual Measurement Editor Modal */}
      {satelliteImageUrl && (
        <ManualMeasurementEditor
          open={showManualEditor}
          onOpenChange={setShowManualEditor}
          satelliteImageUrl={satelliteImageUrl}
          initialMeasurement={measurement}
          initialTags={tags}
          centerLat={centerLat}
          centerLng={centerLng}
          onSave={handleManualMeasurementSave}
        />
      )}
      
      {/* Facet Splitter Modal */}
      {satelliteImageUrl && showFacetSplitter && (
        <Dialog open={showFacetSplitter} onOpenChange={setShowFacetSplitter}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Split Building into Roof Facets</DialogTitle>
            </DialogHeader>
            <FacetSplitterOverlay
              satelliteImageUrl={satelliteImageUrl}
              buildingPolygon={buildingPolygon}
              measurement={measurement}
              centerLng={centerLng}
              centerLat={centerLat}
              zoom={20}
              onSave={handleFacetSplitterSave}
              onCancel={() => setShowFacetSplitter(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Historical Imagery Comparison Dialog */}
      <HistoricalImageryComparison
        open={showHistoricalComparison}
        onOpenChange={setShowHistoricalComparison}
        lat={verifiedAddressLat || centerLat}
        lng={verifiedAddressLng || centerLng}
        baselineDate={measurement?.metadata?.imageryDate || measurement?.solar_api_response?.imageryDate || dbMeasurement?.solar_api_response?.imageryDate}
        onFlagForReview={() => {
          toast({
            title: "Flagged for Review",
            description: "This measurement has been flagged for manual review due to imagery discrepancy.",
          });
          setShowHistoricalComparison(false);
        }}
      />

      {/* EagleView-Style Report Preview with Approval */}
      <EagleViewStyleReport
        open={showReportPreview}
        onOpenChange={setShowReportPreview}
        measurementId={dbMeasurement?.id}
        measurement={dbMeasurement || measurement}
        tags={tags}
        address={measurement?.address || 'Unknown Address'}
        pipelineEntryId={pipelineEntryId}
        satelliteImageUrl={satelliteImageUrl}
        tenantId={tenantId || undefined}
        onApproved={() => {
          setShowReportPreview(false);
          toast({
            title: "Measurements Approved",
            description: "Smart tags saved and report available in Documents.",
          });
        }}
      />
    </Dialog>
  );
}
