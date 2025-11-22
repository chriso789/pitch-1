import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Pencil,
  Undo2,
  Redo2,
  Trash2,
  Home,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Menu,
  CheckCircle2,
} from 'lucide-react';

interface MobileToolbarProps {
  mode: 'select' | 'draw';
  isDrawing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  currentArea: number;
  totalArea: number;
  facetCount: number;
  showLinearFeatures: boolean;
  isDetectingBuilding: boolean;
  onStartDrawing: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onAutoDetect: () => void;
  onToggleLinearFeatures: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onCompletePolygon?: () => void;
  position?: 'bottom' | 'left' | 'right';
}

export function MobileToolbar({
  mode,
  isDrawing,
  canUndo,
  canRedo,
  currentArea,
  totalArea,
  facetCount,
  showLinearFeatures,
  isDetectingBuilding,
  onStartDrawing,
  onUndo,
  onRedo,
  onClear,
  onAutoDetect,
  onToggleLinearFeatures,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onCompletePolygon,
  position = 'bottom',
}: MobileToolbarProps) {
  const isVertical = position === 'left' || position === 'right';
  
  const containerClass = isVertical
    ? `fixed ${position}-0 top-0 bottom-0 w-20 bg-background border-${position === 'left' ? 'r' : 'l'} border-border p-2 z-50 flex flex-col gap-2`
    : "fixed bottom-0 left-0 right-0 bg-background border-t border-border p-4 safe-area-bottom z-50";

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between gap-2">
        {/* Primary Action - Large button */}
        <Button
          size="lg"
          onClick={onStartDrawing}
          disabled={isDrawing}
          className="flex-1 h-14 text-base touch-target"
        >
          <Pencil className="h-5 w-5 mr-2" />
          {isDrawing ? 'Drawing...' : 'Draw Facet'}
        </Button>

        {/* Complete Polygon button when drawing */}
        {isDrawing && currentArea > 0 && (
          <Button
            size="lg"
            variant="default"
            onClick={onCompletePolygon}
            className="h-14 touch-target"
          >
            <CheckCircle2 className="h-5 w-5" />
          </Button>
        )}

        {/* Auto-detect button */}
        <Button
          size="lg"
          variant="outline"
          onClick={onAutoDetect}
          disabled={isDetectingBuilding}
          className="h-14 touch-target"
        >
          <Home className="h-5 w-5" />
        </Button>

        {/* More options menu */}
        <Sheet>
          <SheetTrigger asChild>
            <Button size="lg" variant="outline" className="h-14 touch-target">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[60vh]">
            <SheetHeader>
              <SheetTitle>Measurement Tools</SheetTitle>
            </SheetHeader>
            
            <div className="py-6 space-y-4">
              {/* Measurement Stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-muted p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-primary">
                    {facetCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Facets</div>
                </div>
                <div className="bg-muted p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-primary">
                    {totalArea.toFixed(0)}
                  </div>
                  <div className="text-xs text-muted-foreground">Sq Ft</div>
                </div>
                <div className="bg-muted p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-primary">
                    {(totalArea / 100).toFixed(1)}
                  </div>
                  <div className="text-xs text-muted-foreground">Squares</div>
                </div>
              </div>

              {/* Zoom Controls */}
              <div className="space-y-2">
                <div className="text-sm font-medium">Zoom Controls</div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={onZoomOut}
                    className="flex-1 h-12"
                  >
                    <ZoomOut className="h-5 w-5 mr-2" />
                    Zoom Out
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={onZoomReset}
                    className="h-12"
                  >
                    <RotateCcw className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={onZoomIn}
                    className="flex-1 h-12"
                  >
                    <ZoomIn className="h-5 w-5 mr-2" />
                    Zoom In
                  </Button>
                </div>
              </div>

              {/* Edit Controls */}
              <div className="space-y-2">
                <div className="text-sm font-medium">Edit Controls</div>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={onUndo}
                    disabled={!canUndo}
                    className="h-12"
                  >
                    <Undo2 className="h-5 w-5 mr-2" />
                    Undo
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={onRedo}
                    disabled={!canRedo}
                    className="h-12"
                  >
                    <Redo2 className="h-5 w-5 mr-2" />
                    Redo
                  </Button>
                  <Button
                    variant="destructive"
                    size="lg"
                    onClick={onClear}
                    className="h-12"
                  >
                    <Trash2 className="h-5 w-5 mr-2" />
                    Clear
                  </Button>
                </div>
              </div>

              {/* Toggle Linear Features */}
              <Button
                variant="outline"
                size="lg"
                onClick={onToggleLinearFeatures}
                className="w-full h-12"
              >
                {showLinearFeatures ? (
                  <>
                    <EyeOff className="h-5 w-5 mr-2" />
                    Hide Ridge/Hip/Valley
                  </>
                ) : (
                  <>
                    <Eye className="h-5 w-5 mr-2" />
                    Show Ridge/Hip/Valley
                  </>
                )}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Live measurement display when drawing */}
      {isDrawing && currentArea > 0 && (
        <div className="mt-2 text-center">
          <Badge variant="secondary" className="text-base px-4 py-2">
            {currentArea.toFixed(0)} sq ft • {(currentArea / 100).toFixed(1)} squares
          </Badge>
        </div>
      )}
    </div>
  );
}
