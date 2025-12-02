import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, Edit3, X, Satellite, AlertCircle, RefreshCw, Home, ArrowRight as ArrowRightIcon, ChevronDown, ChevronRight, Scissors, Info } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PolygonEditor } from './PolygonEditor';
import { ComprehensiveMeasurementOverlay } from './ComprehensiveMeasurementOverlay';
import { ManualMeasurementEditor } from './ManualMeasurementEditor';
import { FacetSplitterOverlay } from './FacetSplitterOverlay';
import { MeasurementSystemLimitations } from '@/components/documentation/MeasurementSystemLimitations';
import { parseWKTPolygon, calculatePolygonAreaSqft, calculatePerimeterFt } from '@/utils/geoCoordinates';
import { useManualVerification } from '@/hooks/useMeasurement';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { detectRoofType } from '@/utils/measurementGeometry';
import { saveMeasurementWithOfflineSupport } from '@/services/offlineMeasurementSync';
import { useOfflineSync } from '@/hooks/useOfflineSync';

// Industry-standard roof pitch multipliers
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
  
  const manualVerify = useManualVerification();
  
  // Smart roof type detection
  const [detectedRoofType, setDetectedRoofType] = useState<ReturnType<typeof detectRoofType> | null>(null);
  
  useEffect(() => {
    if (measurement && tags) {
      const detection = detectRoofType(measurement, tags);
      setDetectedRoofType(detection);
    }
  }, [measurement, tags]);
  
  // PHASE 1: Fetch clean Google Maps satellite image via proxy
  const [cleanSatelliteImageUrl, setCleanSatelliteImageUrl] = useState<string>('');
  const [isLoadingSatellite, setIsLoadingSatellite] = useState(false);
  
  useEffect(() => {
    const fetchCleanSatelliteImage = async () => {
      // ✅ Wait for verified coordinates to load first (PRIORITY #1)
      const lat = verifiedAddressLat;
      const lng = verifiedAddressLng;
      
      // Only fetch if we have verified coordinates
      if (!lat || !lng) {
        console.log('⏳ Waiting for verified address coordinates before fetching satellite...');
        return;
      }
      
      console.log(`📍 Fetching satellite centered at verified address: ${lat}, ${lng}`);
      setIsLoadingSatellite(true);
      try {
        const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
          body: {
            endpoint: 'satellite',
            params: {
              center: `${lat},${lng}`,  // ✅ Always uses verified address
              zoom: '20',
              size: '1280x1280',
              maptype: 'satellite',
              scale: '2'
            }
          }
        });
        
        if (error) throw error;
        
        if (data?.image_url) {
          setCleanSatelliteImageUrl(data.image_url);
          console.log('✅ Clean satellite image fetched successfully');
        }
      } catch (error) {
        console.error('Failed to fetch satellite image:', error);
        toast({
          title: 'Image Load Error',
          description: 'Could not load satellite image',
          variant: 'destructive'
        });
      } finally {
        setIsLoadingSatellite(false);
      }
    };
    
    fetchCleanSatelliteImage();
  }, [verifiedAddressLat, verifiedAddressLng]);  // ✅ Removed centerLat/centerLng dependency
  
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
    
    const planArea = adjustedArea || tags['roof.plan_area'] || 0;
    const roofArea = planArea * pitchFactor;
    const totalWithWaste = roofArea * (1 + wastePercent / 100);
    const squares = totalWithWaste / 100;
    const perimeter = buildingPolygon.length > 0 
      ? calculatePerimeterFt(adjustedPolygon || buildingPolygon)
      : (tags['roof.perimeter'] || 0);

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
      tags: {
        ...tags,
        'roof.total_area': roofArea,
        'roof.squares': squares,
        'roof.pitch_factor': pitchFactor,
        'roof.waste_pct': wastePercent,
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

  // Calculate measurements (use adjusted values if available, with comprehensive fallbacks)
  const planArea = adjustedArea 
    || tags['roof.plan_area'] 
    || tags['roof.plan_sqft'] 
    || measurement?.summary?.total_area_sqft 
    || measurement?.summary?.plan_area_sqft
    || measurement?.total_area_sqft
    || 0;
  const flatArea = calculateFlatArea();
  const roofAreaNoWaste = planArea * pitchFactor;
  const totalAreaWithWaste = roofAreaNoWaste * (1 + wastePercent / 100);
  const roofSquares = totalAreaWithWaste / 100;
  
  // Linear features with fallbacks to measurement.linear_features and measurement.summary
  const ridge = tags['lf.ridge'] || measurement?.linear_features?.ridge || measurement?.summary?.ridge_ft || 0;
  const hip = tags['lf.hip'] || measurement?.linear_features?.hip || measurement?.summary?.hip_ft || 0;
  const valley = tags['lf.valley'] || measurement?.linear_features?.valley || measurement?.summary?.valley_ft || 0;
  const eave = tags['lf.eave'] || measurement?.linear_features?.eave || measurement?.summary?.eave_ft || 0;
  const rake = tags['lf.rake'] || measurement?.linear_features?.rake || measurement?.summary?.rake_ft || 0;
  const step = tags['lf.step'] || measurement?.linear_features?.step || measurement?.summary?.step_ft || 0;
  
  const perimeter = buildingPolygon.length > 0 
    ? calculatePerimeterFt(adjustedPolygon || buildingPolygon)
    : (eave + rake + ridge + hip + valley + step);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] p-0 gap-0 overflow-hidden">
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
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr,340px] gap-4 p-4">
            {/* Left Panel: Visual Editor */}
            {satelliteImageUrl && (measurement?.faces || buildingPolygon.length > 0) && (
              <div className="space-y-3">
                {/* Satellite Image */}
                <div className="relative rounded-lg overflow-hidden border">
                  {measurement?.faces ? (
                    <ComprehensiveMeasurementOverlay
                      satelliteImageUrl={cleanSatelliteImageUrl}
                      measurement={measurement}
                      tags={tags}
                      centerLng={verifiedAddressLng || adjustedCenterLng}
                      centerLat={verifiedAddressLat || adjustedCenterLat}
                      zoom={20}
                      onMeasurementUpdate={(updatedMeasurement, updatedTags) => {
                        Object.assign(measurement, updatedMeasurement);
                        Object.assign(tags, updatedTags);
                        const detection = detectRoofType(updatedMeasurement, updatedTags);
                        setDetectedRoofType(detection);
                      }}
                      canvasWidth={500}
                      canvasHeight={350}
                      verifiedAddressLat={verifiedAddressLat}
                      verifiedAddressLng={verifiedAddressLng}
                    />
                  ) : (
                    <PolygonEditor
                      satelliteImageUrl={satelliteImageUrl}
                      buildingPolygon={buildingPolygon}
                      centerLng={adjustedCenterLng}
                      centerLat={adjustedCenterLat}
                    zoom={20}
                    onPolygonChange={handlePolygonChange}
                    canvasWidth={640}
                    canvasHeight={480}
                  />
                )}
                
                {/* Reset to Verified Address Button */}
                {coordinateMismatchDistance > 20 && verifiedAddressLat && verifiedAddressLng && (
                  <div className="absolute top-2 right-2">
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
                      className="bg-background/95 backdrop-blur shadow-lg"
                      title="Center on house address"
                    >
                      <Home className="h-4 w-4 mr-1.5" />
                      Reset to Home
                    </Button>
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
              
              {/* Coordinate Accuracy Panel */}
              {verifiedAddressLat && verifiedAddressLng && (
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
                  {measurement?.mapbox_visualization_url ? (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Aerial Photo
                    </Badge>
                  ) : satelliteImageUrl?.includes('data:image') ? (
                    <Badge variant="secondary" className="gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Satellite View (Fallback)
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <X className="h-3 w-3" />
                      No Satellite Image
                    </Badge>
                  )}
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
              {/* Compact Overview - Inline badges */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="text-sm py-1">
                  {planArea.toFixed(0)} sq ft plan
                </Badge>
                <Badge variant="secondary" className="text-sm py-1">
                  {roofSquares.toFixed(1)} squares
                </Badge>
                <Badge variant="outline" className="text-sm py-1">
                  {selectedPitch} pitch
                </Badge>
                <Badge variant="outline" className="text-sm py-1">
                  {wastePercent}% waste
                </Badge>
              </div>

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
                  <span>📏 Linear Features</span>
                  {linearOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="grid grid-cols-3 gap-1 pt-1">
                  {[{ l: 'Ridge', v: ridge }, { l: 'Hip', v: hip }, { l: 'Valley', v: valley }, { l: 'Eave', v: eave }, { l: 'Rake', v: rake }, { l: 'Step', v: step }].map(({ l, v }) => (
                    <div key={l} className="p-2 bg-muted/30 rounded text-center">
                      <div className="text-sm font-semibold">{v.toFixed(0)}'</div>
                      <div className="text-[10px] text-muted-foreground">{l}</div>
                    </div>
                  ))}
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

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={isAccepting}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                // Always use verified address coordinates if available
                const lat = verifiedAddressLat ?? centerLat;
                const lng = verifiedAddressLng ?? centerLng;
                
                toast({
                  title: "Force Regenerating Satellite View",
                  description: (
                    <div className="space-y-1 text-xs">
                      <div>📍 Coords: {lat.toFixed(6)}, {lng.toFixed(6)}</div>
                      <div>🔍 Zoom: Default (wider view)</div>
                      <div>📏 Source: {verifiedAddressLat ? 'Verified Address' : 'Bounds Center'}</div>
                      {coordinateMismatchDistance > 10 && (
                        <div className="text-yellow-500">
                          ⚠️ Previous offset: {Math.round(coordinateMismatchDistance)}m
                        </div>
                      )}
                    </div>
                  ),
                  duration: 5000,
                });
                
                // Reset zoom to 0 to use new default wider view from edge function
                setManualZoom(0);
                setAdjustedCenterLat(lat);
                setAdjustedCenterLng(lng);
                
                handleRegenerateVisualization(lat, lng, 0);
              }}
              disabled={isRegenerating}
              className="border-primary/50"
              title="Regenerate satellite image using verified address coordinates and default zoom. Use this to test coordinate/zoom fixes."
            >
              {isRegenerating ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Regenerating...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Force Regenerate
                </>
              )}
            </Button>
            {verifiedAddressLat && verifiedAddressLng && coordinateMismatchDistance > 30 && (
              <Badge variant="destructive" className="text-xs">
                <AlertCircle className="h-3 w-3 mr-1" />
                Regenerate recommended
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              if (!satelliteImageUrl) {
                toast({
                  title: "Satellite Image Required",
                  description: "Click 'Regenerate Satellite View' above to generate an aerial photo, or use Google Maps fallback.",
                  variant: "destructive"
                });
                return;
              }
              setShowManualEditor(true);
            }}
            disabled={isAccepting || !satelliteImageUrl}
          >
            <Edit3 className="h-4 w-4 mr-2" />
            Verify Manually
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!satelliteImageUrl) {
                toast({
                  title: "Satellite Image Required",
                  description: "Click 'Regenerate Satellite View' above to generate an aerial photo.",
                  variant: "destructive"
                });
                return;
              }
              setShowFacetSplitter(true);
            }}
            disabled={isAccepting || !satelliteImageUrl}
          >
            <Scissors className="h-4 w-4 mr-2" />
            Split Facets
          </Button>
          <Button
            onClick={handleAccept}
            disabled={isAccepting}
            variant="secondary"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {isAccepting ? 'Applying...' : 'Accept & Apply'}
          </Button>
          <Button
            onClick={handleAcceptAndCreateEstimate}
            disabled={isAccepting}
            className="bg-primary"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {isAccepting ? 'Processing...' : 'Accept & Create Estimate'}
          </Button>
         </DialogFooter>
        
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
    </Dialog>
  );
}
