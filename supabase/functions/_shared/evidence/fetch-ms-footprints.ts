// Microsoft Building Footprints fetcher (Tier-1).
// Public dataset: https://github.com/microsoft/USBuildingFootprints
// Mirrored as quadkey-addressable GeoJSON tiles via the Bing Maps tile convention.
// For runtime use we hit the Planetary Computer STAC API which serves the
// global ML footprints dataset and supports lat/lng radius queries without auth.

export interface MsFootprintCandidate {
  polygon: Array<[number, number]>; // [lng, lat]
  distance_m: number;
  area_sqm: number;
}

export interface MsFootprintResult {
  candidates: MsFootprintCandidate[];
  http_status: number;
  latency_ms: number;
  error?: string;
}

const STAC_SEARCH =
  "https://planetarycomputer.microsoft.com/api/stac/v1/search";

// Pull within a small bbox and pick the building polygon nearest target.
export async function fetchMsBuildingFootprints(
  lat: number,
  lng: number,
  radiusMeters = 30,
  fetchImpl: typeof fetch = fetch,
): Promise<MsFootprintResult> {
  const started = performance.now();
  // ~ 1 deg lat = 111_320 m
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
  try {
    const resp = await fetchImpl(STAC_SEARCH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collections: ["ms-buildings"],
        bbox,
        limit: 5,
      }),
    });
    const latency_ms = Math.round(performance.now() - started);
    if (!resp.ok) {
      return { candidates: [], http_status: resp.status, latency_ms, error: `HTTP ${resp.status}` };
    }
    const json = await resp.json();
    const features: any[] = json?.features ?? [];
    const candidates: MsFootprintCandidate[] = [];
    for (const f of features) {
      const geom = f?.geometry;
      if (!geom || geom.type !== "Polygon" || !Array.isArray(geom.coordinates?.[0])) continue;
      const ring: Array<[number, number]> = geom.coordinates[0].map((p: number[]) => [p[0], p[1]]);
      const c = polygonCentroid(ring);
      const distance_m = haversine(lat, lng, c[1], c[0]);
      const area_sqm = ringAreaSqm(ring);
      candidates.push({ polygon: ring, distance_m, area_sqm });
    }
    candidates.sort((a, b) => a.distance_m - b.distance_m);
    return { candidates, http_status: resp.status, latency_ms };
  } catch (e) {
    return {
      candidates: [],
      http_status: 0,
      latency_ms: Math.round(performance.now() - started),
      error: (e as Error).message,
    };
  }
}

function polygonCentroid(ring: Array<[number, number]>): [number, number] {
  let x = 0, y = 0;
  for (const [lng, lat] of ring) { x += lng; y += lat; }
  const n = Math.max(1, ring.length);
  return [x / n, y / n];
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function ringAreaSqm(ring: Array<[number, number]>): number {
  // Equirectangular approx — fine for building-scale polygons.
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    a += (lng1 * mPerDegLng) * (lat2 * mPerDegLat) - (lng2 * mPerDegLng) * (lat1 * mPerDegLat);
  }
  return Math.abs(a) / 2;
}
