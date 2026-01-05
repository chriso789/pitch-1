import { useEffect } from 'react';
import { Line, Circle, Text } from 'fabric';
import type { Canvas as FabricCanvas } from 'fabric';

interface LinearFeature {
  id: string;
  wkt?: string;
  points?: [number, number][];
  length_ft?: number;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  label?: string;
}

interface TransformConfig {
  tileCenterLng: number;
  tileCenterLat: number;
  tileZoom: number;
  canvasWidth: number;
  canvasHeight: number;
  offsetX?: number;
  offsetY?: number;
  scale?: number;
}

interface RidgeLineVisualizerProps {
  canvas: FabricCanvas | null;
  linearFeatures?: {
    ridges?: LinearFeature[];
    hips?: LinearFeature[];
    valleys?: LinearFeature[];
  };
  centerLng: number;
  centerLat: number;
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
  visible?: boolean;
  // Calibration props for manual adjustment
  offsetX?: number;
  offsetY?: number;
  scaleAdjustment?: number;
}

// IMPROVED: Tile-aligned geo to pixel conversion
// This accounts for how satellite tiles are actually fetched and displayed
function geoToPixelAligned(
  lng: number, 
  lat: number, 
  config: TransformConfig
): { x: number; y: number } {
  const { 
    tileCenterLng, 
    tileCenterLat, 
    tileZoom, 
    canvasWidth, 
    canvasHeight, 
    offsetX = 0, 
    offsetY = 0, 
    scale = 1 
  } = config;
  
  // Calculate meters per pixel at this zoom level
  // At zoom 20, 1 pixel ≈ 0.15 meters at equator
  const metersPerPixelAtEquator = 156543.03392 / Math.pow(2, tileZoom);
  const metersPerPixel = metersPerPixelAtEquator * Math.cos(tileCenterLat * Math.PI / 180);
  
  // Convert coordinate difference to meters
  const metersPerDegreeLng = 111320 * Math.cos(tileCenterLat * Math.PI / 180);
  const metersPerDegreeLat = 110540;
  
  const deltaLng = lng - tileCenterLng;
  const deltaLat = lat - tileCenterLat;
  
  const deltaMetersX = deltaLng * metersPerDegreeLng;
  const deltaMetersY = deltaLat * metersPerDegreeLat;
  
  // Convert meters to pixels with scale adjustment
  const deltaPixelsX = (deltaMetersX / metersPerPixel) * scale;
  const deltaPixelsY = -(deltaMetersY / metersPerPixel) * scale; // Y is inverted
  
  return {
    x: (canvasWidth / 2) + deltaPixelsX + offsetX,
    y: (canvasHeight / 2) + deltaPixelsY + offsetY
  };
}

// Legacy function for backwards compatibility
function geoToPixel(
  lng: number, 
  lat: number, 
  centerLng: number, 
  centerLat: number, 
  zoom: number, 
  width: number, 
  height: number,
  offsetX: number = 0,
  offsetY: number = 0,
  scale: number = 1
): { x: number; y: number } {
  return geoToPixelAligned(lng, lat, {
    tileCenterLng: centerLng,
    tileCenterLat: centerLat,
    tileZoom: zoom,
    canvasWidth: width,
    canvasHeight: height,
    offsetX,
    offsetY,
    scale
  });
}

// Parse WKT LINESTRING to coordinates
function parseLineString(wkt: string): [number, number][] {
  const match = wkt.match(/LINESTRING\(([^)]+)\)/);
  if (!match) return [];
  
  return match[1]
    .split(',')
    .map(pair => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return [lng, lat] as [number, number];
    });
}

export function RidgeLineVisualizer({
  canvas,
  linearFeatures,
  centerLng,
  centerLat,
  zoom,
  canvasWidth,
  canvasHeight,
  visible = true,
  offsetX = 0,
  offsetY = 0,
  scaleAdjustment = 1,
}: RidgeLineVisualizerProps) {
  
  useEffect(() => {
    if (!canvas || !visible || !linearFeatures) return;

    // Remove existing ridge/hip/valley objects
    const existingObjects = canvas.getObjects().filter(obj => 
      (obj as any).customType === 'linear-feature'
    );
    existingObjects.forEach(obj => canvas.remove(obj));

    const transformConfig: TransformConfig = {
      tileCenterLng: centerLng,
      tileCenterLat: centerLat,
      tileZoom: zoom,
      canvasWidth,
      canvasHeight,
      offsetX,
      offsetY,
      scale: scaleAdjustment,
    };

    // Render ridges (green)
    if (linearFeatures.ridges) {
      linearFeatures.ridges.forEach((ridge, index) => {
        const coords = ridge.points || (ridge.wkt ? parseLineString(ridge.wkt) : []);
        if (coords.length < 2) return;

        const points: { x: number; y: number }[] = coords.map(([lng, lat]) => 
          geoToPixelAligned(lng, lat, transformConfig)
        );

        // Draw line
        for (let i = 0; i < points.length - 1; i++) {
          const line = new Line([
            points[i].x,
            points[i].y,
            points[i + 1].x,
            points[i + 1].y,
          ], {
            stroke: '#10b981',
            strokeWidth: 4,
            selectable: false,
            evented: false,
          });
          (line as any).customType = 'linear-feature';
          canvas.add(line);
        }

        // Draw endpoints
        points.forEach((point, i) => {
          const circle = new Circle({
            left: point.x,
            top: point.y,
            radius: 5,
            fill: '#10b981',
            stroke: '#ffffff',
            strokeWidth: 2,
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
          });
          (circle as any).customType = 'linear-feature';
          canvas.add(circle);
        });

        // Label
        const midPoint = points[Math.floor(points.length / 2)];
        const lengthLabel = ridge.length_ft 
          ? `${Math.round(ridge.length_ft)} ft` 
          : 'Ridge';
        
        const label = new Text(lengthLabel, {
          left: midPoint.x,
          top: midPoint.y - 20,
          fontSize: 12,
          fill: '#ffffff',
          backgroundColor: '#10b981',
          padding: 4,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        (label as any).customType = 'linear-feature';
        canvas.add(label);
      });
    }

    // Render hips (blue)
    if (linearFeatures.hips) {
      linearFeatures.hips.forEach((hip) => {
        const coords = hip.points || (hip.wkt ? parseLineString(hip.wkt) : []);
        if (coords.length < 2) return;

        const points: { x: number; y: number }[] = coords.map(([lng, lat]) => 
          geoToPixelAligned(lng, lat, transformConfig)
        );

        for (let i = 0; i < points.length - 1; i++) {
          const line = new Line([
            points[i].x,
            points[i].y,
            points[i + 1].x,
            points[i + 1].y,
          ], {
            stroke: '#3b82f6',
            strokeWidth: 4,
            selectable: false,
            evented: false,
            strokeDashArray: [8, 4],
          });
          (line as any).customType = 'linear-feature';
          canvas.add(line);
        }

        points.forEach((point) => {
          const circle = new Circle({
            left: point.x,
            top: point.y,
            radius: 5,
            fill: '#3b82f6',
            stroke: '#ffffff',
            strokeWidth: 2,
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
          });
          (circle as any).customType = 'linear-feature';
          canvas.add(circle);
        });

        // Label for hip
        const midPoint = points[Math.floor(points.length / 2)];
        const lengthLabel = hip.length_ft 
          ? `${Math.round(hip.length_ft)} ft` 
          : 'Hip';
        
        const label = new Text(lengthLabel, {
          left: midPoint.x,
          top: midPoint.y - 20,
          fontSize: 12,
          fill: '#ffffff',
          backgroundColor: '#3b82f6',
          padding: 4,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        (label as any).customType = 'linear-feature';
        canvas.add(label);
      });
    }

    // Render valleys (red)
    if (linearFeatures.valleys) {
      linearFeatures.valleys.forEach((valley) => {
        const coords = valley.points || (valley.wkt ? parseLineString(valley.wkt) : []);
        if (coords.length < 2) return;

        const points: { x: number; y: number }[] = coords.map(([lng, lat]) => 
          geoToPixelAligned(lng, lat, transformConfig)
        );

        for (let i = 0; i < points.length - 1; i++) {
          const line = new Line([
            points[i].x,
            points[i].y,
            points[i + 1].x,
            points[i + 1].y,
          ], {
            stroke: '#ef4444',
            strokeWidth: 4,
            selectable: false,
            evented: false,
            strokeDashArray: [8, 4],
          });
          (line as any).customType = 'linear-feature';
          canvas.add(line);
        }

        points.forEach((point) => {
          const circle = new Circle({
            left: point.x,
            top: point.y,
            radius: 5,
            fill: '#ef4444',
            stroke: '#ffffff',
            strokeWidth: 2,
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
          });
          (circle as any).customType = 'linear-feature';
          canvas.add(circle);
        });

        // Label for valley
        const midPoint = points[Math.floor(points.length / 2)];
        const lengthLabel = valley.length_ft 
          ? `${Math.round(valley.length_ft)} ft` 
          : 'Valley';
        
        const label = new Text(lengthLabel, {
          left: midPoint.x,
          top: midPoint.y - 20,
          fontSize: 12,
          fill: '#ffffff',
          backgroundColor: '#ef4444',
          padding: 4,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        (label as any).customType = 'linear-feature';
        canvas.add(label);
      });
    }

    canvas.renderAll();
  }, [canvas, linearFeatures, centerLng, centerLat, zoom, canvasWidth, canvasHeight, visible, offsetX, offsetY, scaleAdjustment]);

  return null; // This is a pure effect component
}

// Export transform function for use in other components
export { geoToPixelAligned, type TransformConfig };
