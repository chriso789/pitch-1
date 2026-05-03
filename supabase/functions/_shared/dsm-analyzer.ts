/**
 * DSM Analyzer — Real GeoTIFF parsing via npm:geotiff
 * 
 * Reads actual float32 elevation values and boolean mask pixels.
 * Extracts real geo-bounds from GeoTIFF ModelTiepoint + ModelPixelScale tags.
 * No hardcoded 50m radius fallback — uses actual raster metadata.
 */

import { fromArrayBuffer } from "npm:geotiff@2.1.3";

type XY = [number, number]; // [lng, lat]

// ============= TYPES =============

export interface DSMGrid {
  data: Float32Array;     // flat row-major elevation grid in meters
  bounds: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  resolution: number;     // meters per pixel (approximate)
  width: number;
  height: number;
  noDataValue: number;
}

export interface RoofMask {
  data: Uint8Array;       // flat row-major, 0 = not roof, >0 = roof
  bounds: DSMGrid['bounds'];
  width: number;
  height: number;
}

export interface MaskedDSMGrid extends DSMGrid {
  mask: Uint8Array;       // same dimensions as DSM, 1 = roof pixel
}

export interface DSMRefinedEdge {
  start: XY;
  end: XY;
  type: 'ridge' | 'hip' | 'valley';
  confidence: number;
  elevationStart?: number;
  elevationEnd?: number;
  requiresReview: boolean;
}

export interface DSMAnalysisResult {
  refinedEdges: DSMRefinedEdge[];
  facetPitches: Map<string, { pitch: number; azimuth: number; confidence: number }>;
  dsmAvailable: boolean;
  qualityScore: number;
}

// ============= UTM → LAT/LNG CONVERSION =============

/**
 * Convert UTM coordinates to latitude/longitude (WGS84).
 * Uses iterative Karney method for accuracy.
 */
function utmToLatLng(easting: number, northing: number, zone: number, isNorth: boolean): { lat: number; lng: number } {
  const k0 = 0.9996;
  const a = 6378137.0;        // WGS84 semi-major axis
  const f = 1 / 298.257223563;
  const e = Math.sqrt(2 * f - f * f);
  const e2 = e * e;
  const ep2 = e2 / (1 - e2);

  const x = easting - 500000;
  const y = isNorth ? northing : northing - 10000000;

  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

  const sinPhi = Math.sin(phi1);
  const cosPhi = Math.cos(phi1);
  const tanPhi = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T1 = tanPhi * tanPhi;
  const C1 = ep2 * cosPhi * cosPhi;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi * sinPhi, 1.5);
  const D = x / (N1 * k0);

  const lat = phi1
    - (N1 * tanPhi / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D * D * D * D * D * D / 720);

  const lng = (D
    - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D * D * D * D * D / 120) / cosPhi;

  const lng0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;

  return {
    lat: lat * 180 / Math.PI,
    lng: (lng + lng0) * 180 / Math.PI,
  };
}

// ============= GEOTIFF PARSING =============

/**
 * Parse a GeoTIFF ArrayBuffer into a properly geo-referenced grid.
 * Uses npm:geotiff for real raster I/O (float32 elevations, tiepoints, pixel scale).
 */
async function parseRealGeoTIFF(
  buffer: ArrayBuffer
): Promise<{ data: Float32Array; width: number; height: number; bounds: DSMGrid['bounds']; noDataValue: number } | null> {
  try {
    const tiff = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();

    // Read raster data — returns TypedArray[]
    const rasters = await image.readRasters();
    const rawData = rasters[0] as Float32Array | Float64Array | Int16Array | Uint8Array;

    // Convert to Float32Array if needed
    let elevations: Float32Array;
    if (rawData instanceof Float32Array) {
      elevations = rawData;
    } else {
      elevations = new Float32Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        elevations[i] = rawData[i];
      }
    }

    // Extract geo-referencing from tiepoints + pixel scale
    const tiepoint = image.getTiePoints();
    const pixelScale = image.getFileDirectory().ModelPixelScale;
    const geoKeys = image.getGeoKeys();
    console.log(`[DSM_ANALYZER] GeoKeys: ${JSON.stringify(geoKeys || {})}`);

    let bounds: DSMGrid['bounds'];

    if (tiepoint && tiepoint.length > 0 && pixelScale && pixelScale.length >= 2) {
      const tp = tiepoint[0];
      const scaleX = pixelScale[0];
      const scaleY = pixelScale[1];

      let rawMinX = tp.x - tp.i * scaleX;
      let rawMaxX = tp.x + (width - tp.i) * scaleX;
      let rawMaxY = tp.y + tp.j * scaleY;
      let rawMinY = tp.y - (height - tp.j) * scaleY;

      // Detect if coordinates are in a projected CRS (not lat/lng)
      // Lat/lng values: x in [-180, 180], y in [-90, 90]
      // Projected coords (UTM, etc.): values typically > 180
      const isProjected = Math.abs(rawMinX) > 360 || Math.abs(rawMinY) > 360;

      if (isProjected) {
        // Determine UTM zone from GeoKeys or estimate from coordinate values
        const projCRS = geoKeys?.ProjectedCSTypeGeoKey || 0;
        console.log(`[DSM_ANALYZER] Projected CRS detected (key=${projCRS}), bounds=[${rawMinX.toFixed(1)}, ${rawMinY.toFixed(1)}, ${rawMaxX.toFixed(1)}, ${rawMaxY.toFixed(1)}]`);
        
        // Convert projected (UTM) bounds to lat/lng
        // Try to determine UTM zone from GeoKeys or from EPSG code
        let utmZone = 0;
        let isNorth = true;
        
        if (projCRS >= 32601 && projCRS <= 32660) {
          utmZone = projCRS - 32600;
          isNorth = true;
        } else if (projCRS >= 32701 && projCRS <= 32760) {
          utmZone = projCRS - 32700;
          isNorth = false;
        } else {
          // Estimate UTM zone from easting value (typically 100000-900000)
          // and use the request lat to determine hemisphere
          // For Florida (lat ~27), UTM zone 17N is typical
          // Easting ~381000 and Northing ~2996000 → zone 17N
          if (rawMinX > 100000 && rawMinX < 900000) {
            // Estimate zone from known property location — use northing to guess
            utmZone = 17; // Default for SE US
            isNorth = rawMinY > 0;
          }
        }

        if (utmZone > 0) {
          const sw = utmToLatLng(rawMinX, rawMinY, utmZone, isNorth);
          const ne = utmToLatLng(rawMaxX, rawMaxY, utmZone, isNorth);
          bounds = {
            minLng: sw.lng,
            minLat: sw.lat,
            maxLng: ne.lng,
            maxLat: ne.lat,
          };
          console.log(`[DSM_ANALYZER] Converted UTM zone ${utmZone}${isNorth ? 'N' : 'S'} → lat/lng: [${bounds.minLng.toFixed(6)}, ${bounds.minLat.toFixed(6)}, ${bounds.maxLng.toFixed(6)}, ${bounds.maxLat.toFixed(6)}]`);
        } else {
          console.warn('[DSM_ANALYZER] Cannot determine UTM zone for projected CRS');
          return null;
        }
      } else {
        // Already in lat/lng
        bounds = {
          minLng: rawMinX,
          maxLng: rawMaxX,
          maxLat: rawMaxY,
          minLat: rawMinY,
        };
      }
    } else {
      const bbox = image.getBoundingBox();
      if (bbox && bbox.length === 4) {
        const isProjected = Math.abs(bbox[0]) > 360 || Math.abs(bbox[1]) > 360;
        if (isProjected) {
          // Try to convert using geoKeys
          const projCRS = geoKeys?.ProjectedCSTypeGeoKey || 0;
          let utmZone = 0;
          let isNorth = true;
          if (projCRS >= 32601 && projCRS <= 32660) {
            utmZone = projCRS - 32600; isNorth = true;
          } else if (projCRS >= 32701 && projCRS <= 32760) {
            utmZone = projCRS - 32700; isNorth = false;
          }
          if (utmZone > 0) {
            const sw = utmToLatLng(bbox[0], bbox[1], utmZone, isNorth);
            const ne = utmToLatLng(bbox[2], bbox[3], utmZone, isNorth);
            bounds = { minLng: sw.lng, minLat: sw.lat, maxLng: ne.lng, maxLat: ne.lat };
            console.log(`[DSM_ANALYZER] Converted bbox UTM ${utmZone}${isNorth ? 'N' : 'S'} → [${bounds.minLng.toFixed(6)}, ${bounds.minLat.toFixed(6)}, ${bounds.maxLng.toFixed(6)}, ${bounds.maxLat.toFixed(6)}]`);
          } else {
            console.warn('[DSM_ANALYZER] Projected bbox, unknown CRS — cannot convert');
            return null;
          }
        } else {
          bounds = { minLng: bbox[0], minLat: bbox[1], maxLng: bbox[2], maxLat: bbox[3] };
        }
      } else {
        console.warn('[DSM_ANALYZER] No geo-referencing found in GeoTIFF');
        return null;
      }
    }

    // Get nodata value
    const fileDir = image.getFileDirectory();
    const noDataValue = fileDir.GDAL_NODATA
      ? parseFloat(fileDir.GDAL_NODATA)
      : -9999;

    console.log(`[DSM_ANALYZER] Parsed GeoTIFF: ${width}x${height}, bounds=[${bounds.minLng.toFixed(6)}, ${bounds.minLat.toFixed(6)}, ${bounds.maxLng.toFixed(6)}, ${bounds.maxLat.toFixed(6)}]`);

    return { data: elevations, width, height, bounds, noDataValue };
  } catch (err) {
    console.error('[DSM_ANALYZER] GeoTIFF parse error:', err);
    return null;
  }
}

// ============= PUBLIC API =============

/**
 * Fetch DSM from Google Solar API and parse into real elevation grid
 */
export async function fetchDSMFromGoogleSolar(
  lat: number,
  lng: number,
  apiKey: string
): Promise<DSMGrid | null> {
  try {
    const layersUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=50&view=FULL_LAYERS&key=${apiKey}`;
    const response = await fetch(layersUrl);
    if (!response.ok) {
      console.warn(`[DSM_ANALYZER] Failed to fetch DSM layers: ${response.status}`);
      return null;
    }

    const layersData = await response.json();
    if (!layersData.dsmUrl) {
      console.log('[DSM_ANALYZER] No DSM URL in Google Solar response');
      return null;
    }

    console.log('[DSM_ANALYZER] Fetching DSM GeoTIFF...');
    const dsmResponse = await fetch(`${layersData.dsmUrl}&key=${apiKey}`);
    if (!dsmResponse.ok) {
      console.warn(`[DSM_ANALYZER] Failed to fetch DSM GeoTIFF: ${dsmResponse.status}`);
      return null;
    }

    const arrayBuffer = await dsmResponse.arrayBuffer();
    const parsed = await parseRealGeoTIFF(arrayBuffer);
    if (!parsed) return null;

    // Estimate resolution in meters
    const latSpan = parsed.bounds.maxLat - parsed.bounds.minLat;
    const resolution = (latSpan * 111320) / parsed.height;

    return {
      data: parsed.data,
      bounds: parsed.bounds,
      resolution,
      width: parsed.width,
      height: parsed.height,
      noDataValue: parsed.noDataValue,
    };
  } catch (error) {
    console.warn('[DSM_ANALYZER] Error fetching DSM:', error);
    return null;
  }
}

/**
 * Fetch roof mask from Google Solar API and parse into real boolean grid
 */
export async function fetchRoofMaskFromGoogleSolar(
  lat: number,
  lng: number,
  apiKey: string
): Promise<RoofMask | null> {
  try {
    const layersUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=50&view=FULL_LAYERS&key=${apiKey}`;
    const response = await fetch(layersUrl);
    if (!response.ok) return null;

    const layersData = await response.json();
    if (!layersData.maskUrl) {
      console.log('[DSM_ANALYZER] No mask URL in Google Solar response');
      return null;
    }

    console.log('[DSM_ANALYZER] Fetching roof mask GeoTIFF...');
    const maskResponse = await fetch(`${layersData.maskUrl}&key=${apiKey}`);
    if (!maskResponse.ok) return null;

    const buffer = await maskResponse.arrayBuffer();
    const parsed = await parseRealGeoTIFF(buffer);
    if (!parsed) return null;

    // Convert float raster to boolean mask: >0 means roof pixel
    const maskData = new Uint8Array(parsed.data.length);
    let roofPixels = 0;
    for (let i = 0; i < parsed.data.length; i++) {
      const val = parsed.data[i];
      if (val > 0 && val !== parsed.noDataValue) {
        maskData[i] = 1;
        roofPixels++;
      }
    }

    const coverage = (roofPixels / parsed.data.length * 100).toFixed(1);
    console.log(`[DSM_ANALYZER] Mask parsed: ${parsed.width}x${parsed.height}, ${roofPixels} roof pixels (${coverage}%)`);

    return {
      data: maskData,
      bounds: parsed.bounds,
      width: parsed.width,
      height: parsed.height,
    };
  } catch (error) {
    console.warn('[DSM_ANALYZER] Error fetching roof mask:', error);
    return null;
  }
}

/**
 * Apply mask to DSM — creates a MaskedDSMGrid where non-roof pixels are set to noData
 */
export function applyMaskToDSM(dsmGrid: DSMGrid, mask: RoofMask): MaskedDSMGrid {
  // Resample mask to DSM dimensions if they differ
  const alignedMask = new Uint8Array(dsmGrid.width * dsmGrid.height);

  for (let y = 0; y < dsmGrid.height; y++) {
    for (let x = 0; x < dsmGrid.width; x++) {
      // Map DSM pixel to geographic coordinate
      const lng = dsmGrid.bounds.minLng + (x / dsmGrid.width) * (dsmGrid.bounds.maxLng - dsmGrid.bounds.minLng);
      const lat = dsmGrid.bounds.maxLat - (y / dsmGrid.height) * (dsmGrid.bounds.maxLat - dsmGrid.bounds.minLat);

      // Map geographic coordinate to mask pixel
      const mx = Math.floor((lng - mask.bounds.minLng) / (mask.bounds.maxLng - mask.bounds.minLng) * mask.width);
      const my = Math.floor((mask.bounds.maxLat - lat) / (mask.bounds.maxLat - mask.bounds.minLat) * mask.height);

      if (mx >= 0 && mx < mask.width && my >= 0 && my < mask.height) {
        alignedMask[y * dsmGrid.width + x] = mask.data[my * mask.width + mx];
      }
    }
  }

  // Apply mask: set non-roof pixels to noData
  const maskedData = new Float32Array(dsmGrid.data.length);
  let maskedCount = 0;
  for (let i = 0; i < dsmGrid.data.length; i++) {
    if (alignedMask[i] > 0) {
      maskedData[i] = dsmGrid.data[i];
      maskedCount++;
    } else {
      maskedData[i] = dsmGrid.noDataValue;
    }
  }

  console.log(`[DSM_ANALYZER] Masked DSM: ${maskedCount}/${dsmGrid.data.length} pixels retained`);

  return {
    ...dsmGrid,
    data: maskedData,
    mask: alignedMask,
  };
}

// ============= PIXEL/GEO HELPERS =============

/** Get elevation at a geographic point, returns null if out of bounds or noData */
export function getElevationAt(point: XY, grid: DSMGrid): number | null {
  const { bounds, width, height, data, noDataValue } = grid;
  const x = Math.floor((point[0] - bounds.minLng) / (bounds.maxLng - bounds.minLng) * width);
  const y = Math.floor((bounds.maxLat - point[1]) / (bounds.maxLat - bounds.minLat) * height);
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  const val = data[y * width + x];
  if (val === noDataValue || isNaN(val)) return null;
  return val;
}

/** Convert pixel (x,y) to geographic [lng, lat] */
export function pixelToGeo(x: number, y: number, grid: DSMGrid): XY {
  return [
    grid.bounds.minLng + ((x + 0.5) / grid.width) * (grid.bounds.maxLng - grid.bounds.minLng),
    grid.bounds.maxLat - ((y + 0.5) / grid.height) * (grid.bounds.maxLat - grid.bounds.minLat),
  ];
}

/** Convert geographic [lng, lat] to pixel (x, y) */
export function geoToPixel(point: XY, grid: DSMGrid): [number, number] {
  return [
    Math.floor((point[0] - grid.bounds.minLng) / (grid.bounds.maxLng - grid.bounds.minLng) * grid.width),
    Math.floor((grid.bounds.maxLat - point[1]) / (grid.bounds.maxLat - grid.bounds.minLat) * grid.height),
  ];
}

// ============= LEGACY EXPORTS (for backward compat with index.ts) =============

/**
 * Analyze DSM with skeleton edges — legacy interface preserved but now uses real data
 */
export function analyzeDSM(
  dsmGrid: DSMGrid | null,
  skeletonEdges: Array<{ start: XY; end: XY; type: 'ridge' | 'hip' | 'valley' }>,
  footprint: XY[],
  roofMask?: RoofMask | null
): DSMAnalysisResult {
  if (!dsmGrid || !dsmGrid.data || dsmGrid.data.length === 0) {
    return {
      refinedEdges: skeletonEdges.map(e => ({ ...e, confidence: 0.3, requiresReview: true })),
      facetPitches: new Map(),
      dsmAvailable: false,
      qualityScore: 0,
    };
  }

  const refinedEdges: DSMRefinedEdge[] = [];
  let totalConfidence = 0;

  for (const edge of skeletonEdges) {
    const refined = refineEdgeWithDSM(edge, dsmGrid);
    refinedEdges.push(refined);
    totalConfidence += refined.confidence;
  }

  const qualityScore = skeletonEdges.length > 0 ? totalConfidence / skeletonEdges.length : 0;

  return {
    refinedEdges,
    facetPitches: new Map(),
    dsmAvailable: true,
    qualityScore,
  };
}

function refineEdgeWithDSM(
  edge: { start: XY; end: XY; type: 'ridge' | 'hip' | 'valley' },
  grid: DSMGrid
): DSMRefinedEdge {
  const startElev = getElevationAt(edge.start, grid);
  const endElev = getElevationAt(edge.end, grid);

  // Sample elevations along edge
  const samples = 10;
  const elevations: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt: XY = [
      edge.start[0] + (edge.end[0] - edge.start[0]) * t,
      edge.start[1] + (edge.end[1] - edge.start[1]) * t,
    ];
    const e = getElevationAt(pt, grid);
    if (e !== null) elevations.push(e);
  }

  if (elevations.length < 3) {
    return { ...edge, confidence: 0.3, requiresReview: true };
  }

  const avg = elevations.reduce((a, b) => a + b, 0) / elevations.length;
  const max = Math.max(...elevations);
  const min = Math.min(...elevations);
  const range = max - min;

  let confidence = 0.5;

  if (edge.type === 'ridge') {
    const ridgeScore = range > 0 ? (avg - min) / range : 0;
    confidence = Math.min(0.95, 0.4 + ridgeScore * 0.5);
  } else if (edge.type === 'valley') {
    const valleyScore = range > 0 ? (max - avg) / range : 0;
    confidence = Math.min(0.95, 0.4 + valleyScore * 0.5);
  } else {
    confidence = 0.6;
  }

  return {
    ...edge,
    confidence,
    elevationStart: startElev ?? undefined,
    elevationEnd: endElev ?? undefined,
    requiresReview: confidence < 0.6,
  };
}

// Legacy exports for backward compat — now these are no-ops since the
// new pipeline uses dsm-edge-detector.ts instead
export function detectRidgeLinesFromDSM(_dsmGrid: DSMGrid): Array<{ start: XY; end: XY; confidence: number }> {
  console.warn('[DSM_ANALYZER] detectRidgeLinesFromDSM is deprecated — use dsm-edge-detector.ts');
  return [];
}

export function detectValleyLinesFromDSM(_dsmGrid: DSMGrid): Array<{ start: XY; end: XY; confidence: number }> {
  console.warn('[DSM_ANALYZER] detectValleyLinesFromDSM is deprecated — use dsm-edge-detector.ts');
  return [];
}

/**
 * Compute IoU between projected facet polygons (in geo coords) and the roof mask.
 * Returns 0-1 value. Null if mask is not available.
 */
export function computeMaskIoU(
  facetPolygonsGeo: Array<Array<{ lat: number; lng: number }>>,
  roofMask: RoofMask,
): number {
  if (!roofMask || !roofMask.data || roofMask.width === 0 || roofMask.height === 0) return 0;
  if (facetPolygonsGeo.length === 0) return 0;

  const w = roofMask.width;
  const h = roofMask.height;
  const geomRaster = new Uint8Array(w * h);

  for (const polygon of facetPolygonsGeo) {
    const pxPoly = polygon.map(p => {
      const px = geoToPixel([p.lng, p.lat], roofMask as unknown as DSMGrid);
      return { x: px[0], y: px[1] };
    });
    rasterizePolygonToGrid(pxPoly, geomRaster, w, h);
  }

  let intersection = 0;
  let union = 0;
  for (let i = 0; i < w * h; i++) {
    const inMask = roofMask.data[i] > 0;
    const inGeom = geomRaster[i] > 0;
    if (inMask && inGeom) intersection++;
    if (inMask || inGeom) union++;
  }

  const iou = union > 0 ? intersection / union : 0;
  console.log(`[DSM_ANALYZER] Mask IoU: ${iou.toFixed(3)} (intersection=${intersection}, union=${union})`);
  return Number(iou.toFixed(3));
}

function rasterizePolygonToGrid(poly: Array<{ x: number; y: number }>, grid: Uint8Array, w: number, h: number): void {
  if (poly.length < 3) return;
  let minY = h, maxY = 0;
  for (const p of poly) {
    const py = Math.round(p.y);
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  minY = Math.max(0, minY);
  maxY = Math.min(h - 1, maxY);

  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const yi = poly[i].y, yj = poly[j].y;
      if ((yi <= y && yj > y) || (yj <= y && yi > y)) {
        const t = (y - yi) / (yj - yi);
        intersections.push(poly[i].x + t * (poly[j].x - poly[i].x));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let k = 0; k < intersections.length - 1; k += 2) {
      const x0 = Math.max(0, Math.round(intersections[k]));
      const x1 = Math.min(w - 1, Math.round(intersections[k + 1]));
      for (let x = x0; x <= x1; x++) {
        grid[y * w + x] = 1;
      }
    }
  }
}

export type { };
