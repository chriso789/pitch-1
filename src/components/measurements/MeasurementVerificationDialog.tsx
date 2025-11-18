import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { CheckCircle2, Edit3, X, Satellite, AlertCircle, RefreshCw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, ArrowRight as ArrowRightIcon, ZoomIn, ZoomOut, Scissors } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PolygonEditor } from './PolygonEditor';
import { ComprehensiveMeasurementOverlay } from './ComprehensiveMeasurementOverlay';
import { ManualMeasurementEditor } from './ManualMeasurementEditor';
import { FacetSplitterOverlay } from './FacetSplitterOverlay';
import { parseWKTPolygon, calculatePolygonAreaSqft, calculatePerimeterFt } from '@/utils/geoCoordinates';
import { useManualVerification } from '@/hooks/useMeasurement';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { detectRoofType } from '@/utils/measurementGeometry';

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
  
  const manualVerify = useManualVerification();
  
  // Smart roof type detection
  const [detectedRoofType, setDetectedRoofType] = useState<ReturnType<typeof detectRoofType> | null>(null);
  
  useEffect(() => {
    if (measurement && tags) {
      const detection = detectRoofType(measurement, tags);
      setDetectedRoofType(detection);
    }
  }, [measurement, tags]);
  
  // Update satellite image URL when prop changes
  useEffect(() => {
    setSatelliteImageUrl(initialSatelliteImageUrl);
  }, [initialSatelliteImageUrl]);
  
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

    // Persist adjusted measurements to database
    try {
      if (measurement?.id) {
        const { error: measurementError } = await supabase
          .from('measurements')
          .update({
            summary: {
              total_area_sqft: roofArea,
              total_squares: squares,
              waste_pct: wastePercent,
              pitch: selectedPitch,
              pitch_factor: pitchFactor,
              perimeter: perimeter,
              stories: numberOfStories,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', measurement.id);
        
        if (measurementError) {
          console.error('Failed to update measurement:', measurementError);
        }
      }

      // Update pipeline entry metadata with adjusted measurements
      if (measurement?.property_id) {
        const { data: pipelineData } = await (supabase as any)
          .from('pipeline_entries')
          .select('metadata')
          .eq('property_id', measurement.property_id)
          .single();

        if (pipelineData) {
          const existingMetadata = (pipelineData.metadata as any) || {};
          
          await (supabase as any)
            .from('pipeline_entries')
            .update({
              metadata: {
                ...existingMetadata,
                comprehensive_measurements: updatedMeasurement,
                roof_area_sq_ft: roofArea,
                roof_pitch: selectedPitch,
              }
            })
            .eq('property_id', measurement.property_id);
        }
      }
    } catch (error) {
      console.error('Failed to save adjusted measurements:', error);
      toast({
        title: "Warning",
        description: "Measurements accepted but may not have saved to database",
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
      
      // Save to database
      if (measurement?.id) {
        const { error } = await supabase
          .from('measurements')
          .update({
            faces: updatedMeasurement.faces,
            summary: updatedMeasurement.summary,
          })
          .eq('id', measurement.id);
          
        if (error) throw error;
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

  // Calculate measurements (use adjusted values if available)
  const planArea = adjustedArea || tags['roof.plan_sqft'] || 0;
  const flatArea = calculateFlatArea();
  const roofAreaNoWaste = planArea * pitchFactor;
  const totalAreaWithWaste = roofAreaNoWaste * (1 + wastePercent / 100);
  const roofSquares = totalAreaWithWaste / 100;
  const perimeter = buildingPolygon.length > 0 
    ? calculatePerimeterFt(adjustedPolygon || buildingPolygon)
    : (tags['lf.eave'] || 0) + (tags['lf.rake'] || 0) + (tags['lf.ridge'] || 0) + (tags['lf.hip'] || 0) + (tags['lf.valley'] || 0) + (tags['lf.step'] || 0);

  // Linear features (use 'lf.' prefix for tag keys)
  const ridge = tags['lf.ridge'] || 0;
  const hip = tags['lf.hip'] || 0;
  const valley = tags['lf.valley'] || 0;
  const eave = tags['lf.eave'] || 0;
  const rake = tags['lf.rake'] || 0;
  const step = tags['lf.step'] || 0;

  // Recalculate materials when measurements change
  useEffect(() => {
    setShingleBundles(Math.ceil(roofSquares * 3));
    setRidgeCapBundles(Math.ceil((ridge + hip) / 33));
    setValleyRolls(Math.ceil(valley / 50));
    setDripEdgeSticks(Math.ceil((eave + rake) / 10));
  }, [roofSquares, ridge, hip, valley, eave, rake]);

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

    setIsRegenerating(true);

    try {
      toast({
        title: "Regenerating Visualization",
        description: "Fetching updated satellite imagery...",
      });

      const { data, error } = await supabase.functions.invoke('generate-measurement-visualization', {
        body: {
          measurement_id: measurement.id,
          property_id: measurement.property_id,
          center_lat: lat ?? adjustedCenterLat,
          center_lng: lng ?? adjustedCenterLng,
          zoom_adjustment: zoomAdjust ?? manualZoom,
        }
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Regeneration failed');

      // Update the satellite image URL with the new visualization
      const newVisualizationUrl = data.data.visualization_url;
      setSatelliteImageUrl(newVisualizationUrl);
      
      // Add cache buster to force reload
      const urlWithCacheBuster = `${newVisualizationUrl}?t=${Date.now()}`;
      setSatelliteImageUrl(urlWithCacheBuster);

      toast({
        title: "Visualization Updated",
        description: "Satellite imagery has been regenerated",
      });

    } catch (err: any) {
      console.error('Regenerate visualization error:', err);
      toast({
        title: "Regeneration Failed",
        description: err.message || "Could not regenerate visualization",
        variant: "destructive",
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <DialogTitle className="flex items-center gap-2">
                <Satellite className="h-5 w-5" />
                Verify Measurements
              </DialogTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Satellite className="h-3 w-3" />
                  AI Pull - Aggregate Data
                </Badge>
                {detectedRoofType && (
                  <>
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Home className="h-3 w-3" />
                      {detectedRoofType.type} Roof
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(detectedRoofType.confidence * 100)}% confidence
                    </span>
                  </>
                )}
              </div>
            </div>
            <Badge variant={confidence.variant}>
              {confidence.label} Confidence
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Google Solar API provides building-level data. Individual roof facet boundaries are approximate.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr,1fr] gap-6">
          {/* Left Panel: Visual Editor */}
          {satelliteImageUrl && (measurement?.faces || buildingPolygon.length > 0) && (
            <div className="space-y-4">
              {measurement?.faces ? (
                <ComprehensiveMeasurementOverlay
                  satelliteImageUrl={satelliteImageUrl}
                  measurement={measurement}
                  tags={tags}
                  centerLng={centerLng}
                  centerLat={centerLat}
                  zoom={20}
                  onMeasurementUpdate={(updatedMeasurement, updatedTags) => {
                    Object.assign(measurement, updatedMeasurement);
                    Object.assign(tags, updatedTags);
                    // Re-detect roof type on changes
                    const detection = detectRoofType(updatedMeasurement, updatedTags);
                    setDetectedRoofType(detection);
                  }}
                  canvasWidth={640}
                  canvasHeight={480}
                />
              ) : (
                <PolygonEditor
                  satelliteImageUrl={satelliteImageUrl}
                  buildingPolygon={buildingPolygon}
                  centerLng={centerLng}
                  centerLat={centerLat}
                  zoom={20}
                  onPolygonChange={handlePolygonChange}
                  canvasWidth={640}
                  canvasHeight={480}
                />
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
                  disabled={isRegenerating || !measurement?.id}
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
                      Regenerate Satellite View
                    </>
                  )}
                </Button>
                
                {/* Manual Pan Controls */}
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-2 text-center">Fine-tune Center Position</div>
                  <div className="flex flex-col items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePan('up')}
                      disabled={isRegenerating}
                      className="h-8 w-8 p-0"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePan('left')}
                        disabled={isRegenerating}
                        className="h-8 w-8 p-0"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePan('down')}
                        disabled={isRegenerating}
                        className="h-8 w-8 p-0"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePan('right')}
                        disabled={isRegenerating}
                        className="h-8 w-8 p-0"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                
                {/* Manual Zoom Controls */}
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-2 text-center flex items-center justify-center gap-2">
                    Zoom Level
                    <Badge variant="outline" className="font-mono">
                      {manualZoom > 0 ? `+${manualZoom}` : manualZoom}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleZoomAdjust('out')}
                      disabled={isRegenerating || manualZoom <= -1}
                      className="w-full"
                    >
                      <ZoomOut className="h-4 w-4 mr-1" />
                      Out
                    </Button>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleZoomAdjust('reset')}
                      disabled={isRegenerating || manualZoom === 0}
                      className="w-full"
                    >
                      <Home className="h-4 w-4 mr-1" />
                      Reset
                    </Button>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleZoomAdjust('in')}
                      disabled={isRegenerating || manualZoom >= 2}
                      className="w-full"
                    >
                      <ZoomIn className="h-4 w-4 mr-1" />
                      In
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    -1 (wider) to +2 (closer)
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Right Panel: Measurement Details */}
          <div className="space-y-6">

            {/* Overview Cards */}
            <div className="grid grid-cols-4 gap-3">
              <Card className="p-3 text-center">
                <div className="text-xl font-bold text-primary">{planArea.toFixed(0)}</div>
                <div className="text-xs text-muted-foreground mt-1">Plan Area (sq ft)</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-xl font-bold text-primary">{roofAreaNoWaste.toFixed(0)}</div>
                <div className="text-xs text-muted-foreground mt-1">Roof Area (sq ft)</div>
                {adjustedArea && (
                  <Badge variant="secondary" className="mt-1 text-xs">Adjusted</Badge>
                )}
              </Card>
              <Card className="p-3 text-center">
                <div className="text-xl font-bold text-primary">{totalAreaWithWaste.toFixed(0)}</div>
                <div className="text-xs text-muted-foreground mt-1">Total w/ Waste</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-xl font-bold text-primary">{roofSquares.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground mt-1">Squares</div>
              </Card>
            </div>

            {/* Adjustments Section */}
            <div className="border border-primary/20 rounded-lg p-4 bg-primary/5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                ⚙️ Adjustments
                <Badge variant="outline" className="text-xs">Editable</Badge>
              </h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">Roof Pitch:</label>
                  <Select value={selectedPitch} onValueChange={handlePitchChange}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flat">Flat (1.000)</SelectItem>
                      <SelectItem value="1/12">1/12 (1.004)</SelectItem>
                      <SelectItem value="2/12">2/12 (1.014)</SelectItem>
                      <SelectItem value="3/12">3/12 (1.031)</SelectItem>
                      <SelectItem value="4/12">4/12 (1.054)</SelectItem>
                      <SelectItem value="5/12">5/12 (1.083)</SelectItem>
                      <SelectItem value="6/12">6/12 (1.118)</SelectItem>
                      <SelectItem value="7/12">7/12 (1.158)</SelectItem>
                      <SelectItem value="8/12">8/12 (1.202)</SelectItem>
                      <SelectItem value="9/12">9/12 (1.250)</SelectItem>
                      <SelectItem value="10/12">10/12 (1.302)</SelectItem>
                      <SelectItem value="11/12">11/12 (1.357)</SelectItem>
                      <SelectItem value="12/12">12/12 (1.414)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">Waste Factor:</label>
                  <Select 
                    value={wastePercent.toString()} 
                    onValueChange={(value) => setWastePercent(Number(value))}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      <SelectItem value="10">10%</SelectItem>
                      <SelectItem value="12">12%</SelectItem>
                      <SelectItem value="15">15%</SelectItem>
                      <SelectItem value="20">20%</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">Number of Stories:</label>
                  <Input
                    type="number"
                    value={numberOfStories}
                    onChange={(e) => setNumberOfStories(parseInt(e.target.value) || 1)}
                    className="w-[80px]"
                    min="1"
                    max="5"
                    step="1"
                  />
                </div>
                
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Pitch Multiplier:</span>
                  <span className="font-mono">{pitchFactor.toFixed(4)}</span>
                </div>
              </div>
            </div>

            {/* Roof Geometry */}
            <div>
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                📐 Roof Geometry
              </h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Flat/Plan Area (≤2/12 pitch):</span>
                  <span className="font-medium">{flatArea.toFixed(0)} sq ft</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Roof Area (no waste):</span>
                  <span className="font-medium">{roofAreaNoWaste.toFixed(0)} sq ft</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Total Area (with waste):</span>
                  <span className="font-medium">{totalAreaWithWaste.toFixed(0)} sq ft</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Perimeter:</span>
                  <span className="font-medium">{perimeter.toFixed(0)} ft</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Pitch:</span>
                  <span className="font-medium">{selectedPitch} (×{pitchFactor.toFixed(3)})</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Roof Facets:</span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={faceCount}
                      onChange={(e) => setFaceCount(Number(e.target.value))}
                      className="w-[60px] h-7"
                      min="1"
                      max="20"
                    />
                    <span className="text-xs text-muted-foreground">planes</span>
                    {faceCount > 4 && (
                      <Badge variant="outline" className="text-xs">Complex</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Linear Features */}
            <div>
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                📏 Linear Features
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Ridge', value: ridge },
                  { label: 'Hip', value: hip },
                  { label: 'Valley', value: valley },
                  { label: 'Eave', value: eave },
                  { label: 'Rake', value: rake },
                  { label: 'Step', value: step },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 bg-muted/30 rounded-lg border border-muted">
                    <div className="text-lg font-bold">{value.toFixed(0)} ft</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Penetrations */}
            <div className="border border-primary/20 rounded-lg p-4 bg-primary/5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                🔧 Roof Penetrations
                <Badge variant="outline" className="text-xs">Editable</Badge>
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Pipe Vents', value: pipeVents, setter: setPipeVents },
                  { label: 'Skylights', value: skylights, setter: setSkylights },
                  { label: 'Chimneys', value: chimneys, setter: setChimneys },
                  { label: 'HVAC Units', value: hvacUnits, setter: setHvacUnits },
                  { label: 'Other', value: otherPenetrations, setter: setOtherPenetrations },
                ].map(({ label, value, setter }) => (
                  <div key={label} className="flex items-center justify-between">
                    <label className="text-sm text-muted-foreground">{label}:</label>
                    <Input
                      type="number"
                      value={value}
                      onChange={(e) => setter(Number(e.target.value))}
                      className="w-[80px] h-8"
                      min="0"
                      max="100"
                    />
                  </div>
                ))}
              </div>
            </div>


            {/* Material Quantities */}
            <div>
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                📦 Material Quantities
                <Badge variant="outline" className="text-xs">Auto-calc</Badge>
              </h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Shingle Bundles:</span>
                  <span className="font-medium">{shingleBundles} bundles</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Ridge Cap:</span>
                  <span className="font-medium">{ridgeCapBundles} bundles</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Valley Roll:</span>
                  <span className="font-medium">{valleyRolls} rolls</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Drip Edge:</span>
                  <span className="font-medium">{dripEdgeSticks} sticks</span>
                </div>
              </div>
            </div>

            {/* Warning for low confidence */}
            {confidence.dots < 3 && (
              <div className="flex items-start gap-2 p-2 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                <div className="text-sm flex-1">
                  <p className="font-medium text-destructive">Low Confidence</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    The automated measurement may have missed important roof features.
                  </p>
                </div>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setShowManualEditor(true)}
                  className="shrink-0"
                >
                  <Edit3 className="h-3 w-3 mr-1" />
                  Verify Manually
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={isAccepting}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
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
              onSave={handleFacetSplitterSave}
              onCancel={() => setShowFacetSplitter(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
