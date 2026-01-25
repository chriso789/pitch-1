// =====================================================
// Phase 74: Multi-View Diagram Renderer
// Switch between different diagram visualization modes
// =====================================================

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  LayoutGrid,
  Map,
  Box,
  Layers,
  Palette,
  Maximize2,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';

type DiagramView = 'schematic' | 'satellite' | 'perspective' | 'facets' | 'materials';

interface DiagramViewSwitcherProps {
  currentView: DiagramView;
  onViewChange: (view: DiagramView) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetView?: () => void;
  onFullscreen?: () => void;
  onExport?: (format: 'png' | 'pdf' | 'svg') => void;
  zoomLevel?: number;
  isFullscreen?: boolean;
  className?: string;
}

const VIEW_OPTIONS: Array<{
  id: DiagramView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    id: 'schematic',
    label: 'Schematic',
    icon: LayoutGrid,
    description: 'Clean vector diagram with measurements',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    icon: Map,
    description: 'Overlay measurements on satellite imagery',
  },
  {
    id: 'perspective',
    label: '3D View',
    icon: Box,
    description: 'Isometric 3D roof visualization',
  },
  {
    id: 'facets',
    label: 'Facets',
    icon: Layers,
    description: 'Individual facet breakdown with areas',
  },
  {
    id: 'materials',
    label: 'Materials',
    icon: Palette,
    description: 'Color-coded by roofing material type',
  },
];

export function DiagramViewSwitcher({
  currentView,
  onViewChange,
  onZoomIn,
  onZoomOut,
  onResetView,
  onFullscreen,
  onExport,
  zoomLevel = 100,
  isFullscreen = false,
  className,
}: DiagramViewSwitcherProps) {
  const [showExportMenu, setShowExportMenu] = useState(false);

  return (
    <div className={cn('flex items-center justify-between gap-4 p-2', className)}>
      {/* View tabs */}
      <Tabs value={currentView} onValueChange={(v) => onViewChange(v as DiagramView)}>
        <TabsList className="h-9">
          {VIEW_OPTIONS.map((view) => (
            <TooltipProvider key={view.id} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value={view.id} className="px-3">
                    <view.icon className="h-4 w-4 mr-1.5" />
                    <span className="hidden sm:inline">{view.label}</span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="font-medium">{view.label}</p>
                  <p className="text-xs text-muted-foreground">{view.description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </TabsList>
      </Tabs>

      {/* Controls */}
      <div className="flex items-center gap-1">
        {/* Zoom controls */}
        <div className="flex items-center gap-1 border rounded-md px-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onZoomOut}
            disabled={zoomLevel <= 25}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs w-12 text-center">{zoomLevel}%</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onZoomIn}
            disabled={zoomLevel >= 400}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        {/* Reset */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onResetView}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset view</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Fullscreen */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onFullscreen}>
                <Maximize2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Export */}
        <div className="relative">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShowExportMenu(!showExportMenu)}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export diagram</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {showExportMenu && (
            <Card className="absolute right-0 top-10 z-50 w-40">
              <CardContent className="p-1">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    onExport?.('png');
                    setShowExportMenu(false);
                  }}
                >
                  Export as PNG
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    onExport?.('pdf');
                    setShowExportMenu(false);
                  }}
                >
                  Export as PDF
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    onExport?.('svg');
                    setShowExportMenu(false);
                  }}
                >
                  Export as SVG
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// View-specific rendering wrapper
interface DiagramViewRendererProps {
  view: DiagramView;
  measurementId: string;
  satelliteUrl?: string;
  geometryJson?: Record<string, unknown>;
  facets?: Array<{ id: string; area: number; pitch: string; color?: string }>;
  materials?: Array<{ type: string; area: number; color: string }>;
  children?: React.ReactNode;
  className?: string;
}

export function DiagramViewRenderer({
  view,
  measurementId,
  satelliteUrl,
  geometryJson,
  facets,
  materials,
  children,
  className,
}: DiagramViewRendererProps) {
  const renderViewContent = () => {
    switch (view) {
      case 'satellite':
        return (
          <div className="relative w-full h-full">
            {satelliteUrl && (
              <img
                src={satelliteUrl}
                alt="Satellite imagery"
                className="absolute inset-0 w-full h-full object-cover opacity-70"
              />
            )}
            <div className="relative z-10">{children}</div>
          </div>
        );

      case 'perspective':
        return (
          <div className="relative w-full h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Box className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p>3D Perspective View</p>
              <p className="text-sm">Coming soon</p>
            </div>
          </div>
        );

      case 'facets':
        return (
          <div className="relative w-full h-full">
            {facets && facets.length > 0 ? (
              <div className="grid grid-cols-3 gap-4 p-4">
                {facets.map((facet) => (
                  <Card key={facet.id} className="p-3">
                    <div
                      className="w-full h-20 rounded mb-2"
                      style={{ backgroundColor: facet.color || '#3b82f6' }}
                    />
                    <p className="font-medium text-sm">{facet.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {facet.area.toFixed(1)} sq ft • {facet.pitch}
                    </p>
                  </Card>
                ))}
              </div>
            ) : (
              children
            )}
          </div>
        );

      case 'materials':
        return (
          <div className="relative w-full h-full">
            {children}
            {materials && (
              <div className="absolute bottom-4 left-4 bg-background/90 rounded-lg p-3 shadow-lg">
                <p className="font-medium text-sm mb-2">Materials Legend</p>
                {materials.map((mat) => (
                  <div key={mat.type} className="flex items-center gap-2 text-xs">
                    <div
                      className="w-3 h-3 rounded"
                      style={{ backgroundColor: mat.color }}
                    />
                    <span>{mat.type}</span>
                    <span className="text-muted-foreground">{mat.area.toFixed(0)} sq ft</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'schematic':
      default:
        return children;
    }
  };

  return (
    <div className={cn('relative w-full h-full overflow-hidden', className)}>
      {renderViewContent()}
    </div>
  );
}

// Hook for managing view state
export function useDiagramView(initialView: DiagramView = 'schematic') {
  const [currentView, setCurrentView] = useState<DiagramView>(initialView);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const zoomIn = () => setZoomLevel((prev) => Math.min(prev + 25, 400));
  const zoomOut = () => setZoomLevel((prev) => Math.max(prev - 25, 25));
  const resetView = () => {
    setZoomLevel(100);
    setCurrentView('schematic');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return {
    currentView,
    setCurrentView,
    zoomLevel,
    zoomIn,
    zoomOut,
    resetView,
    isFullscreen,
    toggleFullscreen,
  };
}

export default DiagramViewSwitcher;
