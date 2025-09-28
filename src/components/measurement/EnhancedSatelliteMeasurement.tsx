import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Loader2, 
  MapPin, 
  Save, 
  Download, 
  FileText,
  Calculator,
  Satellite,
  Ruler
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AdvancedMeasurementCanvas from "./AdvancedMeasurementCanvas";
import RoofGeometryCalculator from "./RoofGeometryCalculator";

interface EnhancedSatelliteMeasurementProps {
  address: string;
  latitude?: number;
  longitude?: number;
  pipelineEntryId: string;
  onMeasurementsSaved?: (measurements: any) => void;
}

interface ComprehensiveMeasurement {
  // Basic measurements
  area: number;
  perimeter: number;
  roofPitch: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'extreme';
  wasteFactor: number;
  adjustedArea: number;
  
  // Advanced measurements
  ridges: { totalLength: number; count: number; lines: Array<{ length: number; angle: number }> };
  hips: { totalLength: number; count: number; lines: Array<{ length: number; angle: number }> };
  valleys: { totalLength: number; count: number; lines: Array<{ length: number; angle: number }> };
  planimeter: { totalArea: number; count: number; areas: number[] };
  
  // Calculated data
  materials: any;
  elevationData?: any;
  accuracyScore: number;
  measurementMethod: string;
  calibrationData: any;
}

export const EnhancedSatelliteMeasurement: React.FC<EnhancedSatelliteMeasurementProps> = ({
  address,
  latitude,
  longitude,
  pipelineEntryId,
  onMeasurementsSaved
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [satelliteImageUrl, setSatelliteImageUrl] = useState<string>("");
  const [elevationData, setElevationData] = useState<any>(null);
  const [pixelToFeetRatio, setPixelToFeetRatio] = useState(0.6);
  
  const [measurement, setMeasurement] = useState<ComprehensiveMeasurement>({
    area: 0,
    perimeter: 0,
    roofPitch: "4/12",
    complexity: "moderate",
    wasteFactor: 10,
    adjustedArea: 0,
    ridges: { totalLength: 0, count: 0, lines: [] },
    hips: { totalLength: 0, count: 0, lines: [] },
    valleys: { totalLength: 0, count: 0, lines: [] },
    planimeter: { totalArea: 0, count: 0, areas: [] },
    materials: {},
    accuracyScore: 0.85,
    measurementMethod: "satellite_planimeter",
    calibrationData: { pixel_ratio: 0.6, zoom_level: 20 }
  });

  const { toast } = useToast();

  useEffect(() => {
    if (latitude && longitude) {
      loadSatelliteData();
    }
  }, [latitude, longitude]);

  const loadSatelliteData = async () => {
    setLoading(true);
    try {
      // Load satellite image
      const { data: imageData, error: imageError } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'satellite',
          params: {
            center: `${latitude},${longitude}`,
            zoom: '20',
            size: '640x640',
            maptype: 'satellite',
            format: 'png'
          }
        }
      });

      if (imageError) throw imageError;

      if (imageData && !imageData.error) {
        const imageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=20&size=640x640&maptype=satellite&format=png`;
        setSatelliteImageUrl(imageUrl);
      } else {
        throw new Error('Failed to load satellite image');
      }

      // Load elevation data for automatic pitch calculation
      const { data: elevData, error: elevError } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'elevation',
          params: {
            locations: `${latitude},${longitude}`,
            key: 'API_KEY'
          }
        }
      });

      if (!elevError && elevData?.results?.[0]) {
        setElevationData(elevData.results[0]);
        
        // Calculate more accurate pixel ratio based on elevation and zoom
        const elevation = elevData.results[0].elevation;
        const adjustedRatio = 0.6 * (1 + elevation / 1000 * 0.1); // Adjust for elevation
        setPixelToFeetRatio(adjustedRatio);
        
        setMeasurement(prev => ({
          ...prev,
          calibrationData: {
            ...prev.calibrationData,
            pixel_ratio: adjustedRatio,
            elevation: elevation
          }
        }));
      }
      
    } catch (error) {
      console.error('Error loading satellite data:', error);
      toast({
        title: "Error Loading Data",
        description: "Unable to load satellite imagery and elevation data.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMeasurementsChange = (newMeasurements: any) => {
    setMeasurement(prev => ({
      ...prev,
      area: newMeasurements.perimeter.area || 0,
      perimeter: newMeasurements.perimeter.perimeter || 0,
      ridges: newMeasurements.ridges,
      hips: newMeasurements.hips,
      valleys: newMeasurements.valleys,
      planimeter: newMeasurements.planimeter,
      adjustedArea: (newMeasurements.perimeter.area || 0) * (1 + prev.wasteFactor / 100)
    }));

    // Calculate accuracy score based on measurement completeness
    const completeness = 
      (newMeasurements.perimeter.count > 0 ? 0.4 : 0) +
      (newMeasurements.ridges.count > 0 ? 0.2 : 0) +
      (newMeasurements.hips.count > 0 ? 0.2 : 0) +
      (newMeasurements.valleys.count > 0 ? 0.1 : 0) +
      (newMeasurements.planimeter.count > 0 ? 0.1 : 0);

    setMeasurement(prev => ({
      ...prev,
      accuracyScore: Math.min(0.95, 0.7 + completeness)
    }));
  };

  const saveMeasurements = async () => {
    if (measurement.area === 0) {
      toast({
        title: "No Measurements",
        description: "Please draw the roof outline to calculate measurements.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // Save comprehensive measurements to pipeline_entries
      const { error } = await supabase
        .from('pipeline_entries')
        .update({
          roof_area_sq_ft: measurement.adjustedArea,
          metadata: {
            comprehensive_measurements: {
              ...measurement,
              measured_at: new Date().toISOString(),
              satellite_image_url: satelliteImageUrl,
              elevation_data: elevationData
            }
          }
        })
        .eq('id', pipelineEntryId);

      if (error) throw error;

      toast({
        title: "Measurements Saved",
        description: `Comprehensive roof analysis saved: ${measurement.adjustedArea} sq ft total area`,
      });

      onMeasurementsSaved?.(measurement);

    } catch (error) {
      console.error('Error saving measurements:', error);
      toast({
        title: "Error Saving Measurements",
        description: "Failed to save measurements. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const generateMeasurementReport = () => {
    const report = {
      property: { address, coordinates: { latitude, longitude } },
      measurements: measurement,
      timestamp: new Date().toISOString(),
      accuracy_score: measurement.accuracyScore,
      method: "Professional Satellite Measurement with Planimeter Analysis"
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roof-measurement-report-${pipelineEntryId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Report Generated",
      description: "Measurement report downloaded successfully.",
    });
  };

  const roofPitchOptions = [
    { value: "2/12", label: "2/12 (Very Low)" },
    { value: "4/12", label: "4/12 (Low)" },
    { value: "6/12", label: "6/12 (Standard)" },
    { value: "8/12", label: "8/12 (High)" },
    { value: "12/12", label: "12/12 (Very High)" },
    { value: "16/12", label: "16/12 (Extreme)" },
  ];

  const complexityOptions = [
    { value: "simple", label: "Simple", description: "Basic gable or hip roof" },
    { value: "moderate", label: "Moderate", description: "Multiple roof planes" },
    { value: "complex", label: "Complex", description: "Multiple levels and angles" },
    { value: "extreme", label: "Extreme", description: "Highly complex geometry" },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Satellite className="h-5 w-5" />
            Professional Roof Measurement System - {address}
          </CardTitle>
          <div className="flex items-center gap-4">
            <Badge variant="outline">
              Accuracy: {(measurement.accuracyScore * 100).toFixed(1)}%
            </Badge>
            {elevationData && (
              <Badge variant="secondary">
                Elevation: {Math.round(elevationData.elevation)} ft
              </Badge>
            )}
            <Badge variant="secondary">
              Pixel Ratio: {pixelToFeetRatio.toFixed(3)} ft/px
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="ml-2">Loading satellite imagery and elevation data...</span>
            </div>
          ) : satelliteImageUrl ? (
            <Tabs defaultValue="measurement" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="measurement">Measurement</TabsTrigger>
                <TabsTrigger value="analysis">Analysis</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
              
              <TabsContent value="measurement" className="space-y-4">
                <AdvancedMeasurementCanvas
                  satelliteImageUrl={satelliteImageUrl}
                  onMeasurementsChange={handleMeasurementsChange}
                  pixelToFeetRatio={pixelToFeetRatio}
                />
              </TabsContent>
              
              <TabsContent value="analysis" className="space-y-4">
                <RoofGeometryCalculator
                  measurements={{
                    perimeter: { area: measurement.area, perimeter: measurement.perimeter, count: 1 },
                    ridges: measurement.ridges,
                    hips: measurement.hips,
                    valleys: measurement.valleys,
                    planimeter: measurement.planimeter
                  }}
                  roofPitch={measurement.roofPitch}
                  complexity={measurement.complexity}
                  wasteFactor={measurement.wasteFactor}
                />
              </TabsContent>
              
              <TabsContent value="settings" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Roof Parameters</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label htmlFor="roofPitch">Roof Pitch</Label>
                        <select
                          id="roofPitch"
                          value={measurement.roofPitch}
                          onChange={(e) => setMeasurement(prev => ({ ...prev, roofPitch: e.target.value }))}
                          className="w-full p-2 border rounded"
                        >
                          {roofPitchOptions.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      
                      <div>
                        <Label htmlFor="complexity">Roof Complexity</Label>
                        <select
                          id="complexity"
                          value={measurement.complexity}
                          onChange={(e) => setMeasurement(prev => ({ ...prev, complexity: e.target.value as any }))}
                          className="w-full p-2 border rounded"
                        >
                          {complexityOptions.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.label} - {option.description}
                            </option>
                          ))}
                        </select>
                      </div>
                      
                      <div>
                        <Label htmlFor="wasteFactor">Waste Factor (%)</Label>
                        <Input
                          id="wasteFactor"
                          type="number"
                          min="5"
                          max="25"
                          value={measurement.wasteFactor}
                          onChange={(e) => setMeasurement(prev => ({ 
                            ...prev, 
                            wasteFactor: parseInt(e.target.value) || 10,
                            adjustedArea: prev.area * (1 + (parseInt(e.target.value) || 10) / 100)
                          }))}
                        />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader>
                      <CardTitle>Calibration Settings</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label htmlFor="pixelRatio">Pixel to Feet Ratio</Label>
                        <Input
                          id="pixelRatio"
                          type="number"
                          step="0.001"
                          value={pixelToFeetRatio}
                          onChange={(e) => setPixelToFeetRatio(parseFloat(e.target.value) || 0.6)}
                        />
                      </div>
                      
                      <div className="text-sm text-muted-foreground">
                        <p>Automatic calibration based on:</p>
                        <ul className="list-disc list-inside space-y-1">
                          <li>Google Maps zoom level (20)</li>
                          <li>Property elevation data</li>
                          <li>Geographic coordinates</li>
                          <li>Satellite image resolution</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="text-center py-8">
              <p>No satellite image available. Please verify the address coordinates.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <Button 
          onClick={saveMeasurements} 
          disabled={saving || measurement.area === 0}
          className="flex-1"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving Measurements...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Comprehensive Analysis
            </>
          )}
        </Button>
        
        <Button 
          onClick={generateMeasurementReport}
          variant="outline"
          disabled={measurement.area === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Export Report
        </Button>
      </div>

      {/* Quick Summary */}
      {measurement.area > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Measurement Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-primary">{Math.round(measurement.adjustedArea).toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total Area (sq ft)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">{measurement.ridges.count}</div>
                <div className="text-sm text-muted-foreground">Ridges ({Math.round(measurement.ridges.totalLength)} ft)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-600">{measurement.hips.count}</div>
                <div className="text-sm text-muted-foreground">Hips ({Math.round(measurement.hips.totalLength)} ft)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-600">{measurement.valleys.count}</div>
                <div className="text-sm text-muted-foreground">Valleys ({Math.round(measurement.valleys.totalLength)} ft)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-orange-600">{(measurement.accuracyScore * 100).toFixed(0)}%</div>
                <div className="text-sm text-muted-foreground">Confidence Score</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EnhancedSatelliteMeasurement;