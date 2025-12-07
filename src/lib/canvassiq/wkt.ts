/**
 * WKT (Well-Known Text) geometry utilities for CanvassIQ
 * Provides functions for parsing, creating, and manipulating WKT geometries
 */

import type { LatLng, BBox } from './bbox';

/**
 * Parse WKT POINT to LatLng
 */
export function wktPointToLatLng(wkt: string): LatLng | null {
  const match = wkt.match(/POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)/i);
  if (!match) return null;
  
  return {
    lng: parseFloat(match[1]),
    lat: parseFloat(match[2])
  };
}

/**
 * Convert LatLng to WKT POINT
 */
export function latLngToWktPoint(point: LatLng): string {
  return `POINT(${point.lng} ${point.lat})`;
}

/**
 * Parse WKT LINESTRING to array of LatLng
 */
export function wktLineToLatLngs(wkt: string): LatLng[] {
  const match = wkt.match(/LINESTRING\s*\(\s*(.*?)\s*\)/i);
  if (!match) return [];
  
  return parseCoordinateString(match[1]);
}

/**
 * Convert array of LatLng to WKT LINESTRING
 */
export function latLngsToWktLine(points: LatLng[]): string {
  if (points.length < 2) {
    throw new Error('LINESTRING requires at least 2 points');
  }
  
  const coords = points.map(p => `${p.lng} ${p.lat}`).join(', ');
  return `LINESTRING(${coords})`;
}

/**
 * Parse WKT POLYGON to array of LatLng (outer ring only)
 */
export function wktPolygonToLatLngs(wkt: string): LatLng[] {
  const match = wkt.match(/POLYGON\s*\(\s*\(\s*(.*?)\s*\)\s*\)/i);
  if (!match) return [];
  
  return parseCoordinateString(match[1]);
}

/**
 * Convert array of LatLng to WKT POLYGON
 */
export function latLngsToWktPolygon(points: LatLng[]): string {
  if (points.length < 3) {
    throw new Error('POLYGON requires at least 3 points');
  }
  
  // Ensure the polygon is closed
  const closed = [...points];
  const first = points[0];
  const last = points[points.length - 1];
  if (first.lat !== last.lat || first.lng !== last.lng) {
    closed.push(first);
  }
  
  const coords = closed.map(p => `${p.lng} ${p.lat}`).join(', ');
  return `POLYGON((${coords}))`;
}

/**
 * Parse WKT MULTIPOINT to array of LatLng
 */
export function wktMultiPointToLatLngs(wkt: string): LatLng[] {
  const match = wkt.match(/MULTIPOINT\s*\(\s*(.*?)\s*\)/i);
  if (!match) return [];
  
  // Handle both formats: MULTIPOINT(1 2, 3 4) and MULTIPOINT((1 2), (3 4))
  const inner = match[1].replace(/\(|\)/g, '');
  return parseCoordinateString(inner);
}

/**
 * Convert array of LatLng to WKT MULTIPOINT
 */
export function latLngsToWktMultiPoint(points: LatLng[]): string {
  const coords = points.map(p => `${p.lng} ${p.lat}`).join(', ');
  return `MULTIPOINT(${coords})`;
}

/**
 * Convert BBox to WKT POLYGON
 */
export function bboxToWktPolygon(bbox: BBox): string {
  const points: LatLng[] = [
    { lat: bbox.minLat, lng: bbox.minLng },
    { lat: bbox.minLat, lng: bbox.maxLng },
    { lat: bbox.maxLat, lng: bbox.maxLng },
    { lat: bbox.maxLat, lng: bbox.minLng },
    { lat: bbox.minLat, lng: bbox.minLng } // Close the polygon
  ];
  
  return latLngsToWktPolygon(points);
}

/**
 * Calculate the centroid of a WKT POLYGON
 */
export function wktPolygonCentroid(wkt: string): LatLng | null {
  const points = wktPolygonToLatLngs(wkt);
  if (points.length === 0) return null;
  
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 }
  );
  
  return {
    lat: sum.lat / points.length,
    lng: sum.lng / points.length
  };
}

/**
 * Calculate the length of a WKT LINESTRING in meters
 */
export function wktLineLength(wkt: string): number {
  const points = wktLineToLatLngs(wkt);
  if (points.length < 2) return 0;
  
  let totalMeters = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalMeters += haversineDistance(points[i], points[i + 1]);
  }
  
  return totalMeters;
}

/**
 * Calculate the area of a WKT POLYGON in square meters
 */
export function wktPolygonArea(wkt: string): number {
  const points = wktPolygonToLatLngs(wkt);
  if (points.length < 3) return 0;
  
  // Use Shoelace formula with proper coordinate conversion
  const midLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((midLat * Math.PI) / 180);
  
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const x1 = points[i].lng * metersPerDegLng;
    const y1 = points[i].lat * metersPerDegLat;
    const x2 = points[i + 1].lng * metersPerDegLng;
    const y2 = points[i + 1].lat * metersPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  
  return Math.abs(area) / 2;
}

/**
 * Detect WKT geometry type
 */
export function getWktType(wkt: string): 'POINT' | 'LINESTRING' | 'POLYGON' | 'MULTIPOINT' | 'UNKNOWN' {
  const upper = wkt.trim().toUpperCase();
  if (upper.startsWith('POINT')) return 'POINT';
  if (upper.startsWith('LINESTRING')) return 'LINESTRING';
  if (upper.startsWith('POLYGON')) return 'POLYGON';
  if (upper.startsWith('MULTIPOINT')) return 'MULTIPOINT';
  return 'UNKNOWN';
}

/**
 * Validate WKT string
 */
export function isValidWkt(wkt: string): boolean {
  const type = getWktType(wkt);
  if (type === 'UNKNOWN') return false;
  
  switch (type) {
    case 'POINT':
      return wktPointToLatLng(wkt) !== null;
    case 'LINESTRING':
      return wktLineToLatLngs(wkt).length >= 2;
    case 'POLYGON':
      return wktPolygonToLatLngs(wkt).length >= 3;
    case 'MULTIPOINT':
      return wktMultiPointToLatLngs(wkt).length >= 1;
    default:
      return false;
  }
}

// ============ Helper functions ============

function parseCoordinateString(coordStr: string): LatLng[] {
  return coordStr
    .split(',')
    .map(pair => {
      const parts = pair.trim().split(/\s+/);
      if (parts.length < 2) return null;
      return {
        lng: parseFloat(parts[0]),
        lat: parseFloat(parts[1])
      };
    })
    .filter((p): p is LatLng => p !== null && !isNaN(p.lat) && !isNaN(p.lng));
}

function haversineDistance(p1: LatLng, p2: LatLng): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
