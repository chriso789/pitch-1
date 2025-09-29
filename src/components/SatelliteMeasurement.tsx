import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, Move, Ruler, Save, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SatelliteMeasurementProps {
  address: string;
  latitude?: number;
  longitude?: number;
  pipelineEntryId: string;
  onMeasurementsSaved?: (measurements: any) => void;
}

interface Measurement {
  area: number;
  perimeter: number;
  roofPitch: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'extreme';
  wasteFactor: number;
  adjustedArea: number;
}

export const SatelliteMeasurement: React.FC<SatelliteMeasurementProps> = ({
  address,
  latitude,
  longitude,
  pipelineEntryId,
  onMeasurementsSaved
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [satelliteImageUrl, setSatelliteImageUrl] = useState<string>("");
  const [measurement, setMeasurement] = useState<Measurement>({
    area: 0,
    perimeter: 0,
    roofPitch: "4/12",
    complexity: "moderate",
    wasteFactor: 10,
    adjustedArea: 0
  });
  const [isDrawing, setIsDrawing] = useState(false);
  const [points, setPoints] = useState<Array<{x: number, y: number}>>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (latitude && longitude) {
      loadSatelliteImage();
    }
  }, [latitude, longitude]);

  useEffect(() => {
    calculateMeasurements();
  }, [points, measurement.wasteFactor]);

  const loadSatelliteImage = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
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

      if (error) throw error;

      // Edge function returns the image URL or base64 data
      if (data?.url) {
        setSatelliteImageUrl(data.url);
      } else if (data?.image) {
        // If base64 data is returned
        setSatelliteImageUrl(`data:image/png;base64,${data.image}`);
      } else {
        throw new Error('No image data returned from edge function');
      }
      
    } catch (error) {
      console.error('Error loading satellite image:', error);
      toast({
        title: "Error Loading Satellite Image",
        description: "Unable to load satellite imagery. Please check the address coordinates.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    setPoints(prev => [...prev, { x, y }]);
    drawPoint(x, y);
  };

  const drawPoint = (x: number, y: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fill();

    // Draw lines between points
    if (points.length > 0) {
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const calculateMeasurements = () => {
    if (points.length < 3) return;

    // Calculate area using shoelace formula (simplified)
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    area = Math.abs(area) / 2;

    // Convert pixels to square feet (approximate)
    // At zoom level 20, 1 pixel ≈ 0.6 feet
    const pixelToFeetRatio = 0.6;
    const areaInSqFt = area * Math.pow(pixelToFeetRatio, 2);

    // Calculate perimeter
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      perimeter += Math.sqrt(dx * dx + dy * dy);
    }
    const perimeterInFt = perimeter * pixelToFeetRatio;

    // Calculate adjusted area with waste factor
    const adjustedArea = areaInSqFt * (1 + measurement.wasteFactor / 100);

    setMeasurement(prev => ({
      ...prev,
      area: Math.round(areaInSqFt),
      perimeter: Math.round(perimeterInFt),
      adjustedArea: Math.round(adjustedArea)
    }));
  };

  const clearMeasurements = () => {
    setPoints([]);
    setMeasurement(prev => ({
      ...prev,
      area: 0,
      perimeter: 0,
      adjustedArea: 0
    }));
    
    // Clear canvas
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && imageRef.current) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imageRef.current, 0, 0, 640, 640);
    }
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
      // Save measurements to enhanced_estimates or pipeline_entries metadata
      const { error } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            measurements: {
              ...measurement,
              measured_at: new Date().toISOString(),
              points: points,
              satellite_image_url: satelliteImageUrl
            }
          }
        })
        .eq('id', pipelineEntryId);

      if (error) throw error;

      toast({
        title: "Measurements Saved",
        description: `Roof area: ${measurement.adjustedArea} sq ft (including ${measurement.wasteFactor}% waste factor)`,
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

  const onImageLoad = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = imageRef.current;
    
    if (ctx && img) {
      canvas!.width = 640;
      canvas!.height = 640;
      ctx.drawImage(img, 0, 0, 640, 640);
    }
  };

  const roofPitchOptions = [
    { value: "2/12", label: "2/12 (Very Low)" },
    { value: "4/12", label: "4/12 (Low)" },
    { value: "6/12", label: "6/12 (Standard)" },
    { value: "8/12", label: "8/12 (High)" },
    { value: "12/12", label: "12/12 (Very High)" },
  ];

  const complexityOptions = [
    { value: "simple", label: "Simple", multiplier: 1.0 },
    { value: "moderate", label: "Moderate", multiplier: 1.2 },
    { value: "complex", label: "Complex", multiplier: 1.5 },
    { value: "extreme", label: "Extreme", multiplier: 2.0 },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Satellite Measurement - {address}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="ml-2">Loading satellite imagery...</span>
            </div>
          ) : satelliteImageUrl ? (
            <div className="space-y-4">
              <div className="relative">
                <img
                  ref={imageRef}
                  src={satelliteImageUrl}
                  alt="Satellite view"
                  onLoad={onImageLoad}
                  className="hidden"
                />
                <canvas
                  ref={canvasRef}
                  onClick={handleCanvasClick}
                  className="border border-gray-300 cursor-crosshair max-w-full"
                  style={{ width: '100%', maxWidth: '640px', height: 'auto' }}
                />
                <div className="absolute top-2 left-2 space-x-2">
                  <Badge variant={isDrawing ? "default" : "secondary"}>
                    {isDrawing ? "Drawing Mode" : "View Mode"}
                  </Badge>
                  {points.length > 0 && (
                    <Badge variant="outline">
                      {points.length} points
                    </Badge>
                  )}
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button
                  onClick={() => setIsDrawing(!isDrawing)}
                  variant={isDrawing ? "secondary" : "default"}
                >
                  <Move className="h-4 w-4 mr-2" />
                  {isDrawing ? "Stop Drawing" : "Start Drawing"}
                </Button>
                <Button onClick={clearMeasurements} variant="outline">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Clear
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p>No satellite image available. Please verify the address coordinates.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5" />
            Measurement Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
                    {option.label} ({option.multiplier}x)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="wasteFactor">Waste Factor (%)</Label>
            <Input
              id="wasteFactor"
              type="number"
              min="5"
              max="25"
              value={measurement.wasteFactor}
              onChange={(e) => setMeasurement(prev => ({ ...prev, wasteFactor: parseInt(e.target.value) || 10 }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
            <div>
              <Label className="text-sm text-muted-foreground">Raw Area</Label>
              <p className="text-lg font-semibold">{measurement.area.toLocaleString()} sq ft</p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Perimeter</Label>
              <p className="text-lg font-semibold">{measurement.perimeter.toLocaleString()} ft</p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Adjusted Area</Label>
              <p className="text-lg font-semibold text-primary">{measurement.adjustedArea.toLocaleString()} sq ft</p>
            </div>
          </div>

          <Button 
            onClick={saveMeasurements} 
            disabled={saving || measurement.area === 0}
            className="w-full"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving Measurements...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Measurements
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SatelliteMeasurement;