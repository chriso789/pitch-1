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
}

// Convert geo coordinates to canvas pixels
function geoToPixel(
  lng: number, 
  lat: number, 
  centerLng: number, 
  centerLat: number, 
  zoom: number, 
  width: number, 
  height: number
): { x: number; y: number } {
  const scale = 256 * Math.pow(2, zoom);
  
  // Longitude to X
  const centerX = (centerLng + 180) * (scale / 360);
  const pointX = (lng + 180) * (scale / 360);
  const x = width / 2 + (pointX - centerX);
  
  // Latitude to Y (Web Mercator projection)
  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const centerLatRad = (centerLat * Math.PI) / 180;
  const centerMercN = Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2));
  const centerY = (scale / 2) - (centerMercN * scale / (2 * Math.PI));
  const pointY = (scale / 2) - (mercN * scale / (2 * Math.PI));
  const y = height / 2 + (pointY - centerY);
  
  return { x, y };
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
}: RidgeLineVisualizerProps) {
  
  useEffect(() => {
    if (!canvas || !visible || !linearFeatures) return;

    // Remove existing ridge/hip/valley objects
    const existingObjects = canvas.getObjects().filter(obj => 
      (obj as any).customType === 'linear-feature'
    );
    existingObjects.forEach(obj => canvas.remove(obj));

    // Render ridges (green)
    if (linearFeatures.ridges) {
      linearFeatures.ridges.forEach((ridge, index) => {
        const coords = ridge.points || (ridge.wkt ? parseLineString(ridge.wkt) : []);
        if (coords.length < 2) return;

        const points: { x: number; y: number }[] = coords.map(([lng, lat]) => 
          geoToPixel(lng, lat, centerLng, centerLat, zoom, canvasWidth, canvasHeight)
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
          geoToPixel(lng, lat, centerLng, centerLat, zoom, canvasWidth, canvasHeight)
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
      });
    }

    // Render valleys (red)
    if (linearFeatures.valleys) {
      linearFeatures.valleys.forEach((valley) => {
        const coords = valley.points || (valley.wkt ? parseLineString(valley.wkt) : []);
        if (coords.length < 2) return;

        const points: { x: number; y: number }[] = coords.map(([lng, lat]) => 
          geoToPixel(lng, lat, centerLng, centerLat, zoom, canvasWidth, canvasHeight)
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
      });
    }

    canvas.renderAll();
  }, [canvas, linearFeatures, centerLng, centerLat, zoom, canvasWidth, canvasHeight, visible]);

  return null; // This is a pure effect component
}
