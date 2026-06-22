// Tier-2 parcel fetcher. Uses Regrid if REGRID_API_KEY is configured,
// otherwise returns an empty result without erroring (so the cascade
// can move on to Tier-3 mask sources).

export interface ParcelCandidate {
  polygon: Array<[number, number]>; // [lng, lat]
  distance_m: number;
  area_sqm: number;
  parcel_id?: string;
}

export interface ParcelResult {
  candidates: ParcelCandidate[];
  http_status: number;
  latency_ms: number;
  source: "regrid" | "none";
  error?: string;
}

export async function fetchParcel(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ParcelResult> {
  const started = performance.now();
  const key = Deno.env.get("REGRID_API_KEY");
  if (!key) {
    return {
      candidates: [],
      http_status: 0,
      latency_ms: 0,
      source: "none",
      error: "REGRID_API_KEY not configured",
    };
  }
  try {
    const url = `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lng}&token=${key}`;
    const resp = await fetchImpl(url);
    const latency_ms = Math.round(performance.now() - started);
    if (!resp.ok) {
      return { candidates: [], http_status: resp.status, latency_ms, source: "regrid", error: `HTTP ${resp.status}` };
    }
    const json = await resp.json();
    const features: any[] = json?.parcels?.features ?? json?.features ?? [];
    const candidates: ParcelCandidate[] = [];
    for (const f of features) {
      const geom = f?.geometry;
      if (!geom) continue;
      const rings = geom.type === "Polygon"
        ? [geom.coordinates?.[0]]
        : geom.type === "MultiPolygon"
          ? geom.coordinates.map((p: any) => p?.[0])
          : [];
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4) continue;
        const polygon: Array<[number, number]> = ring.map((p: number[]) => [p[0], p[1]]);
        const c = centroid(polygon);
        candidates.push({
          polygon,
          distance_m: haversine(lat, lng, c[1], c[0]),
          area_sqm: areaSqm(polygon),
          parcel_id: f?.properties?.fields?.parcelnumb ?? f?.properties?.parcelnumb,
        });
      }
    }
    candidates.sort((a, b) => a.distance_m - b.distance_m);
    return { candidates, http_status: resp.status, latency_ms, source: "regrid" };
  } catch (e) {
    return {
      candidates: [],
      http_status: 0,
      latency_ms: Math.round(performance.now() - started),
      source: "regrid",
      error: (e as Error).message,
    };
  }
}

function centroid(ring: Array<[number, number]>): [number, number] {
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
function areaSqm(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    a += (lng1 * mLng) * (lat2 * mLat) - (lng2 * mLng) * (lat1 * mLat);
  }
  return Math.abs(a) / 2;
}
