import { useState, useEffect, useRef, useCallback } from 'react';
import { Canvas as FabricCanvas, Line, Polygon, Circle, Text, FabricImage } from 'fabric';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Split, X, Undo, Save, Lightbulb, Grid3x3, Download, Trash2, Redo } from 'lucide-react';
import { toast } from 'sonner';
import { 
  splitPolygonByLine, calculatePolygonArea, getFacetColor, suggestSplitLines,
  detectSymmetricalSplits, exportFacetsToWKT, type SplitLine, type SplitFacet 
} from '@/utils/polygonSplitting';
import { detectRoofPattern } from '@/utils/roofPatternDetection';
import { useFacetManager } from '@/hooks/useFacetManager';
import { FacetSplitProgress } from './FacetSplitProgress';
import { FacetPropertiesPanel } from './FacetPropertiesPanel';
import { FacetPreviewPanel } from './FacetPreviewPanel';
import { RulerTool } from './RulerTool';

interface FacetSplitterOverlayProps {
  satelliteImageUrl: string;
  buildingPolygon: [number, number][];
  measurement: any;
  centerLng: number;
  centerLat: number;
  zoom: number;
  onSave: (splitFacets: SplitFacet[]) => void;
  onCancel: () => void;
  canvasWidth?: number;
  canvasHeight?: number;
}

export function FacetSplitterOverlay({
  satelliteImageUrl, buildingPolygon, measurement, centerLng, centerLat, zoom,
  onSave, onCancel, canvasWidth = 800, canvasHeight = 600,
}: FacetSplitterOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [suggestedLines, setSuggestedLines] = useState<SplitLine[]>([]);
  const [showGrid, setShowGrid] = useState(false);
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerPoints, setRulerPoints] = useState<[number, number][]>([]);
  const [roofPattern, setRoofPattern] = useState<any>(null);

  const { facets, selectedFacetId, selectFacet, setFacets, updateFacet, deleteFacet, undo, redo, canUndo, canRedo } = useFacetManager([]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = new FabricCanvas(canvasRef.current, { width: canvasWidth, height: canvasHeight, backgroundColor: '#f3f4f6' });
    setFabricCanvas(canvas);
    return () => {
      canvas.dispose();
    };
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    if (!fabricCanvas || !satelliteImageUrl) return;
    
    let mounted = true;
    
    FabricImage.fromURL(satelliteImageUrl, { crossOrigin: 'anonymous' }).then((img) => {
      if (mounted) {
        img.scaleToWidth(canvasWidth);
        img.scaleToHeight(canvasHeight);
        img.selectable = false;
        fabricCanvas.backgroundImage = img;
        fabricCanvas.renderAll();
      }
    });
    
    return () => {
      mounted = false;
    };
  }, [fabricCanvas, satelliteImageUrl, canvasWidth, canvasHeight]);

  const geoToNormalized = useCallback((lng: number, lat: number): [number, number] => {
    const scale = Math.pow(2, zoom);
    const worldX = (lng + 180) / 360;
    const worldY = (1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2;
    const centerWorldX = (centerLng + 180) / 360;
    const centerWorldY = (1 - Math.log(Math.tan((centerLat * Math.PI) / 180) + 1 / Math.cos((centerLat * Math.PI) / 180)) / Math.PI) / 2;
    return [0.5 + (worldX - centerWorldX) * scale * 2, 0.5 + (worldY - centerWorldY) * scale * 2];
  }, [centerLng, centerLat, zoom]);

  useEffect(() => {
    if (buildingPolygon.length > 0 && facets.length === 0) {
      const normalizedPoints = buildingPolygon.map(([lng, lat]) => geoToNormalized(lng, lat));
      setFacets([{ id: 'facet-0', points: normalizedPoints, area: calculatePolygonArea(normalizedPoints), color: getFacetColor(0) }]);
    }
  }, [buildingPolygon, facets.length, geoToNormalized, setFacets]);

  useEffect(() => {
    if (buildingPolygon.length > 0 && measurement) {
      const normalizedPolygon = buildingPolygon.map(([lng, lat]) => geoToNormalized(lng, lat));
      const pattern = detectRoofPattern(normalizedPolygon, measurement.linear_features);
      setRoofPattern(pattern);
      const suggestions = suggestSplitLines(measurement, normalizedPolygon);
      const symmetry = detectSymmetricalSplits(normalizedPolygon);
      setSuggestedLines([...suggestions, ...symmetry]);
    }
  }, [buildingPolygon, measurement, geoToNormalized]);

  useEffect(() => {
    if (!fabricCanvas || facets.length === 0) return;
    fabricCanvas.clear();
    
    facets.forEach((facet, index) => {
      const points = facet.points.map(p => ({ x: p[0] * canvasWidth, y: p[1] * canvasHeight }));
      const isSelected = facet.id === selectedFacetId;
      const color = getFacetColor(index, facet.pitch);
      
      const polygon = new Polygon(points, {
        fill: color, opacity: isSelected ? 0.7 : 0.4, stroke: isSelected ? '#3b82f6' : color,
        strokeWidth: isSelected ? 4 : 2, selectable: true, hasControls: isSelected,
        cornerSize: 12, cornerColor: '#3b82f6',
      });

      polygon.on('selected', () => selectFacet(facet.id));
      fabricCanvas.add(polygon);

      const centroid = [(facet.points.reduce((s, p) => s + p[0], 0) / facet.points.length) * canvasWidth,
                       (facet.points.reduce((s, p) => s + p[1], 0) / facet.points.length) * canvasHeight];
      fabricCanvas.add(new Text(`#${index + 1}\n${facet.area.toLocaleString()} sq ft`, {
        left: centroid[0], top: centroid[1], fontSize: 14, fill: '#fff',
        stroke: '#000', strokeWidth: 1, selectable: false, originX: 'center', originY: 'center',
      }));
    });

    fabricCanvas.renderAll();
  }, [fabricCanvas, facets, selectedFacetId, canvasWidth, canvasHeight, selectFacet]);

  const executeSplit = (line: SplitLine) => {
    const newFacets = facets.flatMap(facet => {
      const result = splitPolygonByLine(facet.points, line);
      if (result) {
        return [
          { id: `facet-${Date.now()}-1`, points: result.facet1, area: calculatePolygonArea(result.facet1), 
            pitch: facet.pitch, direction: facet.direction, color: getFacetColor(facets.length, facet.pitch) },
          { id: `facet-${Date.now()}-2`, points: result.facet2, area: calculatePolygonArea(result.facet2),
            pitch: facet.pitch, direction: facet.direction, color: getFacetColor(facets.length + 1, facet.pitch) },
        ];
      }
      return [facet];
    });
    setFacets(newFacets);
    toast.success('Facet split successfully');
    setDrawingPoints([]);
    setIsDrawing(false);
  };

  const handleCanvasClick = (e: any) => {
    if (!fabricCanvas || (!isDrawing && !rulerActive)) return;
    const pointer = fabricCanvas.getPointer(e.e);
    const point: [number, number] = [pointer.x / canvasWidth, pointer.y / canvasHeight];
    
    if (rulerActive) {
      setRulerPoints(prev => [...prev, point]);
    } else if (isDrawing) {
      setDrawingPoints(prev => {
        const newPoints = [...prev, point];
        if (newPoints.length === 2) {
          executeSplit({ start: newPoints[0], end: newPoints[1] });
          return [];
        }
        return newPoints;
      });
    }
  };

  useEffect(() => {
    if (!fabricCanvas) return;
    fabricCanvas.on('mouse:down', handleCanvasClick);
    return () => fabricCanvas.off('mouse:down', handleCanvasClick);
  }, [fabricCanvas, isDrawing, rulerActive, facets, setFacets]);

  const selectedFacet = facets.find(f => f.id === selectedFacetId);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="container h-full py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-4 h-full">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Facet Splitting Tool</h2>
                <p className="text-sm text-muted-foreground">Split the building into individual roof facets</p>
              </div>
              <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
            </div>

            <FacetSplitProgress facets={facets} />

            {roofPattern && roofPattern.confidence > 0.7 && (
              <div className="bg-card border rounded-lg p-3">
                <Badge variant="default">{roofPattern.pattern.toUpperCase()} ROOF</Badge>
                <p className="text-xs text-muted-foreground mt-1">{roofPattern.description}</p>
              </div>
            )}

            <div className="bg-card border rounded-lg p-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={isDrawing ? "default" : "outline"} 
                  onClick={() => { setIsDrawing(true); setRulerActive(false); toast.info('Click two points'); }}>
                  <Split className="w-4 h-4 mr-2" />Draw Split
                </Button>
                <Button size="sm" variant="outline" onClick={undo} disabled={!canUndo}>
                  <Undo className="w-4 h-4 mr-2" />Undo
                </Button>
                <Button size="sm" variant="outline" onClick={redo} disabled={!canRedo}>
                  <Redo className="w-4 h-4 mr-2" />Redo
                </Button>
                <Button size="sm" variant="outline" onClick={() => selectedFacetId && deleteFacet(selectedFacetId)} disabled={!selectedFacetId}>
                  <Trash2 className="w-4 h-4 mr-2" />Delete
                </Button>
                <Separator orientation="vertical" className="h-6" />
                <Button size="sm" variant={showGrid ? "default" : "outline"} onClick={() => setShowGrid(!showGrid)}>
                  <Grid3x3 className="w-4 h-4 mr-2" />Grid
                </Button>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(exportFacetsToWKT(facets)); toast.success('WKT copied'); }}>
                  <Download className="w-4 h-4 mr-2" />Export
                </Button>
              </div>

              {suggestedLines.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="w-4 h-4 text-yellow-600" />
                    <span className="text-sm font-medium">Suggested Splits ({suggestedLines.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {suggestedLines.slice(0, 5).map((line, i) => (
                      <Button key={i} size="sm" variant="outline" onClick={() => executeSplit(line)}>Apply #{i + 1}</Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 border rounded-lg overflow-hidden bg-muted">
              <canvas ref={canvasRef} />
            </div>

            <RulerTool active={rulerActive} onToggle={() => { setRulerActive(!rulerActive); setIsDrawing(false); setRulerPoints([]); }}
              points={rulerPoints} onAddPoint={() => {}} onClear={() => setRulerPoints([])} />

            <div className="flex gap-2">
              <Button variant="outline" onClick={onCancel}>Cancel</Button>
              <Button className="flex-1" onClick={() => onSave(facets)} disabled={facets.length < 2}>
                <Save className="w-4 h-4 mr-2" />Save Facets ({facets.length})
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {selectedFacet && (
              <FacetPropertiesPanel facet={selectedFacet} onUpdateFacet={updateFacet}
                onCopyToAll={() => {
                  facets.forEach(f => f.id !== selectedFacetId && updateFacet(f.id, { pitch: selectedFacet.pitch, direction: selectedFacet.direction }));
                  toast.success('Properties copied');
                }} />
            )}
            <FacetPreviewPanel facets={facets} selectedFacetId={selectedFacetId} onSelectFacet={selectFacet} />
          </div>
        </div>
      </div>
    </div>
  );
}
