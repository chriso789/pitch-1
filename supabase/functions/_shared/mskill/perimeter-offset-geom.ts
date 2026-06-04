// supabase/functions/_shared/mskill/perimeter-offset-geom.ts
//
// Geodesic polygon buffering in feet, with area + perimeter metrics.
//
// We do NOT pull in turf at runtime (extra cold-start cost). Instead we
// implement a small, focused projection-based buffer: project the polygon
// onto a local equirectangular plane in feet, offset each vertex outward
// along the average of the two adjacent edge normals, then unproject. This
// is accurate enough for residential roof overhangs (1–3 ft) where the
// approximation error from skipping a full Minkowski sum is well under the
// other measurement uncertainty.

type Ring = [number, number][]; // [lon, lat]
type PolygonGeoJSON = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

const FT_PER_METER = 3.28084;
const M_PER_DEG_LAT = 111320; // ≈ meters per degree latitude

function metersPerDegLon(latDeg: number): number {
  return M_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

/** Project a ring (lon/lat) to local feet relative to an origin. */
function projectRingToFeet(ring: Ring, originLat: number, originLon: number): [number, number][] {
  const mpdLon = metersPerDegLon(originLat);
  return ring.map(([lon, lat]) => {
    const xM = (lon - originLon) * mpdLon;
    const yM = (lat - originLat) * M_PER_DEG_LAT;
    return [xM * FT_PER_METER, yM * FT_PER_METER];
  });
}

function unprojectRingFromFeet(ring: [number, number][], originLat: number, originLon: number): Ring {
  const mpdLon = metersPerDegLon(originLat);
  return ring.map(([xFt, yFt]) => {
    const xM = xFt / FT_PER_METER;
    const yM = yFt / FT_PER_METER;
    return [originLon + xM / mpdLon, originLat + yM / M_PER_DEG_LAT];
  });
}

function ringCentroid(ring: Ring): [number, number] {
  let lon = 0, lat = 0, n = 0;
  for (let i = 0; i < ring.length - 1; i++) { lon += ring[i][0]; lat += ring[i][1]; n++; }
  return [lon / n, lat / n];
}

/** Shoelace area (ft²) for a projected ring; positive for CCW. */
function shoelaceArea(ring: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function ringPerimeter(ring: [number, number][]): number {
  let p = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const dx = ring[i + 1][0] - ring[i][0];
    const dy = ring[i + 1][1] - ring[i][1];
    p += Math.hypot(dx, dy);
  }
  return p;
}

/** Offset a closed ring outward by `dFt`. Ring assumed CCW (positive area). */
function offsetRingFeet(ringFt: [number, number][], dFt: number): [number, number][] {
  const n = ringFt.length - 1; // last point repeats first
  const out: [number, number][] = [];
  // Outward normal for edge i→i+1 (with CCW orientation) is (dy, -dx)/len
  const edgeNormals: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ringFt[i];
    const [x2, y2] = ringFt[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    edgeNormals.push([dy / len, -dx / len]);
  }
  for (let i = 0; i < n; i++) {
    const nPrev = edgeNormals[(i - 1 + n) % n];
    const nCurr = edgeNormals[i];
    const bx = nPrev[0] + nCurr[0];
    const by = nPrev[1] + nCurr[1];
    const blen = Math.hypot(bx, by) || 1;
    // Miter length factor: 1 / cos(theta/2) where bisector dot edge-normal
    const dot = (bx / blen) * nCurr[0] + (by / blen) * nCurr[1];
    const miter = dot > 0.001 ? 1 / dot : 1; // cap to avoid spikes on reflex
    const [x, y] = ringFt[i];
    out.push([x + (bx / blen) * dFt * miter, y + (by / blen) * dFt * miter]);
  }
  out.push(out[0]);
  return out;
}

/** Ensure ring is CCW (positive shoelace area). Reverses in place if needed. */
function ensureCCW(ring: [number, number][]): [number, number][] {
  return shoelaceArea(ring) < 0 ? [...ring].reverse() : ring;
}

export type BufferResult = {
  geometry_geojson: PolygonGeoJSON;
  area_sqft: number;
  perimeter_ft: number;
};

/**
 * Buffer a (Multi)Polygon outward by `offsetFt` feet, returning a new
 * GeoJSON polygon plus area (ft²) and perimeter (ft). For MultiPolygon we
 * buffer each polygon's outer ring independently and union by stacking
 * polygons (no real union — adequate for separate building bodies).
 */
export function bufferFootprintFeet(
  footprint: PolygonGeoJSON,
  offsetFt: number,
): BufferResult {
  if (!footprint || (footprint.type !== "Polygon" && footprint.type !== "MultiPolygon")) {
    throw new Error("bufferFootprintFeet: input must be Polygon or MultiPolygon GeoJSON");
  }
  const polygons: number[][][][] = footprint.type === "Polygon"
    ? [footprint.coordinates as number[][][]]
    : (footprint.coordinates as number[][][][]);

  // Use the centroid of the first polygon's outer ring as the local origin.
  const firstOuter = polygons[0][0] as Ring;
  const [originLon, originLat] = ringCentroid(firstOuter);

  let totalArea = 0;
  let totalPerimeter = 0;
  const outPolys: number[][][][] = [];

  for (const poly of polygons) {
    const outer = poly[0] as Ring;
    const outerFt = ensureCCW(projectRingToFeet(outer, originLat, originLon));
    const offsetFt2D = offsetRingFeet(outerFt, offsetFt);
    totalArea += Math.abs(shoelaceArea(offsetFt2D));
    totalPerimeter += ringPerimeter(offsetFt2D);
    const outerLL = unprojectRingFromFeet(offsetFt2D, originLat, originLon);
    // Holes are left untouched (inset by the same amount would shrink them;
    // for roof overhang purposes interior courtyards stay where they are).
    const holesLL: Ring[] = poly.slice(1).map((h) => h as Ring);
    outPolys.push([outerLL, ...holesLL]);
  }

  const geom: PolygonGeoJSON = outPolys.length === 1
    ? { type: "Polygon", coordinates: outPolys[0] }
    : { type: "MultiPolygon", coordinates: outPolys };

  return {
    geometry_geojson: geom,
    area_sqft: Math.round(totalArea * 100) / 100,
    perimeter_ft: Math.round(totalPerimeter * 100) / 100,
  };
}

/** Area + perimeter for the raw (unbuffered) footprint, in ft² and ft. */
export function measureFootprintFeet(footprint: PolygonGeoJSON): { area_sqft: number; perimeter_ft: number } {
  // offsetFt = 0 — reuse buffer logic with zero offset (no-op miter math).
  const r = bufferFootprintFeet(footprint, 0);
  return { area_sqft: r.area_sqft, perimeter_ft: r.perimeter_ft };
}
