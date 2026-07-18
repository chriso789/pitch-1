// Nationwide (US) parcel + building footprint via public ArcGIS FeatureServers.
// No API key required.
//
// IMPORTANT: The Esri "USA_Structures_View" and "USA_Parcels" services reject
// esriGeometryPoint spatial queries with HTTP 400 ("Invalid query parameters").
// We MUST use an envelope query around the target coordinate and then choose
// the polygon that actually contains the point (or the nearest one).
//
// Priority:
//   1. USA_Structures (building footprint — best for roof geometry)
//   2. USA_Parcels    (parcel polygon — building is inset from parcel)

export interface UsParcelResult {
  vertices: Array<{ lat: number; lng: number }>;
  confidence: number;
  source: 'usa_structures' | 'usa_parcels';
}

const STRUCTURES_URL =
  'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query';
const PARCELS_URL =
  'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Parcels/FeatureServer/0/query';

// Envelope half-size in degrees (~55m at FL latitude). Enough to catch the
// target building even when the geocode point drifts to the yard/street.
const ENVELOPE_HALF_DEG = 0.0005;

async function queryArcgisEnvelope(
  url: string,
  lat: number,
  lng: number,
  signal: AbortSignal,
): Promise<GeoJSON.Feature[]> {
  const xmin = lng - ENVELOPE_HALF_DEG;
  const ymin = lat - ENVELOPE_HALF_DEG;
  const xmax = lng + ENVELOPE_HALF_DEG;
  const ymax = lat + ENVELOPE_HALF_DEG;
  const params = new URLSearchParams({
    f: 'geojson',
    geometry: `${xmin},${ymin},${xmax},${ymax}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'true',
    outFields: '*',
    resultRecordCount: '25',
  });
  const res = await fetch(`${url}?${params.toString()}`, { signal });
  if (!res.ok) return [];
  const json = await res.json();
  return (json?.features ?? []) as GeoJSON.Feature[];
}

function ringToVertices(ring: number[][]): Array<{ lat: number; lng: number }> {
  return ring.map(([lng, lat]) => ({ lat, lng }));
}

function largestRing(geom: GeoJSON.Geometry | undefined): number[][] | null {
  if (!geom) return null;
  if (geom.type === 'Polygon') return geom.coordinates[0] ?? null;
  if (geom.type === 'MultiPolygon') {
    let best: number[][] | null = null;
    let bestLen = 0;
    for (const poly of geom.coordinates) {
      const outer = poly[0];
      if (outer && outer.length > bestLen) {
        best = outer;
        bestLen = outer.length;
      }
    }
    return best;
  }
  return null;
}

function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringCentroid(ring: number[][]): { lat: number; lng: number } {
  let sx = 0;
  let sy = 0;
  const n = ring.length - (ring[0] === ring[ring.length - 1] ? 1 : 0);
  for (let i = 0; i < n; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  return { lat: sy / n, lng: sx / n };
}

function pickBestRing(
  features: GeoJSON.Feature[],
  lat: number,
  lng: number,
): number[][] | null {
  let containing: number[][] | null = null;
  let nearest: number[][] | null = null;
  let nearestDist = Infinity;
  for (const f of features) {
    const ring = largestRing(f.geometry as GeoJSON.Geometry | undefined);
    if (!ring || ring.length < 4) continue;
    if (pointInRing(lat, lng, ring)) {
      // Prefer smaller containing polygon (a building beats a parcel).
      containing = ring;
    }
    const c = ringCentroid(ring);
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    if (d < nearestDist) {
      nearestDist = d;
      nearest = ring;
    }
  }
  return containing ?? nearest;
}

export async function fetchUsParcelOrStructure(
  lat: number,
  lng: number,
  opts: { timeoutMs?: number } = {},
): Promise<UsParcelResult | null> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 6000);
  try {
    // 1. Building footprint (best for roof geometry)
    try {
      const feats = await queryArcgisEnvelope(STRUCTURES_URL, lat, lng, ctl.signal);
      const ring = pickBestRing(feats, lat, lng);
      if (ring && ring.length >= 4) {
        return {
          vertices: ringToVertices(ring),
          confidence: 0.85,
          source: 'usa_structures',
        };
      }
    } catch (e) {
      console.warn('[us-parcel] USA_Structures failed:', (e as Error).message);
    }

    // 2. Parcel polygon fallback
    try {
      const feats = await queryArcgisEnvelope(PARCELS_URL, lat, lng, ctl.signal);
      const ring = pickBestRing(feats, lat, lng);
      if (ring && ring.length >= 4) {
        return {
          vertices: ringToVertices(ring),
          confidence: 0.6,
          source: 'usa_parcels',
        };
      }
    } catch (e) {
      console.warn('[us-parcel] USA_Parcels failed:', (e as Error).message);
    }

    return null;
  } finally {
    clearTimeout(timeout);
  }
}
