/**
 * Bounding box utilities for CanvassIQ spatial queries
 * Provides functions for creating, manipulating, and querying bounding boxes
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE_LAT = 111.32;

/**
 * Create a bounding box from a center point and radius
 */
export function bboxFromCenter(
  center: LatLng,
  halfWidthKm: number,
  halfHeightKm?: number
): BBox {
  const hHeight = halfHeightKm ?? halfWidthKm;
  
  // Calculate degree offsets based on latitude
  const latOffset = hHeight / KM_PER_DEGREE_LAT;
  const lngOffset = halfWidthKm / (KM_PER_DEGREE_LAT * Math.cos(center.lat * Math.PI / 180));
  
  return {
    minLng: center.lng - lngOffset,
    minLat: center.lat - latOffset,
    maxLng: center.lng + lngOffset,
    maxLat: center.lat + latOffset
  };
}

/**
 * Convert bounding box to query parameters for Edge Functions
 */
export function bboxToQuery(b: BBox): Record<string, string> {
  return {
    minLng: b.minLng.toFixed(8),
    minLat: b.minLat.toFixed(8),
    maxLng: b.maxLng.toFixed(8),
    maxLat: b.maxLat.toFixed(8)
  };
}

/**
 * Create bounding box from an array of points
 */
export function bboxFromPoints(points: LatLng[]): BBox {
  if (points.length === 0) {
    throw new Error('Cannot create bbox from empty points array');
  }
  
  return points.reduce(
    (bbox, point) => ({
      minLng: Math.min(bbox.minLng, point.lng),
      minLat: Math.min(bbox.minLat, point.lat),
      maxLng: Math.max(bbox.maxLng, point.lng),
      maxLat: Math.max(bbox.maxLat, point.lat)
    }),
    {
      minLng: Infinity,
      minLat: Infinity,
      maxLng: -Infinity,
      maxLat: -Infinity
    }
  );
}

/**
 * Check if a point is inside a bounding box
 */
export function bboxContains(bbox: BBox, point: LatLng): boolean {
  return (
    point.lng >= bbox.minLng &&
    point.lng <= bbox.maxLng &&
    point.lat >= bbox.minLat &&
    point.lat <= bbox.maxLat
  );
}

/**
 * Expand bounding box by a padding in kilometers
 */
export function bboxExpand(bbox: BBox, paddingKm: number): BBox {
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const latPadding = paddingKm / KM_PER_DEGREE_LAT;
  const lngPadding = paddingKm / (KM_PER_DEGREE_LAT * Math.cos(centerLat * Math.PI / 180));
  
  return {
    minLng: bbox.minLng - lngPadding,
    minLat: bbox.minLat - latPadding,
    maxLng: bbox.maxLng + lngPadding,
    maxLat: bbox.maxLat + latPadding
  };
}

/**
 * Calculate the center of a bounding box
 */
export function bboxCenter(bbox: BBox): LatLng {
  return {
    lat: (bbox.minLat + bbox.maxLat) / 2,
    lng: (bbox.minLng + bbox.maxLng) / 2
  };
}

/**
 * Calculate approximate area of bounding box in square kilometers
 */
export function bboxAreaKm2(bbox: BBox): number {
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const widthKm = (bbox.maxLng - bbox.minLng) * KM_PER_DEGREE_LAT * Math.cos(centerLat * Math.PI / 180);
  const heightKm = (bbox.maxLat - bbox.minLat) * KM_PER_DEGREE_LAT;
  return widthKm * heightKm;
}

/**
 * Calculate distance between two points in kilometers (Haversine formula)
 */
export function distanceKm(p1: LatLng, p2: LatLng): number {
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Check if two bounding boxes intersect
 */
export function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(
    a.maxLng < b.minLng ||
    a.minLng > b.maxLng ||
    a.maxLat < b.minLat ||
    a.minLat > b.maxLat
  );
}

/**
 * Merge multiple bounding boxes into one
 */
export function bboxMerge(boxes: BBox[]): BBox {
  if (boxes.length === 0) {
    throw new Error('Cannot merge empty bbox array');
  }
  
  return boxes.reduce((merged, bbox) => ({
    minLng: Math.min(merged.minLng, bbox.minLng),
    minLat: Math.min(merged.minLat, bbox.minLat),
    maxLng: Math.max(merged.maxLng, bbox.maxLng),
    maxLat: Math.max(merged.maxLat, bbox.maxLat)
  }));
}
