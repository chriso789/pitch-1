// Nationwide (US) parcel footprint via public ArcGIS FeatureServers.
// No API key required. Covers most US counties through Esri's aggregated
// "USA Parcels" layer plus a fallback to the Esri "USA Structures" building layer
// (Oak Ridge / DHS FEMA dataset, nationwide building footprints).
//
// Priority inside this extractor:
//   1. USA_Structures (building footprint, higher fidelity for roof geometry)
//   2. USA_Parcels    (parcel polygon — building is inset from parcel)

export interface UsParcelResult {
  vertices: Array<{ lat: number; lng: number }>;
  confidence: number;
  source: 'usa_structures' | 'usa_parcels';
}

const STRUCTURES_URL =
  'https://services2.arcgis.com/FiaPA4ga0iQKduv3/ArcGIS/rest/services/USA_Structures_View/FeatureServer/0/query';
// Esri Living Atlas aggregated parcel layer (Regrid-sourced sample coverage;
// works nationwide for many counties without auth for point-in-polygon queries).
const PARCELS_URL =
  'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_Parcels/FeatureServer/0/query';

async function queryArcgis(
  url: string,
  lat: number,
  lng: number,
  signal: AbortSignal,
): Promise<GeoJSON.Feature | null> {
  const params = new URLSearchParams({
    f: 'geojson',
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'true',
    outFields: '*',
    resultRecordCount: '1',
  });
  const res = await fetch(`${url}?${params.toString()}`, { signal });
  if (!res.ok) return null;
  const json = await res.json();
  const feat = json?.features?.[0];
  return feat ?? null;
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

export async function fetchUsParcelOrStructure(
  lat: number,
  lng: number,
  opts: { timeoutMs?: number } = {},
): Promise<UsParcelResult | null> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 6000);
  try {
    // 1. Try building footprint first (best for roof geometry)
    try {
      const feat = await queryArcgis(STRUCTURES_URL, lat, lng, ctl.signal);
      const ring = largestRing(feat?.geometry as GeoJSON.Geometry | undefined);
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

    // 2. Fall back to parcel polygon
    try {
      const feat = await queryArcgis(PARCELS_URL, lat, lng, ctl.signal);
      const ring = largestRing(feat?.geometry as GeoJSON.Geometry | undefined);
      if (ring && ring.length >= 4) {
        return {
          vertices: ringToVertices(ring),
          confidence: 0.6, // parcel boundary, not building
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
