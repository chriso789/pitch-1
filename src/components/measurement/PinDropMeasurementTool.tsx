import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  MapPin, 
  Ruler, 
  RotateCcw, 
  Save, 
  Square, 
  Triangle, 
  Home,
  Trash2
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PinDropMeasurementToolProps {
  satelliteImageUrl: string;
  onMeasurementsChange: (measurements: any) => void;
  pixelToFeetRatio?: number;
  initialMeasurements?: any;
}

interface MeasurementPin {
  id: string;
  x: number;
  y: number;
  type: 'perimeter' | 'ridge' | 'hip' | 'valley' | 'planimeter';
  label: string;
}

interface MeasurementLine {
  id: string;
  startPin: string;
  endPin: string;
  type: 'perimeter' | 'ridge' | 'hip' | 'valley' | 'planimeter';
  length: number;
  color: string;
}

export const PinDropMeasurementTool: React.FC<PinDropMeasurementToolProps> = ({
  satelliteImageUrl,
  onMeasurementsChange,
  pixelToFeetRatio = 0.6,
  initialMeasurements
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [pins, setPins] = useState<MeasurementPin[]>([]);
  const [lines, setLines] = useState<MeasurementLine[]>([]);
  const [activeTool, setActiveTool] = useState<'perimeter' | 'ridge' | 'hip' | 'valley' | 'planimeter'>('perimeter');
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const { toast } = useToast();

  const toolColors = {
    perimeter: '#3b82f6',
    ridge: '#ef4444', 
    hip: '#f59e0b',
    valley: '#10b981',
    planimeter: '#8b5cf6'
  };

  useEffect(() => {
    if (imageLoaded && canvasRef.current) {
      drawCanvas();
    }
  }, [pins, lines, imageLoaded]);

  useEffect(() => {
    calculateMeasurements();
  }, [pins, lines, pixelToFeetRatio]);

  const loadImage = () => {
    if (imageRef.current && satelliteImageUrl) {
      imageRef.current.onload = () => {
        setImageLoaded(true);
        if (canvasRef.current && imageRef.current) {
          canvasRef.current.width = imageRef.current.width;
          canvasRef.current.height = imageRef.current.height;
          drawCanvas();
        }
      };
      imageRef.current.src = satelliteImageUrl;
    }
  };

  useEffect(() => {
    loadImage();
  }, [satelliteImageUrl]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !imageLoaded) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw satellite image
    ctx.drawImage(image, 0, 0);

    // Draw lines
    lines.forEach(line => {
      const startPin = pins.find(p => p.id === line.startPin);
      const endPin = pins.find(p => p.id === line.endPin);
      
      if (startPin && endPin) {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(startPin.x, startPin.y);
        ctx.lineTo(endPin.x, endPin.y);
        ctx.stroke();

        // Draw length label
        const midX = (startPin.x + endPin.x) / 2;
        const midY = (startPin.y + endPin.y) / 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(midX - 25, midY - 10, 50, 20);
        ctx.fillStyle = '#000000';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${line.length.toFixed(1)}'`, midX, midY + 4);
      }
    });

    // Draw pins
    pins.forEach(pin => {
      ctx.fillStyle = toolColors[pin.type];
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      
      // Draw pin circle
      ctx.beginPath();
      ctx.arc(pin.x, pin.y, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      // Draw pin label
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(pin.x - 15, pin.y - 25, 30, 15);
      ctx.fillStyle = '#000000';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pin.label, pin.x, pin.y - 15);
    });

    // Draw selection highlight
    if (selectedPin) {
      const pin = pins.find(p => p.id === selectedPin);
      if (pin) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 4;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, 12, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if clicking on existing pin
    const clickedPin = pins.find(pin => {
      const distance = Math.sqrt((pin.x - x) ** 2 + (pin.y - y) ** 2);
      return distance <= 12;
    });

    if (clickedPin) {
      if (isConnecting && selectedPin && selectedPin !== clickedPin.id) {
        // Create line between selected pin and clicked pin
        createLine(selectedPin, clickedPin.id);
        setSelectedPin(null);
        setIsConnecting(false);
      } else {
        setSelectedPin(clickedPin.id);
      }
      return;
    }

    // Create new pin
    const newPin: MeasurementPin = {
      id: `pin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      x,
      y,
      type: activeTool,
      label: `${activeTool.charAt(0).toUpperCase()}${pins.filter(p => p.type === activeTool).length + 1}`
    };

    setPins(prev => [...prev, newPin]);

    // Auto-connect if this is the second pin of the same type
    if (pins.filter(p => p.type === activeTool).length === 1) {
      const firstPin = pins.find(p => p.type === activeTool);
      if (firstPin) {
        setTimeout(() => createLine(firstPin.id, newPin.id), 100);
      }
    }
  };

  const createLine = (startPinId: string, endPinId: string) => {
    const startPin = pins.find(p => p.id === startPinId);
    const endPin = pins.find(p => p.id === endPinId);
    
    if (!startPin || !endPin) return;

    const pixelDistance = Math.sqrt(
      (endPin.x - startPin.x) ** 2 + (endPin.y - startPin.y) ** 2
    );
    
    const feetDistance = pixelDistance * pixelToFeetRatio;

    const newLine: MeasurementLine = {
      id: `line_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startPin: startPinId,
      endPin: endPinId,
      type: startPin.type,
      length: feetDistance,
      color: toolColors[startPin.type]
    };

    setLines(prev => [...prev, newLine]);
  };

  const calculateMeasurements = () => {
    const measurements = {
      perimeter: {
        totalLength: lines.filter(l => l.type === 'perimeter').reduce((sum, l) => sum + l.length, 0),
        count: lines.filter(l => l.type === 'perimeter').length,
        lines: lines.filter(l => l.type === 'perimeter').map(l => ({ length: l.length, angle: 0 }))
      },
      ridges: {
        totalLength: lines.filter(l => l.type === 'ridge').reduce((sum, l) => sum + l.length, 0),
        count: lines.filter(l => l.type === 'ridge').length,
        lines: lines.filter(l => l.type === 'ridge').map(l => ({ length: l.length, angle: 0 }))
      },
      hips: {
        totalLength: lines.filter(l => l.type === 'hip').reduce((sum, l) => sum + l.length, 0),
        count: lines.filter(l => l.type === 'hip').length,
        lines: lines.filter(l => l.type === 'hip').map(l => ({ length: l.length, angle: 0 }))
      },
      valleys: {
        totalLength: lines.filter(l => l.type === 'valley').reduce((sum, l) => sum + l.length, 0),
        count: lines.filter(l => l.type === 'valley').length,
        lines: lines.filter(l => l.type === 'valley').map(l => ({ length: l.length, angle: 0 }))
      },
      planimeter: {
        totalArea: calculatePolygonArea(),
        count: 1,
        areas: [calculatePolygonArea()]
      }
    };

    onMeasurementsChange(measurements);
  };

  const calculatePolygonArea = () => {
    const perimeterPins = pins.filter(p => p.type === 'perimeter' || p.type === 'planimeter');
    if (perimeterPins.length < 3) return 0;

    // Shoelace formula for polygon area
    let area = 0;
    for (let i = 0; i < perimeterPins.length; i++) {
      const j = (i + 1) % perimeterPins.length;
      area += perimeterPins[i].x * perimeterPins[j].y;
      area -= perimeterPins[j].x * perimeterPins[i].y;
    }
    
    const pixelArea = Math.abs(area) / 2;
    return pixelArea * (pixelToFeetRatio ** 2);
  };

  const clearMeasurements = () => {
    setPins([]);
    setLines([]);
    setSelectedPin(null);
    setIsConnecting(false);
  };

  const addQuickRoof = (type: 'rectangle' | 'hip' | 'gable') => {
    clearMeasurements();
    
    if (!canvasRef.current) return;
    
    const centerX = canvasRef.current.width / 2;
    const centerY = canvasRef.current.height / 2;
    const size = 100;

    if (type === 'rectangle') {
      const corners = [
        { x: centerX - size, y: centerY - size },
        { x: centerX + size, y: centerY - size },
        { x: centerX + size, y: centerY + size },
        { x: centerX - size, y: centerY + size }
      ];
      
      const newPins = corners.map((corner, i) => ({
        id: `pin_${Date.now()}_${i}`,
        x: corner.x,
        y: corner.y,
        type: 'perimeter' as const,
        label: `P${i + 1}`
      }));
      
      setPins(newPins);
      
      // Add ridge
      setTimeout(() => {
        const ridgePin1 = {
          id: `ridge_1_${Date.now()}`,
          x: centerX - size,
          y: centerY,
          type: 'ridge' as const,
          label: 'R1'
        };
        const ridgePin2 = {
          id: `ridge_2_${Date.now()}`,
          x: centerX + size,
          y: centerY,
          type: 'ridge' as const,
          label: 'R2'
        };
        
        setPins(prev => [...prev, ridgePin1, ridgePin2]);
        createLine(ridgePin1.id, ridgePin2.id);
      }, 100);
    }

    toast({
      title: "Quick Roof Added",
      description: `${type.charAt(0).toUpperCase() + type.slice(1)} roof template added. Adjust pin positions as needed.`,
    });
  };

  return (
    <div className="space-y-4">
      {/* Tool Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Pin Drop Measurement Tool
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
            {Object.entries(toolColors).map(([tool, color]) => (
              <Button
                key={tool}
                variant={activeTool === tool ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveTool(tool as any)}
                className="flex items-center gap-2"
                style={{ 
                  backgroundColor: activeTool === tool ? color : undefined,
                  borderColor: color
                }}
              >
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: color }}
                />
                {tool.charAt(0).toUpperCase() + tool.slice(1)}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => addQuickRoof('rectangle')}
              className="flex items-center gap-2"
            >
              <Square className="h-4 w-4" />
              Rectangle
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addQuickRoof('hip')}
              className="flex items-center gap-2"
            >
              <Triangle className="h-4 w-4" />
              Hip Roof
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addQuickRoof('gable')}
              className="flex items-center gap-2"
            >
              <Home className="h-4 w-4" />
              Gable Roof
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearMeasurements}
              className="flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Clear All
            </Button>
          </div>

          <div className="text-sm text-muted-foreground mb-2">
            Click to place pins. Click between pins to connect them. Use templates for quick setup.
          </div>
        </CardContent>
      </Card>

      {/* Canvas */}
      <Card>
        <CardContent className="p-4">
          <div ref={containerRef} className="relative border rounded-lg overflow-hidden">
            <img
              ref={imageRef}
              alt="Satellite view"
              className="hidden"
            />
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="cursor-crosshair max-w-full"
              style={{ display: imageLoaded ? 'block' : 'none' }}
            />
            {!imageLoaded && (
              <div className="h-96 flex items-center justify-center bg-muted">
                Loading satellite imagery...
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Measurements Summary */}
      {(pins.length > 0 || lines.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ruler className="h-5 w-5" />
              Measurements Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm font-medium">Perimeter</div>
                <div className="text-lg">
                  {lines.filter(l => l.type === 'perimeter').reduce((sum, l) => sum + l.length, 0).toFixed(1)}'
                </div>
              </div>
              <div>
                <div className="text-sm font-medium">Ridges</div>
                <div className="text-lg">
                  {lines.filter(l => l.type === 'ridge').reduce((sum, l) => sum + l.length, 0).toFixed(1)}'
                </div>
              </div>
              <div>
                <div className="text-sm font-medium">Total Area</div>
                <div className="text-lg">
                  {calculatePolygonArea().toFixed(0)} sq ft
                </div>
              </div>
              <div>
                <div className="text-sm font-medium">Pins Placed</div>
                <div className="text-lg">{pins.length}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};