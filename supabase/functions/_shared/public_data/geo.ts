// supabase/functions/_shared/public_data/geo.ts

export function polygonToBbox(geojson: any) {
  const coords = extractAllCoords(geojson);
  let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
  for (const [lng, lat] of coords) {
    minLat = Math.min(minLat, lat);
    minLng = Math.min(minLng, lng);
    maxLat = Math.max(maxLat, lat);
    maxLng = Math.max(maxLng, lng);
  }
  return { minLat, minLng, maxLat, maxLng };
}

export function pointInPolygon(lat: number, lng: number, polygon: number[][][]) {
  const ring = polygon[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function samplePolygonGrid(
  geojson: any,
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  opts: { spacingMeters: number; maxPoints: number },
): Array<{ lat: number; lng: number }> {
  const { spacingMeters, maxPoints } = opts;
  const dLat = spacingMeters / 111320;
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const dLng = spacingMeters / (111320 * Math.cos(midLat * Math.PI / 180));

  const poly = toSinglePolygon(geojson);
  const pts: Array<{ lat: number; lng: number }> = [];

  for (let lat = bbox.minLat; lat <= bbox.maxLat; lat += dLat) {
    for (let lng = bbox.minLng; lng <= bbox.maxLng; lng += dLng) {
      if (pointInPolygon(lat, lng, poly)) {
        pts.push({ lat, lng });
        if (pts.length >= maxPoints) return pts;
      }
    }
  }
  return pts;
}

function toSinglePolygon(geojson: any): number[][][] {
  if (geojson?.type === "Polygon") return geojson.coordinates;
  if (geojson?.type === "Feature" && geojson.geometry?.type === "Polygon") return geojson.geometry.coordinates;
  if (geojson?.type === "MultiPolygon") return geojson.coordinates[0];
  if (geojson?.type === "Feature" && geojson.geometry?.type === "MultiPolygon") return geojson.geometry.coordinates[0];
  throw new Error("Unsupported polygon geojson type");
}

function extractAllCoords(geojson: any): number[][] {
  const g = geojson?.type === "Feature" ? geojson.geometry : geojson;
  if (!g) return [];
  if (g.type === "Polygon") return g.coordinates.flat();
  if (g.type === "MultiPolygon") return g.coordinates.flat(2);
  throw new Error("Unsupported geojson for coord extraction");
}
