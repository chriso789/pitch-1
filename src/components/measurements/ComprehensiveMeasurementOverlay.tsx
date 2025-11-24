import { useEffect, useRef, useState, useCallback } from "react";
import { Canvas as FabricCanvas, Line, Polygon, Circle, Text as FabricText, FabricObject, FabricImage, Point as FabricPoint } from "fabric";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Move, Mountain, Triangle, ArrowDownUp, Square, Trash2, RotateCcw, Eye, EyeOff, MapPin, StickyNote, AlertTriangle, Scissors, Merge, ChevronDown, ChevronUp, Grid3x3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useImageCache } from "@/contexts/ImageCacheContext";
import { snapToEdge } from "@/utils/measurementGeometry";
import { EnhancedFacetPropertiesPanel } from "./EnhancedFacetPropertiesPanel";
import { LinePropertiesPanel } from "./LinePropertiesPanel";
import { useTabletControls } from "@/hooks/useTabletControls";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";
import { validateMeasurement, ValidationResult } from "@/utils/measurementValidation";
import { ValidationErrorDialog } from "./ValidationErrorDialog";
import { featureFlags } from "@/config/featureFlags";
import * as turf from '@turf/turf';

interface Point {
  x: number;
  y: number;
}

interface ComprehensiveMeasurementOverlayProps {
  satelliteImageUrl: string;
  measurement: any;
  tags: Record<string, any>;
  centerLng: number;
  centerLat: number;
  zoom: number;
  onMeasurementUpdate: (updatedMeasurement: any, updatedTags: Record<string, any>) => void;
  canvasWidth?: number;
  canvasHeight?: number;
  recenterMode?: boolean;
  onRecenterClick?: (normalizedX: number, normalizedY: number) => void;
  measurementId?: string;
  propertyId?: string;
  pipelineEntryId?: string;
}

type EditMode = 'select' | 'add-ridge' | 'add-hip' | 'add-valley' | 'add-facet' | 'delete' | 'add-marker' | 'add-note' | 'add-damage' | 'split-facet' | 'merge-facets';

// Color palette for distinct facet colors
const FACET_COLOR_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

interface Annotation {
  id: string;
  type: 'marker' | 'note' | 'damage';
  position: Point;
  text?: string;
  normalizedPosition: [number, number];
}

export function ComprehensiveMeasurementOverlay({
  satelliteImageUrl,
  measurement,
  tags,
  centerLng,
  centerLat,
  zoom,
  onMeasurementUpdate,
  canvasWidth = 640,
  canvasHeight = 480,
  recenterMode = false,
  onRecenterClick,
  measurementId,
  propertyId,
  pipelineEntryId,
}: ComprehensiveMeasurementOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [editMode, setEditMode] = useState<EditMode>('select');
  const [layers, setLayers] = useState({
    facets: true,
    ridges: true,
    hips: true,
    valleys: true,
    perimeter: true,
    annotations: true,
  });
  const [drawPoints, setDrawPoints] = useState<Point[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] = useState<{ position: Point; type: 'note' | 'damage' } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [selectedFacetIndex, setSelectedFacetIndex] = useState<number | null>(null);
  const [selectedFacets, setSelectedFacets] = useState<number[]>([]);
  const [splitPoints, setSplitPoints] = useState<Point[]>([]);
  const [selectedLineData, setSelectedLineData] = useState<{type: string, index: number} | null>(null);
  
  // Auto-save state
  const [lastSaveTime, setLastSaveTime] = useState<number>(Date.now());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // UI state
  const [showSummaryHUD, setShowSummaryHUD] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  
  // Undo/Redo stacks
  const undoStack = useRef<Array<{ measurement: any; tags: any }>>([]);
  const redoStack = useRef<Array<{ measurement: any; tags: any }>>([]);
  
  // Store original data for reset
  const originalDataRef = useRef({ measurement, tags });
  
  // Use global image cache
  const imageCache = useImageCache();
  
  // Validation state
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  
  // Mobile/tablet optimization hooks
  const { vibrate } = useHapticFeedback();
  const [currentZoom, setCurrentZoom] = useState(1);

  // Auto-save with database persistence
  const handleAutoSave = async () => {
    if (!propertyId || !measurement || !hasUnsavedChanges) return;
    
    // Validate before auto-save if validation is enabled
    if (featureFlags.ENABLE_MEASUREMENT_VALIDATION) {
      const validation = validateMeasurement(measurement);
      
      // Block save if strict validation is enabled and there are errors
      if (featureFlags.ENABLE_STRICT_VALIDATION && !validation.isValid) {
        console.warn('⚠️ Auto-save blocked due to validation errors:', validation.errors);
        toast.error('Cannot auto-save: measurement has validation errors');
        setValidationResult(validation);
        setShowValidationDialog(true);
        return;
      }
      
      // Log warnings but allow save
      if (validation.warnings.length > 0) {
        console.warn('⚠️ Auto-save with warnings:', validation.warnings);
      }
    }
    
    try {
      const { saveMeasurementWithOfflineSupport } = await import('@/services/offlineMeasurementSync');
      
      await saveMeasurementWithOfflineSupport({
        measurementId: measurementId || '',
        propertyId,
        facets: measurement.faces || [],
        linearFeatures: measurement.linear_features || [],
        summary: measurement.summary || {
          total_area_sqft: 0,
          total_squares: 0,
          waste_pct: 10,
          pitch: '6/12',
          perimeter: 0,
          stories: 1,
        },
        metadata: tags,
      });
      
      setHasUnsavedChanges(false);
      setLastSaveTime(Date.now());
      
      // Haptic feedback on successful save
      if (featureFlags.ENABLE_HAPTIC_FEEDBACK) {
        vibrate('light');
      }
      
      toast.success('Measurements auto-saved');
    } catch (error) {
      console.error('Auto-save failed:', error);
      toast.error('Failed to auto-save measurements');
    }
  };

  // Auto-save effect
  useEffect(() => {
    if (!hasUnsavedChanges || !propertyId) return;
    
    // Clear existing timer
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    
    // Set new timer for 30 seconds
    saveTimerRef.current = setTimeout(() => {
      handleAutoSave();
    }, 30000); // 30 seconds
    
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [hasUnsavedChanges, propertyId, measurement, tags]);

  // Mark changes as unsaved whenever measurement updates
  useEffect(() => {
    setHasUnsavedChanges(true);
  }, [measurement, tags]);
  
  // Tablet touch controls (pinch-to-zoom, two-finger pan, long-press)
  useTabletControls({
    canvas: fabricCanvas,
    enabled: featureFlags.ENABLE_TABLET_TOUCH_CONTROLS,
    onPinchZoom: (zoom, point) => {
      if (!fabricCanvas) return;
      setCurrentZoom(zoom);
      fabricCanvas.zoomToPoint(new FabricPoint(point.x, point.y), zoom);
      fabricCanvas.renderAll();
      
      if (featureFlags.ENABLE_HAPTIC_FEEDBACK) {
        vibrate('light');
      }
    },
    onTwoFingerPan: (deltaX, deltaY) => {
      if (!fabricCanvas) return;
      const vpt = fabricCanvas.viewportTransform;
      if (vpt) {
        vpt[4] += deltaX;
        vpt[5] += deltaY;
        fabricCanvas.requestRenderAll();
      }
    },
    onLongPress: (x, y, target) => {
      if (!target) return;
      
      // Show context menu for facets
      if (target.get('type') === 'polygon') {
        console.log('🖐️ Long press on facet:', target);
        toast.info('Facet selected - use properties panel');
        
        if (featureFlags.ENABLE_HAPTIC_FEEDBACK) {
          vibrate('medium');
        }
      }
    },
    minZoom: 0.5,
    maxZoom: 3,
  });

  // Push to undo stack helper
  const pushToUndoStack = () => {
    undoStack.current.push({
      measurement: JSON.parse(JSON.stringify(measurement)),
      tags: JSON.parse(JSON.stringify(tags)),
    });
    redoStack.current = []; // Clear redo on new action
    
    // Limit stack size
    if (undoStack.current.length > 50) {
      undoStack.current.shift();
    }
  };

  const handleUndo = () => {
    if (undoStack.current.length === 0) {
      toast.info('Nothing to undo');
      return;
    }
    
    // Push current state to redo
    redoStack.current.push({
      measurement: JSON.parse(JSON.stringify(measurement)),
      tags: JSON.parse(JSON.stringify(tags)),
    });
    
    // Pop from undo
    const previousState = undoStack.current.pop()!;
    onMeasurementUpdate(previousState.measurement, previousState.tags);
    
    toast.success('Undid last change');
  };

  const handleRedo = () => {
    if (redoStack.current.length === 0) {
      toast.info('Nothing to redo');
      return;
    }
    
    // Push current to undo
    undoStack.current.push({
      measurement: JSON.parse(JSON.stringify(measurement)),
      tags: JSON.parse(JSON.stringify(tags)),
    });
    
    // Pop from redo
    const nextState = redoStack.current.pop()!;
    onMeasurementUpdate(nextState.measurement, nextState.tags);
    
    toast.success('Redid change');
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      switch(e.key.toLowerCase()) {
        case 's':
          if (!e.ctrlKey && !e.metaKey) {
            setEditMode('select');
            toast.success('Select mode activated');
          }
          break;
        case 'r':
          setEditMode('add-ridge');
          toast.success('Add ridge mode');
          break;
        case 'h':
          setEditMode('add-hip');
          toast.success('Add hip mode');
          break;
        case 'v':
          setEditMode('add-valley');
          toast.success('Add valley mode');
          break;
        case 'delete':
        case 'backspace':
          if (selectedFacetIndex !== null) {
            const faces = [...(measurement.faces || [])];
            faces.splice(selectedFacetIndex, 1);
            const updatedMeasurement = { ...measurement, faces };
            setHasChanges(true);
            onMeasurementUpdate(updatedMeasurement, tags);
            toast.success("Deleted roof facet");
            setSelectedFacetIndex(null);
          } else if (selectedLineData) {
            handleDeleteLine(selectedLineData.type, selectedLineData.index);
          }
          break;
        case 'escape':
          setEditMode('select');
          setDrawPoints([]);
          setSplitPoints([]);
          setSelectedFacets([]);
          toast.info('Cancelled operation');
          break;
      }
      
      // Undo/Redo (Ctrl+Z / Ctrl+Shift+Z)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
      
      // Save (Ctrl+S)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        toast.success('Auto-save active - changes saved automatically');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editMode, selectedFacetIndex, selectedLineData, measurement, tags, onMeasurementUpdate]);

  // Load and cache satellite image with LRU eviction
  useEffect(() => {
    // Check if image is in cache
    const cachedImage = imageCache.getImage(satelliteImageUrl);
    
    if (cachedImage) {
      // Use cached image
      if (fabricCanvas) {
        fabricCanvas.backgroundImage = cachedImage;
        fabricCanvas.renderAll();
      }
      return;
    }

    // Load new image
    console.log('Loading satellite image:', satelliteImageUrl);
    FabricImage.fromURL(satelliteImageUrl, {
      crossOrigin: 'anonymous',
    }).then((img) => {
      // Cache the loaded image
      imageCache.setImage(satelliteImageUrl, img);
      
      // Update canvas background if canvas exists
      if (fabricCanvas) {
        fabricCanvas.backgroundImage = img;
        fabricCanvas.renderAll();
      }
      
      // Log cache stats
      const stats = imageCache.getCacheStats();
      console.log(`[Cache Stats] ${stats.currentSize}/${stats.maxSize} images cached`);
    }).catch((error) => {
      console.error('Failed to load satellite image:', error);
      toast.error('Failed to load satellite image');
    });
  }, [satelliteImageUrl, fabricCanvas, imageCache]);

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor: "#1a1a1a",
      selection: editMode === 'select',
    });

    // Use cached image if available
    const cachedImage = imageCache.getImage(satelliteImageUrl);
    if (cachedImage) {
      console.log('Applying cached image to new canvas');
      canvas.backgroundImage = cachedImage;
      canvas.renderAll();
    }

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [canvasWidth, canvasHeight, satelliteImageUrl, imageCache]);

  // Update canvas selection mode
  useEffect(() => {
    if (!fabricCanvas) return;
    fabricCanvas.selection = editMode === 'select';
    fabricCanvas.renderAll();
  }, [editMode, fabricCanvas]);

  // Draw all measurement overlays
  useEffect(() => {
    if (!fabricCanvas || !measurement) return;

    // Clear existing overlays (keep background)
    const objects = fabricCanvas.getObjects();
    objects.forEach(obj => {
      const objData = (obj as any).data;
      if (objData?.type !== 'background') {
        fabricCanvas.remove(obj);
      }
    });

    drawAllMeasurements();
    fabricCanvas.renderAll();
  }, [fabricCanvas, measurement, tags, layers]);

  // Drag-to-pan and scroll-to-zoom state
  const isPanningRef = useRef(false);
  const lastPosXRef = useRef(0);
  const lastPosYRef = useRef(0);

  // Handle canvas clicks for drawing mode
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleMouseDown = (event: any) => {
      const pointer = fabricCanvas.getPointer(event.e);
      const point = { x: pointer.x, y: pointer.y };

      // Priority: Recenter mode takes precedence over all other modes
      if (recenterMode && onRecenterClick) {
        const normalizedX = Math.min(Math.max(point.x / canvasWidth, 0), 1);
        const normalizedY = Math.min(Math.max(point.y / canvasHeight, 0), 1);
        onRecenterClick(normalizedX, normalizedY);
        return;
      }

      // Right-click delete for lines
      if (event.button === 3) {
        const target = fabricCanvas.findTarget(event.e);
        const targetData = (target as any)?.data;
        
        if (targetData?.type === 'ridge' || targetData?.type === 'hip' || targetData?.type === 'valley') {
          handleDeleteLine(targetData.type, targetData.lineIndex);
        }
        return;
      }

      // Drag-to-pan: only when clicking on empty canvas in select mode
      if (editMode === 'select' && !event.target) {
        isPanningRef.current = true;
        lastPosXRef.current = event.e.clientX;
        lastPosYRef.current = event.e.clientY;
        fabricCanvas.selection = false; // Disable selection while panning
        return;
      }

      if (editMode === 'select') return;

      if (editMode === 'delete') {
        const target = fabricCanvas.findTarget(event.e);
        const targetData = (target as any)?.data;
        if (target && targetData?.editable) {
          handleDeleteObject(target);
        }
        return;
      }

      if (editMode === 'add-ridge' || editMode === 'add-hip' || editMode === 'add-valley') {
        handleAddLine(point);
      } else if (editMode === 'add-facet') {
        handleAddFacetPoint(point);
      } else if (editMode === 'add-marker') {
        handleAddAnnotation(point, 'marker');
      } else if (editMode === 'add-note') {
        setPendingAnnotation({ position: point, type: 'note' });
        setNoteDialogOpen(true);
      } else if (editMode === 'add-damage') {
        setPendingAnnotation({ position: point, type: 'damage' });
        setNoteDialogOpen(true);
      } else if (editMode === 'split-facet') {
        handleSplitFacetClick(point);
      }
    };

    const handleObjectSelection = (event: any) => {
      const target = event.selected?.[0];
      const targetData = (target as any)?.data;
      
      if (targetData?.type === 'facet' && targetData?.faceIndex !== undefined) {
        if (editMode === 'merge-facets') {
          // Multi-select for merging
          if (selectedFacets.includes(targetData.faceIndex)) {
            setSelectedFacets(prev => prev.filter(i => i !== targetData.faceIndex));
          } else {
            setSelectedFacets(prev => [...prev, targetData.faceIndex]);
          }
        } else {
          // Single select for properties panel
          setSelectedFacetIndex(targetData.faceIndex);
        }
      } else if (targetData?.type === 'ridge' || targetData?.type === 'hip' || targetData?.type === 'valley') {
        // Line selected - show line properties panel
        setSelectedLineData({ type: targetData.type, index: targetData.lineIndex });
      }
    };

    fabricCanvas.on('selection:created', handleObjectSelection);
    fabricCanvas.on('selection:updated', handleObjectSelection);
    fabricCanvas.on('selection:cleared', () => {
      if (editMode !== 'merge-facets') {
        setSelectedFacetIndex(null);
      }
      setSelectedLineData(null);
    });

    // Add mouse:move listener for edge highlighting and panning
    const handleMouseMove = (event: any) => {
      // Handle panning
      if (isPanningRef.current) {
        const evt = event.e;
        const vpt = fabricCanvas.viewportTransform;
        if (vpt) {
          vpt[4] += evt.clientX - lastPosXRef.current;
          vpt[5] += evt.clientY - lastPosYRef.current;
          fabricCanvas.requestRenderAll();
          lastPosXRef.current = evt.clientX;
          lastPosYRef.current = evt.clientY;
        }
        return;
      }
      
      // Edge highlighting during line drawing
      if (editMode !== 'add-ridge' && editMode !== 'add-hip' && editMode !== 'add-valley') return;
      
      const pointer = fabricCanvas.getPointer(event.e);
      const point = { x: pointer.x, y: pointer.y };
      
      // Clear previous highlights
      fabricCanvas.getObjects().forEach(obj => {
        if ((obj as any).data?.type === 'edge-highlight') {
          fabricCanvas.remove(obj);
        }
      });
      
      // Find and highlight nearby edges
      if (measurement?.faces) {
        measurement.faces.forEach((face: any) => {
          if (!face.boundary || face.boundary.length < 3) return;
          
          const facePoints = face.boundary.map((coord: number[]) => ({
            x: coord[0] * canvasWidth,
            y: coord[1] * canvasHeight,
          }));
          
          const { isPointNearLine } = require('@/utils/measurementGeometry');
          
          for (let i = 0; i < facePoints.length; i++) {
            const start = facePoints[i];
            const end = facePoints[(i + 1) % facePoints.length];
            
            if (isPointNearLine(point, start, end, 20)) {
              const highlightLine = new Line([start.x, start.y, end.x, end.y], {
                stroke: '#3b82f6',
                strokeWidth: 4,
                opacity: 0.5,
                selectable: false,
                evented: false,
              });
              (highlightLine as any).data = { type: 'edge-highlight' };
              fabricCanvas.add(highlightLine);
            }
          }
        });
      }
      
      fabricCanvas.renderAll();
    };

    const handleMouseUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        fabricCanvas.selection = editMode === 'select'; // Re-enable selection
      }
    };

    const handleMouseWheel = (event: any) => {
      event.e.preventDefault();
      event.e.stopPropagation();
      
      const delta = event.e.deltaY;
      let zoom = fabricCanvas.getZoom();
      zoom *= 0.999 ** delta; // Smooth scroll zoom
      zoom = Math.min(3, Math.max(0.5, zoom)); // Clamp between 0.5x and 3x
      
      fabricCanvas.zoomToPoint(new FabricPoint(event.e.offsetX, event.e.offsetY), zoom);
      setCurrentZoom(zoom);
      fabricCanvas.requestRenderAll();
    };

    fabricCanvas.on('mouse:down', handleMouseDown);
    fabricCanvas.on('mouse:move', handleMouseMove);
    fabricCanvas.on('mouse:up', handleMouseUp);
    fabricCanvas.on('mouse:wheel', handleMouseWheel);

    return () => {
      fabricCanvas.off('mouse:down', handleMouseDown);
      fabricCanvas.off('mouse:move', handleMouseMove);
      fabricCanvas.off('mouse:up', handleMouseUp);
      fabricCanvas.off('mouse:wheel', handleMouseWheel);
      fabricCanvas.off('selection:created', handleObjectSelection);
      fabricCanvas.off('selection:updated', handleObjectSelection);
      fabricCanvas.off('selection:cleared');
    };
  }, [fabricCanvas, editMode, drawPoints, recenterMode, onRecenterClick, canvasWidth, canvasHeight, selectedFacets, measurement]);

  const drawAllMeasurements = () => {
    if (!fabricCanvas) return;

    // Draw grid overlay if enabled
    if (showGrid) {
      drawGrid();
    }

    // Draw roof facets
    if (layers.facets && measurement?.faces) {
      drawRoofFacets();
    }

    // Draw ridge lines
    if (layers.ridges && tags['lf.ridge']) {
      drawFeatureLines('ridge', tags['ridge_lines'] || [], 'green');
    }

    // Draw hip lines
    if (layers.hips && tags['lf.hip']) {
      drawFeatureLines('hip', tags['hip_lines'] || [], 'blue');
    }

    // Draw valley lines
    if (layers.valleys && tags['lf.valley']) {
      drawFeatureLines('valley', tags['valley_lines'] || [], 'red');
    }

    // Draw perimeter
    if (layers.perimeter) {
      drawPerimeter();
    }

    // Draw annotations
    if (layers.annotations) {
      drawAnnotations();
    }

    // Draw compass rose (north arrow)
    drawCompass();

    // Draw scale bar
    drawScaleBar();

    // Draw aggregate facet annotations
    drawAggregateFacetAnnotations();
  };

  const drawGrid = () => {
    if (!fabricCanvas) return;
    
    const gridSpacing = 50; // pixels (represents ~10 feet)
    
    // Vertical lines
    for (let x = 0; x < canvasWidth; x += gridSpacing) {
      const line = new Line([x, 0, x, canvasHeight], {
        stroke: 'hsl(var(--muted-foreground))',
        strokeWidth: 1,
        opacity: 0.2,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
      });
      (line as any).data = { type: 'grid' };
      fabricCanvas.add(line);
    }
    
    // Horizontal lines
    for (let y = 0; y < canvasHeight; y += gridSpacing) {
      const line = new Line([0, y, canvasWidth, y], {
        stroke: 'hsl(var(--muted-foreground))',
        strokeWidth: 1,
        opacity: 0.2,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
      });
      (line as any).data = { type: 'grid' };
      fabricCanvas.add(line);
    }
  };

  const drawCompass = () => {
    if (!fabricCanvas) return;

    const compassSize = 60;
    const compassX = canvasWidth - compassSize - 20;
    const compassY = 20 + compassSize / 2;

    // Draw compass circle background
    const compassBg = new Circle({
      left: compassX,
      top: compassY,
      radius: compassSize / 2,
      fill: 'rgba(255, 255, 255, 0.9)',
      stroke: 'hsl(var(--border))',
      strokeWidth: 2,
      selectable: false,
      evented: false,
    });
    (compassBg as any).data = { type: 'compass' };
    fabricCanvas.add(compassBg);

    // Draw north arrow
    const arrowPoints = [
      { x: compassX, y: compassY - compassSize / 2 + 10 },
      { x: compassX - 8, y: compassY },
      { x: compassX, y: compassY - 5 },
      { x: compassX + 8, y: compassY },
    ];
    
    const arrow = new Polygon(arrowPoints, {
      fill: 'hsl(var(--destructive))',
      stroke: 'hsl(var(--destructive))',
      strokeWidth: 1,
      selectable: false,
      evented: false,
    });
    (arrow as any).data = { type: 'compass' };
    fabricCanvas.add(arrow);

    // Draw 'N' label
    const northLabel = new FabricText('N', {
      left: compassX,
      top: compassY - compassSize / 2 + 5,
      fontSize: 16,
      fontWeight: 'bold',
      fill: 'hsl(var(--foreground))',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    (northLabel as any).data = { type: 'compass' };
    fabricCanvas.add(northLabel);

    // Draw cardinal direction labels
    const directions = [
      { label: 'E', x: compassX + compassSize / 2 - 5, y: compassY },
      { label: 'S', x: compassX, y: compassY + compassSize / 2 - 5 },
      { label: 'W', x: compassX - compassSize / 2 + 5, y: compassY },
    ];

    directions.forEach(dir => {
      const label = new FabricText(dir.label, {
        left: dir.x,
        top: dir.y,
        fontSize: 12,
        fill: 'hsl(var(--muted-foreground))',
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
      (label as any).data = { type: 'compass' };
      fabricCanvas.add(label);
    });
  };

  const drawScaleBar = () => {
    if (!fabricCanvas) return;
    
    const scaleLength = 100; // pixels representing 30 feet
    const x = 20;
    const y = canvasHeight - 40;
    
    // Scale line
    const line = new Line([x, y, x + scaleLength, y], {
      stroke: 'hsl(var(--foreground))',
      strokeWidth: 3,
      selectable: false,
      evented: false,
    });
    (line as any).data = { type: 'scale-bar' };
    fabricCanvas.add(line);
    
    // Tick marks and labels
    [0, 10, 20, 30].forEach((ft, i) => {
      const tickX = x + (i * scaleLength / 3);
      const tick = new Line([tickX, y - 5, tickX, y + 5], {
        stroke: 'hsl(var(--foreground))',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
      (tick as any).data = { type: 'scale-bar' };
      fabricCanvas.add(tick);
      
      const label = new FabricText(`${ft} ft`, {
        left: tickX,
        top: y + 10,
        fontSize: 10,
        fill: 'hsl(var(--foreground))',
        backgroundColor: 'rgba(0,0,0,0.6)',
        padding: 2,
        originX: 'center',
        selectable: false,
        evented: false,
      });
      (label as any).data = { type: 'scale-bar' };
      fabricCanvas.add(label);
    });
  };

  const drawAggregateFacetAnnotations = () => {
    if (!fabricCanvas || !measurement?.faces) return;

    // Group facets by direction and aggregate data
    const directionGroups: Record<string, { area: number; pitch: string; count: number }> = {};

    measurement.faces.forEach((face: any) => {
      const direction = face.direction || 'Unknown';
      const pitch = face.pitch || 'Unknown';
      const area = face.plan_area_sqft || face.area || 0;

      if (!directionGroups[direction]) {
        directionGroups[direction] = { area: 0, pitch, count: 0 };
      }
      directionGroups[direction].area += area;
      directionGroups[direction].count += 1;
    });

    // Position annotations around the perimeter
    const positions = [
      { direction: 'North', x: canvasWidth / 2, y: 40 },
      { direction: 'East', x: canvasWidth - 140, y: canvasHeight / 2 },
      { direction: 'South', x: canvasWidth / 2, y: canvasHeight - 40 },
      { direction: 'West', x: 140, y: canvasHeight / 2 },
    ];

    positions.forEach(pos => {
      const group = directionGroups[pos.direction];
      if (!group || group.count === 0) return;

      const text = `${pos.direction} Face\n${group.pitch} pitch\n${Math.round(group.area).toLocaleString()} sq ft`;

      const annotation = new FabricText(text, {
        left: pos.x,
        top: pos.y,
        fontSize: 13,
        fontWeight: 'bold',
        fill: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        padding: 8,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        textAlign: 'center',
      });
      (annotation as any).data = { type: 'aggregate-annotation' };
      fabricCanvas.add(annotation);
    });
  };

  const drawRoofFacets = () => {
    if (!fabricCanvas || !measurement?.faces) return;

    measurement.faces.forEach((face: any, index: number) => {
      if (!face.boundary || face.boundary.length < 3) return;

      const points = face.boundary.map((coord: number[]) => ({
        x: coord[0] * canvasWidth,
        y: coord[1] * canvasHeight,
      }));

      const color = face.color || FACET_COLOR_PALETTE[index % FACET_COLOR_PALETTE.length];
      const label = face.label || `Facet ${index + 1}`;

      const polygon = new Polygon(points, {
        fill: `${color}33`, // 20% opacity
        stroke: color,
        strokeWidth: 2,
        selectable: editMode === 'select',
        hasControls: true,
        hasBorders: true,
        cornerSize: 12,
        cornerColor: '#3b82f6',
        transparentCorners: false,
        lockRotation: true,
        lockScalingX: false,
        lockScalingY: false,
      });

      (polygon as any).data = { type: 'facet', editable: true, faceIndex: index };
      
      // Hover effects
      polygon.on('mouseover', () => {
        if (editMode === 'select') {
          polygon.set({ 
            fill: `${color}59`, // 35% opacity
            strokeWidth: 3,
            shadow: { color: '#3b82f6', blur: 8, offsetX: 0, offsetY: 0 }
          });
          fabricCanvas.renderAll();
        }
      });

      polygon.on('mouseout', () => {
        polygon.set({ 
          fill: `${color}33`, // 20% opacity
          strokeWidth: 2,
          shadow: undefined,
        });
        fabricCanvas.renderAll();
      });
      
      // Enable interactive corner dragging
      if (editMode === 'select') {
        polygon.on('modified', () => handleFacetModified(polygon, index));
        polygon.on('moving', () => handleFacetModified(polygon, index));
      }
      
      fabricCanvas.add(polygon);

      // Add facet label at center
      const center = getPolygonCenter(points);
      const area = face.area || 0;
      const facetLabel = new FabricText(label, {
        left: center.x,
        top: center.y - 10,
        fontSize: 14,
        fill: 'white',
        fontWeight: 'bold',
        backgroundColor: color,
        padding: 4,
        originX: 'center',
        originY: 'center',
        selectable: false,
      });
      (facetLabel as any).data = { type: 'facet-label' };
      fabricCanvas.add(facetLabel);

      // Add area label below
      const areaLabel = new FabricText(`${area.toFixed(1)} sq ft`, {
        left: center.x,
        top: center.y + 5,
        fontSize: 12,
        fill: 'white',
        backgroundColor: 'rgba(0,0,0,0.7)',
        padding: 2,
        originX: 'center',
        originY: 'center',
        selectable: false,
      });
      (areaLabel as any).data = { type: 'label' };
      fabricCanvas.add(areaLabel);
    });
  };

  const handleFacetModified = (polygon: Polygon, faceIndex: number) => {
    // Get updated points from the polygon
    const points = polygon.points;
    if (!points || points.length < 3) return;

    // Normalize coordinates back to 0-1 range
    const normalizedPoints = points.map((p: any) => [
      p.x / canvasWidth,
      p.y / canvasHeight
    ]);

    // Calculate new area using Turf.js
    const closedPoints = [...normalizedPoints, normalizedPoints[0]];
    const turfPolygon = turf.polygon([closedPoints]);
    const areaMeters = turf.area(turfPolygon);
    const areaSqft = areaMeters * 10.7639; // Convert m² to ft²

    // Update the face in measurement data
    const updatedFaces = [...measurement.faces];
    updatedFaces[faceIndex] = {
      ...updatedFaces[faceIndex],
      boundary: normalizedPoints,
      area: areaSqft,
      plan_area_sqft: areaSqft,
    };

    const updatedMeasurement = {
      ...measurement,
      faces: updatedFaces,
    };

    setHasChanges(true);
    onMeasurementUpdate(updatedMeasurement, tags);
    
    // Show live area update toast
    toast.success(`Facet ${faceIndex + 1} updated: ${Math.round(areaSqft).toLocaleString()} sq ft`);
    
    // Redraw to show updated label
    setTimeout(() => {
      if (fabricCanvas) {
        const objects = fabricCanvas.getObjects();
        objects.forEach(obj => {
          const objData = (obj as any).data;
          if (objData?.type !== 'background') {
            fabricCanvas.remove(obj);
          }
        });
        drawAllMeasurements();
        fabricCanvas.renderAll();
      }
    }, 100);
  };

  const handleSplitFacetClick = (point: Point) => {
    setSplitPoints(prev => {
      const newPoints = [...prev, point];
      
      // Need 2 points to draw split line
      if (newPoints.length === 2) {
        // Draw temporary line
        const line = new Line([newPoints[0].x, newPoints[0].y, newPoints[1].x, newPoints[1].y], {
          stroke: 'yellow',
          strokeWidth: 3,
          strokeDashArray: [5, 5],
          selectable: false,
        });
        (line as any).data = { type: 'temp-split-line' };
        fabricCanvas?.add(line);
        fabricCanvas?.renderAll();
        
        // Execute split
        setTimeout(() => handleExecuteSplit(newPoints[0], newPoints[1]), 100);
        return [];
      }
      
      // Draw temporary point
      const circle = new Circle({
        left: point.x,
        top: point.y,
        radius: 5,
        fill: 'yellow',
        originX: 'center',
        originY: 'center',
        selectable: false,
      });
      (circle as any).data = { type: 'temp-split-point' };
      fabricCanvas?.add(circle);
      fabricCanvas?.renderAll();
      
      return newPoints;
    });
  };

  const handleExecuteSplit = (start: Point, end: Point) => {
    // Find which facet the split line intersects
    const target = fabricCanvas?.findTarget({ clientX: (start.x + end.x) / 2, clientY: (start.y + end.y) / 2 } as any);
    const targetData = (target as any)?.data;
    
    if (!targetData || targetData.type !== 'facet') {
      toast.error('Split line must cross a facet');
      // Clean up temp objects
      fabricCanvas?.getObjects().forEach(obj => {
        const objData = (obj as any).data;
        if (objData?.type?.startsWith('temp-')) {
          fabricCanvas?.remove(obj);
        }
      });
      fabricCanvas?.renderAll();
      return;
    }
    
    const faceIndex = targetData.faceIndex;
    const face = measurement.faces[faceIndex];
    
    // Convert points to normalized coordinates
    const normalizedStart: [number, number] = [start.x / canvasWidth, start.y / canvasHeight];
    const normalizedEnd: [number, number] = [end.x / canvasWidth, end.y / canvasHeight];
    
    // Import splitPolygonByLine from utils
    const { splitPolygonByLine } = require('@/utils/polygonSplitting');
    const result = splitPolygonByLine(face.boundary, { start: normalizedStart, end: normalizedEnd });
    
    if (!result) {
      toast.error('Invalid split line - must intersect facet at exactly 2 points');
      fabricCanvas?.getObjects().forEach(obj => {
        const objData = (obj as any).data;
        if (objData?.type?.startsWith('temp-')) {
          fabricCanvas?.remove(obj);
        }
      });
      fabricCanvas?.renderAll();
      return;
    }
    
    // Calculate areas for new facets
    const { calculatePolygonArea } = require('@/utils/polygonSplitting');
    const area1 = calculatePolygonArea(result.facet1);
    const area2 = calculatePolygonArea(result.facet2);
    
    // Create two new facets
    const updatedFaces = [...measurement.faces];
    updatedFaces[faceIndex] = {
      ...face,
      boundary: result.facet1,
      area: area1,
      plan_area_sqft: area1,
    };
    
    // Add new facet
    updatedFaces.push({
      ...face,
      boundary: result.facet2,
      area: area2,
      plan_area_sqft: area2,
    });
    
    const updatedMeasurement = {
      ...measurement,
      faces: updatedFaces,
    };
    
    setHasChanges(true);
    onMeasurementUpdate(updatedMeasurement, tags);
    
    toast.success(`Facet split into 2 planes: ${Math.round(area1)} sq ft + ${Math.round(area2)} sq ft`);
    
    // Clean up temp objects and redraw
    fabricCanvas?.getObjects().forEach(obj => {
      const objData = (obj as any).data;
      if (objData?.type?.startsWith('temp-')) {
        fabricCanvas?.remove(obj);
      }
    });
    
    // Reset mode
    setEditMode('select');
    setSplitPoints([]);
  };

  const handleMergeFacets = () => {
    if (selectedFacets.length < 2) {
      toast.error('Select at least 2 facets to merge');
      return;
    }
    
    // Get facets to merge
    const facets = selectedFacets.map(index => measurement.faces[index]);
    
    // Merge all selected facets
    let mergedPoints: [number, number][] = [];
    let totalArea = 0;
    
    facets.forEach(face => {
      mergedPoints = [...mergedPoints, ...face.boundary];
      totalArea += face.area || 0;
    });
    
    // Remove duplicates
    const uniquePoints = mergedPoints.filter((point, index, self) => {
      return index === self.findIndex(p => 
        Math.abs(p[0] - point[0]) < 0.001 && Math.abs(p[1] - point[1]) < 0.001
      );
    });
    
    // Keep properties from first facet
    const firstFacet = facets[0];
    
    // Create merged facet
    const mergedFacet = {
      ...firstFacet,
      boundary: uniquePoints,
      area: totalArea,
      plan_area_sqft: totalArea,
    };
    
    // Remove merged facets and add new one
    const updatedFaces = measurement.faces.filter((_, index) => !selectedFacets.includes(index));
    updatedFaces.push(mergedFacet);
    
    const updatedMeasurement = {
      ...measurement,
      faces: updatedFaces,
    };
    
    setHasChanges(true);
    onMeasurementUpdate(updatedMeasurement, tags);
    setSelectedFacets([]);
    setEditMode('select');
    
    toast.success(`${selectedFacets.length} facets merged: ${Math.round(totalArea).toLocaleString()} sq ft`);
  };

  const handleUpdateFacetProperties = (faceIndex: number, updates: Partial<any>) => {
    const updatedFaces = [...measurement.faces];
    updatedFaces[faceIndex] = {
      ...updatedFaces[faceIndex],
      ...updates,
    };
    
    const updatedMeasurement = {
      ...measurement,
      faces: updatedFaces,
    };
    
    setHasChanges(true);
    onMeasurementUpdate(updatedMeasurement, tags);
  };

  const handleDeleteLine = (type: string, lineIndex: number) => {
    const lineKey = `${type}_lines`;
    const lfKey = `lf.${type}`;
    
    const existingLines = tags[lineKey] || [];
    const updatedLines = existingLines.filter((_: any, i: number) => i !== lineIndex);
    const totalLength = updatedLines.reduce((sum: number, l: any) => sum + (l.length || 0), 0);
    
    const updatedTags = {
      ...tags,
      [lineKey]: updatedLines,
      [lfKey]: totalLength,
    };
    
    setHasChanges(true);
    onMeasurementUpdate(measurement, updatedTags);
    toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} line deleted`);
  };

  const handleChangeLineType = (oldType: string, lineIndex: number, newType: string) => {
    const oldLineKey = `${oldType}_lines`;
    const newLineKey = `${newType}_lines`;
    const oldLfKey = `lf.${oldType}`;
    const newLfKey = `lf.${newType}`;
    
    const oldLines = tags[oldLineKey] || [];
    const line = oldLines[lineIndex];
    
    // Remove from old array
    const updatedOldLines = oldLines.filter((_: any, i: number) => i !== lineIndex);
    const oldTotal = updatedOldLines.reduce((sum: number, l: any) => sum + (l.length || 0), 0);
    
    // Add to new array
    const newLines = [...(tags[newLineKey] || []), line];
    const newTotal = newLines.reduce((sum: number, l: any) => sum + (l.length || 0), 0);
    
    const updatedTags = {
      ...tags,
      [oldLineKey]: updatedOldLines,
      [newLineKey]: newLines,
      [oldLfKey]: oldTotal,
      [newLfKey]: newTotal,
    };
    
    setHasChanges(true);
    onMeasurementUpdate(measurement, updatedTags);
    setSelectedLineData(null);
    toast.success(`Converted ${oldType} to ${newType}`);
  };

  const drawFeatureLines = (type: string, lines: any[], color: string) => {
    if (!fabricCanvas) return;

    lines.forEach((lineData: any, index: number) => {
      const start = lineData.start || lineData[0];
      const end = lineData.end || lineData[1];
      
      if (!start || !end) return;

      const line = new Line(
        [
          start[0] * canvasWidth,
          start[1] * canvasHeight,
          end[0] * canvasWidth,
          end[1] * canvasHeight,
        ],
        {
          stroke: color,
          strokeWidth: 3,
          strokeDashArray: type === 'ridge' ? [] : [10, 5],
          selectable: editMode === 'select',
          hasControls: false,
          hasBorders: false,
        }
      );

      (line as any).data = { type, editable: true, lineIndex: index };
      
      // Add hover effects
      line.on('mouseover', () => {
        line.set({ 
          strokeWidth: 5,
          shadow: {
            color: color,
            blur: 10,
            offsetX: 0,
            offsetY: 0,
          }
        });
        fabricCanvas.renderAll();
      });

      line.on('mouseout', () => {
        line.set({ 
          strokeWidth: 3,
          shadow: undefined,
        });
        fabricCanvas.renderAll();
      });
      
      fabricCanvas.add(line);

      // Add length label
      const length = lineData.length || calculateLineLength(start, end);
      const midX = ((start[0] + end[0]) / 2) * canvasWidth;
      const midY = ((start[1] + end[1]) / 2) * canvasHeight;

      const label = new FabricText(`${Math.round(length)} ft ${type}`, {
        left: midX,
        top: midY - 10,
        fontSize: 11,
        fill: 'white',
        backgroundColor: `${color}`,
        padding: 2,
        originX: 'center',
        originY: 'center',
        selectable: false,
      });
      (label as any).data = { type: 'label' };
      fabricCanvas.add(label);
    });
  };

  const drawPerimeter = () => {
    if (!fabricCanvas || !measurement?.boundary) return;

    const boundary = measurement.boundary;
    for (let i = 0; i < boundary.length; i++) {
      const start = boundary[i];
      const end = boundary[(i + 1) % boundary.length];

      const line = new Line(
        [
          start[0] * canvasWidth,
          start[1] * canvasHeight,
          end[0] * canvasWidth,
          end[1] * canvasHeight,
        ],
        {
          stroke: 'orange',
          strokeWidth: 2,
          selectable: false,
          evented: false,
        }
      );

      (line as any).data = { type: 'perimeter' };
      fabricCanvas.add(line);
    }
  };

  const handleAddLine = (point: Point) => {
    // Try to snap to facet edges
    let snappedPoint = point;
    if (measurement?.faces) {
      for (const face of measurement.faces) {
        if (!face.boundary || face.boundary.length < 3) continue;
        
        const facePoints = face.boundary.map((coord: number[]) => ({
          x: coord[0] * canvasWidth,
          y: coord[1] * canvasHeight,
        }));
        
        const snapResult = snapToEdge(point, facePoints, 20);
        if (snapResult) {
          snappedPoint = snapResult;
          // Show visual feedback for snap
          drawSnapIndicator(snapResult);
          break;
        }
      }
    }
    
    if (drawPoints.length === 0) {
      // First point
      setDrawPoints([snappedPoint]);
      drawTempPoint(snappedPoint);
      toast.info("Click to set end point (snaps to edges)");
    } else if (drawPoints.length === 1) {
      // Second point - complete the line
      const newLine = { start: drawPoints[0], end: snappedPoint };
      addNewLine(editMode.replace('add-', '') as 'ridge' | 'hip' | 'valley', newLine);
      setDrawPoints([]);
      clearTempDrawings();
    }
  };

  const drawSnapIndicator = (point: Point) => {
    if (!fabricCanvas) return;
    
    const indicator = new Circle({
      left: point.x,
      top: point.y,
      radius: 8,
      fill: 'transparent',
      stroke: 'yellow',
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
      selectable: false,
    });
    (indicator as any).data = { type: 'temp' };
    fabricCanvas.add(indicator);
    
    // Remove after 500ms
    setTimeout(() => {
      fabricCanvas.remove(indicator);
      fabricCanvas.renderAll();
    }, 500);
    
    fabricCanvas.renderAll();
  };

  const handleAddFacetPoint = (point: Point) => {
    const newPoints = [...drawPoints, point];
    setDrawPoints(newPoints);
    drawTempPoint(point);

    // Check if user clicked near the first point to close the polygon
    if (newPoints.length > 2) {
      const first = newPoints[0];
      const dist = Math.sqrt(Math.pow(point.x - first.x, 2) + Math.pow(point.y - first.y, 2));
      if (dist < 15) {
        // Close the polygon
        addNewFacet(newPoints);
        setDrawPoints([]);
        clearTempDrawings();
        return;
      }
    }

    if (newPoints.length === 1) {
      toast.info("Click to add more points. Click near first point to close.");
    }
  };

  const drawTempPoint = (point: Point) => {
    if (!fabricCanvas) return;

    const circle = new Circle({
      left: point.x,
      top: point.y,
      radius: 5,
      fill: 'yellow',
      originX: 'center',
      originY: 'center',
      selectable: false,
    });
    (circle as any).data = { type: 'temp' };
    fabricCanvas.add(circle);
    fabricCanvas.renderAll();
  };

  const clearTempDrawings = () => {
    if (!fabricCanvas) return;
    const tempObjects = fabricCanvas.getObjects().filter((obj: FabricObject) => (obj as any).data?.type === 'temp');
    tempObjects.forEach(obj => fabricCanvas.remove(obj));
    fabricCanvas.renderAll();
  };

  const addNewLine = (type: 'ridge' | 'hip' | 'valley', line: { start: Point; end: Point }) => {
    pushToUndoStack(); // Save undo state before change
    
    const normalizedStart = [line.start.x / canvasWidth, line.start.y / canvasHeight];
    const normalizedEnd = [line.end.x / canvasWidth, line.end.y / canvasHeight];
    const length = calculateLineLength(normalizedStart, normalizedEnd);
    
    const lineKey = `${type}_lines`;
    const lfKey = `lf.${type}`;
    
    const existingLines = tags[lineKey] || [];
    const newLines = [...existingLines, { start: normalizedStart, end: normalizedEnd, length }];
    
    const totalLength = newLines.reduce((sum, l) => sum + (l.length || 0), 0);
    
    const updatedTags = {
      ...tags,
      [lineKey]: newLines,
      [lfKey]: totalLength,
    };

    setHasChanges(true);
    onMeasurementUpdate(measurement, updatedTags);
    toast.success(`Added ${type} line: ${Math.round(length)} ft`);
  };

  const addNewFacet = (points: Point[]) => {
    pushToUndoStack(); // Save undo state before change
    
    const normalizedPoints = points.map(p => [p.x / canvasWidth, p.y / canvasHeight]);
    const area = calculatePolygonArea(normalizedPoints);

    const newFace = {
      boundary: normalizedPoints,
      area,
      pitch: measurement.faces?.[0]?.pitch || 5,
    };

    const updatedFaces = [...(measurement.faces || []), newFace];
    const updatedMeasurement = {
      ...measurement,
      faces: updatedFaces,
    };

    setHasChanges(true);
    onMeasurementUpdate(updatedMeasurement, tags);
    toast.success(`Added roof facet: ${area.toFixed(1)} sq ft`);
  };

  const drawAnnotations = () => {
    if (!fabricCanvas) return;

    const annotations: Annotation[] = tags.annotations || [];
    
    annotations.forEach((annotation, index) => {
      const pos = {
        x: annotation.normalizedPosition[0] * canvasWidth,
        y: annotation.normalizedPosition[1] * canvasHeight,
      };

      let icon: FabricObject;
      let color: string;

      if (annotation.type === 'marker') {
        // Draw marker pin
        icon = new Circle({
          left: pos.x,
          top: pos.y,
          radius: 8,
          fill: 'hsl(var(--primary))',
          stroke: 'white',
          strokeWidth: 2,
          originX: 'center',
          originY: 'center',
          selectable: editMode === 'select',
        });
        color = 'hsl(var(--primary))';
      } else if (annotation.type === 'note') {
        // Draw note icon
        icon = new Polygon(
          [
            { x: pos.x - 10, y: pos.y - 10 },
            { x: pos.x + 10, y: pos.y - 10 },
            { x: pos.x + 10, y: pos.y + 10 },
            { x: pos.x - 10, y: pos.y + 10 },
          ],
          {
            fill: 'hsl(var(--secondary))',
            stroke: 'white',
            strokeWidth: 2,
            selectable: editMode === 'select',
          }
        );
        color = 'hsl(var(--secondary))';
      } else {
        // Draw damage warning triangle
        icon = new Polygon(
          [
            { x: pos.x, y: pos.y - 12 },
            { x: pos.x - 10, y: pos.y + 8 },
            { x: pos.x + 10, y: pos.y + 8 },
          ],
          {
            fill: 'hsl(var(--destructive))',
            stroke: 'white',
            strokeWidth: 2,
            selectable: editMode === 'select',
          }
        );
        color = 'hsl(var(--destructive))';
      }

      (icon as any).data = { type: 'annotation', editable: true, annotationIndex: index };
      fabricCanvas.add(icon);

      // Add text label if present
      if (annotation.text) {
        const label = new FabricText(annotation.text, {
          left: pos.x,
          top: pos.y + 20,
          fontSize: 11,
          fill: 'white',
          backgroundColor: color,
          padding: 3,
          originX: 'center',
          originY: 'top',
          selectable: false,
        });
        (label as any).data = { type: 'annotation-label', annotationIndex: index };
        fabricCanvas.add(label);
      }
    });
  };

  const handleAddAnnotation = (point: Point, type: 'marker' | 'note' | 'damage', text?: string) => {
    const normalizedPosition: [number, number] = [point.x / canvasWidth, point.y / canvasHeight];
    
    const newAnnotation: Annotation = {
      id: `${type}-${Date.now()}`,
      type,
      position: point,
      normalizedPosition,
      text,
    };

    const existingAnnotations = tags.annotations || [];
    const updatedAnnotations = [...existingAnnotations, newAnnotation];
    
    const updatedTags = {
      ...tags,
      annotations: updatedAnnotations,
    };

    setHasChanges(true);
    onMeasurementUpdate(measurement, updatedTags);
    toast.success(`Added ${type} annotation`);
  };

  const handleSaveNote = () => {
    if (!pendingAnnotation || !noteText.trim()) {
      toast.error("Please enter note text");
      return;
    }

    handleAddAnnotation(pendingAnnotation.position, pendingAnnotation.type, noteText);
    setNoteDialogOpen(false);
    setPendingAnnotation(null);
    setNoteText('');
  };

  const handleDeleteObject = (target: FabricObject) => {
    const targetData = (target as any).data;
    if (!targetData?.editable) return;

    pushToUndoStack(); // Save undo state before delete

    const { type, lineIndex, faceIndex, annotationIndex } = targetData;

    if (type === 'ridge' || type === 'hip' || type === 'valley') {
      const lineKey = `${type}_lines`;
      const lines = [...(tags[lineKey] || [])];
      lines.splice(lineIndex, 1);
      
      const totalLength = lines.reduce((sum, l) => sum + (l.length || 0), 0);
      const updatedTags = {
        ...tags,
        [lineKey]: lines,
        [`lf.${type}`]: totalLength,
      };

      setHasChanges(true);
      onMeasurementUpdate(measurement, updatedTags);
      toast.success(`Deleted ${type} line`);
    } else if (type === 'facet') {
      const faces = [...(measurement.faces || [])];
      faces.splice(faceIndex, 1);
      
      const updatedMeasurement = {
        ...measurement,
        faces,
      };

      setHasChanges(true);
      onMeasurementUpdate(updatedMeasurement, tags);
      toast.success("Deleted roof facet");
    } else if (type === 'annotation') {
      const annotations = [...(tags.annotations || [])];
      annotations.splice(annotationIndex, 1);
      
      const updatedTags = {
        ...tags,
        annotations,
      };

      setHasChanges(true);
      onMeasurementUpdate(measurement, updatedTags);
      toast.success("Deleted annotation");
    }
  };

  const handleReset = () => {
    onMeasurementUpdate(originalDataRef.current.measurement, originalDataRef.current.tags);
    setHasChanges(false);
    setDrawPoints([]);
    clearTempDrawings();
    toast.success("Reset to original measurements");
  };

  const toggleLayer = (layerKey: string) => {
    setLayers(prev => ({ ...prev, [layerKey]: !prev[layerKey] }));
  };

  const getPolygonCenter = (points: Point[]): Point => {
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  };

  const calculateLineLength = (start: number[], end: number[]): number => {
    // Simplified calculation - in real implementation would use geo distance
    const dx = (end[0] - start[0]) * canvasWidth;
    const dy = (end[1] - start[1]) * canvasHeight;
    return Math.sqrt(dx * dx + dy * dy) * 0.5; // Scale factor for feet
  };

  const calculatePolygonArea = (points: number[][]): number => {
    // Shoelace formula for polygon area
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i][0] * points[j][1];
      area -= points[j][0] * points[i][1];
    }
    return Math.abs(area / 2) * canvasWidth * canvasHeight * 0.1; // Scale to sq ft
  };

  const getModeInstructions = (mode: EditMode): string => {
    switch (mode) {
      case 'select':
        return 'Click and drag facet corners to adjust. Select objects to view properties.';
      case 'split-facet':
        return 'Click 2 points across a facet to split it into two planes.';
      case 'merge-facets':
        return 'Select 2+ facets then click "Merge Selected" to combine them.';
      case 'add-ridge':
        return 'Click to place start point, then click again for end point.';
      case 'add-hip':
        return 'Click to place start point, then click again for end point.';
      case 'add-valley':
        return 'Click to place start point, then click again for end point.';
      case 'add-facet':
        return 'Click to place corners. Click near first point to close polygon.';
      case 'delete':
        return 'Click on any line, facet, or annotation to delete it.';
      case 'add-marker':
        return 'Click to place a custom marker on the measurement.';
      case 'add-note':
        return 'Click to place a note with custom text.';
      case 'add-damage':
        return 'Click to mark a damage indicator with notes.';
      default:
        return '';
    }
  };

  const getTotalArea = () => {
    return measurement?.faces?.reduce((sum: number, face: any) => sum + (face.area || 0), 0) || 0;
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <Button 
            size="sm" 
            variant={editMode === 'select' ? 'default' : 'outline'} 
            onClick={() => setEditMode('select')}
          >
            <Move className="h-4 w-4 mr-1" /> Select
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-ridge' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-ridge')}
          >
            <Mountain className="h-4 w-4 mr-1" /> Ridge
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-hip' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-hip')}
          >
            <Triangle className="h-4 w-4 mr-1" /> Hip
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-valley' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-valley')}
          >
            <ArrowDownUp className="h-4 w-4 mr-1" /> Valley
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-facet' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-facet')}
          >
            <Square className="h-4 w-4 mr-1" /> Facet
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'split-facet' ? 'default' : 'outline'} 
            onClick={() => {
              setEditMode('split-facet');
              setSplitPoints([]);
            }}
          >
            <Scissors className="h-4 w-4 mr-1" /> Split
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'merge-facets' ? 'default' : 'outline'} 
            onClick={() => {
              setEditMode('merge-facets');
              setSelectedFacets([]);
            }}
          >
            <Merge className="h-4 w-4 mr-1" /> Merge
          </Button>
          {editMode === 'merge-facets' && selectedFacets.length >= 2 && (
            <Button 
              size="sm" 
              variant="default" 
              onClick={handleMergeFacets}
            >
              Merge Selected ({selectedFacets.length})
            </Button>
          )}
          <Button 
            size="sm" 
            variant={editMode === 'add-marker' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-marker')}
          >
            <MapPin className="h-4 w-4 mr-1" /> Marker
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-note' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-note')}
          >
            <StickyNote className="h-4 w-4 mr-1" /> Note
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-damage' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-damage')}
          >
            <AlertTriangle className="h-4 w-4 mr-1" /> Damage
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'delete' ? 'destructive' : 'outline'} 
            onClick={() => setEditMode('delete')}
          >
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        </div>
        
        <div className="flex gap-2">
          <Button 
            size="sm" 
            variant={showGrid ? 'default' : 'outline'}
            onClick={() => setShowGrid(!showGrid)}
          >
            <Grid3x3 className="h-4 w-4 mr-1" /> Grid
          </Button>
          <Button size="sm" variant="outline" onClick={handleReset} disabled={!hasChanges}>
            <RotateCcw className="h-4 w-4 mr-1" /> Reset
          </Button>
        </div>
      </div>
      
      {/* Layer toggles */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(layers).map(([key, visible]) => (
          <Badge 
            key={key}
            variant={visible ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => toggleLayer(key)}
          >
            {visible ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </Badge>
        ))}
      </div>
      
      {/* Canvas */}
      <div className="border border-border rounded-lg overflow-hidden bg-muted relative">
        <canvas ref={canvasRef} />
        
        {/* Measurement Summary HUD */}
        <div className="absolute top-4 right-4 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg z-10 min-w-[200px]">
          <div className="flex items-center justify-between p-3 border-b">
            <h3 className="text-sm font-semibold">Summary</h3>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => setShowSummaryHUD(!showSummaryHUD)}
              className="h-6 w-6 p-0"
            >
              {showSummaryHUD ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>
          
          {showSummaryHUD && (
            <div className="p-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Area:</span>
                <span className="font-semibold">{getTotalArea().toFixed(0)} sq ft</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Squares:</span>
                <span className="font-semibold">{(getTotalArea() / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ridge:</span>
                <span className="font-semibold">{(tags['lf.ridge'] || 0).toFixed(0)} ft</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hip:</span>
                <span className="font-semibold">{(tags['lf.hip'] || 0).toFixed(0)} ft</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valley:</span>
                <span className="font-semibold">{(tags['lf.valley'] || 0).toFixed(0)} ft</span>
              </div>
              <div className="flex justify-between border-t pt-1 mt-1">
                <span className="text-muted-foreground">Facets:</span>
                <span className="font-semibold">{measurement?.faces?.length || 0}</span>
              </div>
            </div>
          )}
        </div>
        
        {/* Mode indicator */}
        <div className="absolute top-2 left-2">
          <Badge variant="default">
            {editMode === 'select' ? 'Select Mode' : `Drawing ${editMode.replace('add-', '')}`}
          </Badge>
        </div>
        
        {/* Auto-save status */}
        {hasUnsavedChanges && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2">
            <Badge variant="secondary">Unsaved Changes</Badge>
          </div>
        )}
        
        {/* Instructions */}
        <div className="absolute bottom-2 right-2 bg-background/90 backdrop-blur-sm p-2 rounded text-xs max-w-xs">
          <div className="mb-1 font-semibold">Instructions:</div>
          {getModeInstructions(editMode)}
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="text-[10px] text-muted-foreground space-y-0.5">
              <div><kbd className="px-1 bg-muted rounded">S</kbd> Select</div>
              <div><kbd className="px-1 bg-muted rounded">R</kbd> Ridge <kbd className="px-1 bg-muted rounded">H</kbd> Hip <kbd className="px-1 bg-muted rounded">V</kbd> Valley</div>
              <div><kbd className="px-1 bg-muted rounded">Del</kbd> Delete <kbd className="px-1 bg-muted rounded">Esc</kbd> Cancel</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Legend */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 bg-green-500"></div>
          <span>Ridge</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 border-t-2 border-dashed border-blue-500"></div>
          <span>Hip</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 border-t-2 border-dashed border-red-500"></div>
          <span>Valley</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 bg-orange-500"></div>
          <span>Perimeter</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-primary/20 border border-primary"></div>
          <span>Facet</span>
        </div>
        <div className="flex items-center gap-1">
          <MapPin className="h-4 w-4 text-primary" />
          <span>Marker</span>
        </div>
        <div className="flex items-center gap-1">
          <StickyNote className="h-4 w-4 text-secondary" />
          <span>Note</span>
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span>Damage</span>
        </div>
      </div>

      {/* Note/Damage Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={(open) => {
        setNoteDialogOpen(open);
        if (!open) {
          setPendingAnnotation(null);
          setNoteText('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add {pendingAnnotation?.type === 'damage' ? 'Damage' : 'Note'} Annotation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="note-text">
                {pendingAnnotation?.type === 'damage' ? 'Damage Description' : 'Note Text'}
              </Label>
              <Input
                id="note-text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={pendingAnnotation?.type === 'damage' ? 'Describe the damage...' : 'Enter your note...'}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNote} disabled={!noteText.trim()}>
              Add Annotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Facet Properties Panel */}
      {selectedFacetIndex !== null && measurement?.faces?.[selectedFacetIndex] && editMode === 'select' && (
        <EnhancedFacetPropertiesPanel
          facet={measurement.faces[selectedFacetIndex]}
          facetIndex={selectedFacetIndex}
          onUpdateFacet={handleUpdateFacetProperties}
          onClose={() => setSelectedFacetIndex(null)}
        />
      )}

      {/* Line Properties Panel */}
      {selectedLineData && editMode === 'select' && (
        <LinePropertiesPanel
          lineType={selectedLineData.type}
          lineIndex={selectedLineData.index}
          lineData={tags[`${selectedLineData.type}_lines`]?.[selectedLineData.index]}
          onChangeType={handleChangeLineType}
          onDelete={handleDeleteLine}
          onClose={() => setSelectedLineData(null)}
        />
      )}
      
      {/* Validation Error Dialog */}
      {validationResult && (
        <ValidationErrorDialog
          open={showValidationDialog}
          onOpenChange={setShowValidationDialog}
          validationResult={validationResult}
          canContinue={!featureFlags.ENABLE_STRICT_VALIDATION}
          onContinueAnyway={() => {
            setShowValidationDialog(false);
            handleAutoSave();
          }}
          onFixErrors={() => {
            setShowValidationDialog(false);
            toast.info('Review and fix the highlighted errors');
          }}
        />
      )}
    </div>
  );
}
