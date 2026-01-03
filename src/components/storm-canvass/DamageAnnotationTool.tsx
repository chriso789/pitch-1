import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Circle, Arrow, Text, Line, Group } from 'react-konva';
import useImage from 'use-image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Circle as CircleIcon, 
  ArrowRight, 
  Type, 
  Eraser, 
  Download, 
  Undo, 
  Save,
  Target,
  Droplets,
  Wind,
  AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface DamageAnnotationToolProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  onSave: (annotatedImageUrl: string) => void;
}

type ToolType = 'circle' | 'arrow' | 'text' | 'marker';
type SeverityType = 'minor' | 'moderate' | 'severe';
type DamageType = 'hail' | 'wind' | 'wear' | 'other';

interface Annotation {
  id: string;
  type: ToolType;
  x: number;
  y: number;
  endX?: number;
  endY?: number;
  text?: string;
  color: string;
  severity?: SeverityType;
  damageType?: DamageType;
}

const SEVERITY_COLORS: Record<SeverityType, string> = {
  minor: '#eab308',
  moderate: '#f97316',
  severe: '#ef4444',
};

const DAMAGE_ICONS: Record<DamageType, React.ReactNode> = {
  hail: <Target className="h-4 w-4" />,
  wind: <Wind className="h-4 w-4" />,
  wear: <Droplets className="h-4 w-4" />,
  other: <AlertTriangle className="h-4 w-4" />,
};

export function DamageAnnotationTool({
  open,
  onOpenChange,
  imageUrl,
  onSave,
}: DamageAnnotationToolProps) {
  const [image] = useImage(imageUrl, 'anonymous');
  const stageRef = useRef<any>(null);
  const [tool, setTool] = useState<ToolType>('circle');
  const [severity, setSeverity] = useState<SeverityType>('moderate');
  const [damageType, setDamageType] = useState<DamageType>('hail');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentAnnotation, setCurrentAnnotation] = useState<Partial<Annotation> | null>(null);
  const [textInput, setTextInput] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [textPosition, setTextPosition] = useState<{ x: number; y: number } | null>(null);

  // Calculate stage dimensions
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  
  useEffect(() => {
    if (image) {
      const maxWidth = window.innerWidth * 0.8;
      const maxHeight = window.innerHeight * 0.7;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
      setDimensions({
        width: image.width * scale,
        height: image.height * scale,
      });
    }
  }, [image]);

  const handleMouseDown = (e: any) => {
    const pos = e.target.getStage().getPointerPosition();
    
    if (tool === 'text') {
      setTextPosition({ x: pos.x, y: pos.y });
      setShowTextInput(true);
      return;
    }
    
    setIsDrawing(true);
    const id = Date.now().toString();
    const color = SEVERITY_COLORS[severity];
    
    setCurrentAnnotation({
      id,
      type: tool,
      x: pos.x,
      y: pos.y,
      color,
      severity,
      damageType,
    });
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing || !currentAnnotation) return;
    
    const pos = e.target.getStage().getPointerPosition();
    
    if (tool === 'arrow' || tool === 'circle') {
      setCurrentAnnotation({
        ...currentAnnotation,
        endX: pos.x,
        endY: pos.y,
      });
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentAnnotation) return;
    
    setIsDrawing(false);
    
    if (tool === 'marker') {
      setAnnotations([...annotations, {
        ...currentAnnotation,
        id: Date.now().toString(),
        type: 'marker',
      } as Annotation]);
    } else if (currentAnnotation.endX !== undefined) {
      setAnnotations([...annotations, currentAnnotation as Annotation]);
    }
    
    setCurrentAnnotation(null);
  };

  const handleAddText = () => {
    if (!textInput.trim() || !textPosition) return;
    
    setAnnotations([...annotations, {
      id: Date.now().toString(),
      type: 'text',
      x: textPosition.x,
      y: textPosition.y,
      text: textInput,
      color: SEVERITY_COLORS[severity],
      severity,
    }]);
    
    setTextInput('');
    setShowTextInput(false);
    setTextPosition(null);
  };

  const handleUndo = () => {
    setAnnotations(annotations.slice(0, -1));
  };

  const handleClear = () => {
    setAnnotations([]);
  };

  const handleSave = () => {
    if (!stageRef.current) return;
    
    try {
      const dataUrl = stageRef.current.toDataURL({ pixelRatio: 2 });
      onSave(dataUrl);
      toast.success('Annotated image saved');
    } catch (error) {
      console.error('Failed to save annotated image:', error);
      toast.error('Failed to save image');
    }
  };

  const handleDownload = () => {
    if (!stageRef.current) return;
    
    const dataUrl = stageRef.current.toDataURL({ pixelRatio: 2 });
    const link = document.createElement('a');
    link.download = `annotated-damage-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  };

  const renderAnnotation = (annotation: Annotation) => {
    switch (annotation.type) {
      case 'circle':
        if (annotation.endX === undefined || annotation.endY === undefined) return null;
        const radius = Math.sqrt(
          Math.pow(annotation.endX - annotation.x, 2) + 
          Math.pow(annotation.endY - annotation.y, 2)
        );
        return (
          <Circle
            key={annotation.id}
            x={annotation.x}
            y={annotation.y}
            radius={radius}
            stroke={annotation.color}
            strokeWidth={3}
            dash={[10, 5]}
          />
        );
      
      case 'arrow':
        if (annotation.endX === undefined || annotation.endY === undefined) return null;
        return (
          <Arrow
            key={annotation.id}
            points={[annotation.x, annotation.y, annotation.endX, annotation.endY]}
            stroke={annotation.color}
            strokeWidth={3}
            fill={annotation.color}
            pointerLength={10}
            pointerWidth={10}
          />
        );
      
      case 'text':
        return (
          <Text
            key={annotation.id}
            x={annotation.x}
            y={annotation.y}
            text={annotation.text}
            fontSize={16}
            fill={annotation.color}
            fontStyle="bold"
            shadowColor="black"
            shadowBlur={2}
            shadowOffset={{ x: 1, y: 1 }}
          />
        );
      
      case 'marker':
        return (
          <Group key={annotation.id} x={annotation.x} y={annotation.y}>
            <Circle
              radius={15}
              fill={annotation.color}
              opacity={0.8}
            />
            <Text
              x={-5}
              y={-7}
              text={annotation.damageType?.[0].toUpperCase() || '!'}
              fontSize={14}
              fill="white"
              fontStyle="bold"
            />
          </Group>
        );
      
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>Damage Annotation Tool</DialogTitle>
        </DialogHeader>

        <div className="flex">
          {/* Toolbar */}
          <div className="w-48 border-r p-4 space-y-4 bg-muted/30">
            {/* Tools */}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Tools</h4>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={tool === 'circle' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTool('circle')}
                >
                  <CircleIcon className="h-4 w-4" />
                </Button>
                <Button
                  variant={tool === 'arrow' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTool('arrow')}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant={tool === 'text' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTool('text')}
                >
                  <Type className="h-4 w-4" />
                </Button>
                <Button
                  variant={tool === 'marker' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTool('marker')}
                >
                  <Target className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Severity */}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Severity</h4>
              <div className="space-y-1">
                {(['minor', 'moderate', 'severe'] as SeverityType[]).map((s) => (
                  <Badge
                    key={s}
                    variant={severity === s ? 'default' : 'outline'}
                    className={cn(
                      "w-full justify-start cursor-pointer",
                      severity === s && `bg-[${SEVERITY_COLORS[s]}]`
                    )}
                    style={severity === s ? { backgroundColor: SEVERITY_COLORS[s] } : {}}
                    onClick={() => setSeverity(s)}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Damage Type */}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Damage Type</h4>
              <div className="space-y-1">
                {(['hail', 'wind', 'wear', 'other'] as DamageType[]).map((d) => (
                  <Badge
                    key={d}
                    variant={damageType === d ? 'default' : 'outline'}
                    className="w-full justify-start cursor-pointer gap-2"
                    onClick={() => setDamageType(d)}
                  >
                    {DAMAGE_ICONS[d]}
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="pt-4 space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleUndo}
                disabled={annotations.length === 0}
              >
                <Undo className="h-4 w-4 mr-2" />
                Undo
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleClear}
                disabled={annotations.length === 0}
              >
                <Eraser className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-auto p-4 bg-muted/10">
            <Stage
              ref={stageRef}
              width={dimensions.width}
              height={dimensions.height}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchMove={handleMouseMove}
              onTouchEnd={handleMouseUp}
              className="border rounded-lg shadow-sm"
            >
              <Layer>
                {image && (
                  <KonvaImage
                    image={image}
                    width={dimensions.width}
                    height={dimensions.height}
                  />
                )}
                
                {annotations.map(renderAnnotation)}
                
                {currentAnnotation && renderAnnotation(currentAnnotation as Annotation)}
              </Layer>
            </Stage>

            {/* Text input overlay */}
            {showTextInput && textPosition && (
              <div
                className="absolute z-50"
                style={{
                  left: textPosition.x + 16,
                  top: textPosition.y + 16,
                }}
              >
                <div className="flex gap-2">
                  <Input
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Enter label..."
                    className="w-48"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddText();
                      if (e.key === 'Escape') {
                        setShowTextInput(false);
                        setTextPosition(null);
                      }
                    }}
                  />
                  <Button size="sm" onClick={handleAddText}>Add</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save Annotations
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
