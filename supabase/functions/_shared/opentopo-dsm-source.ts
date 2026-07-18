// ============================================================================
// OpenTopography DSM Source
// ----------------------------------------------------------------------------
// Secondary DSM provider used when Google Solar returns bounds-less tiles.
// Uses OpenTopography's globaldem API against USGS 3DEP (1m preferred, 10m
// fallback in-CONUS) and SRTM GL1 (30m) globally.
//
// Because we send the bounding box in the request, the response's spatial
// extent is authoritative even if the returned GeoTIFF's internal tiepoints
// are unusable.
// ============================================================================

import { fromArrayBuffer } from "npm:geotiff@2.1.3";

export type OpenTopoSource =
  | "usgs_3dep_1m"
  | "usgs_3dep_10m"
  | "srtm_gl1";

export interface OpenTopoAttempt {
  demtype: string;
  source: OpenTopoSource;
  status: "ok" | "empty" | "error";
  http_status?: number;
  latency_ms: number;
  error?: string;
  bytes?: number;
}

export interface OpenTopoDsmResult {
  data: Float32Array;
  width: number;
  height: number;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  resolution: number; // meters per pixel (approx, from lat span)
  noDataValue: number;
  source: OpenTopoSource;
  attempts: OpenTopoAttempt[];
}

interface FetchOptions {
  lat: number;
  lng: number;
  /** Half-width of the AOI square in meters. Defaults to 80m (160m box). */
  radiusMeters?: number;
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEMTYPE_ORDER: Array<{ demtype: string; source: OpenTopoSource }> = [
  { demtype: "USGS1m", source: "usgs_3dep_1m" },
  { demtype: "USGS10m", source: "usgs_3dep_10m" },
  { demtype: "SRTMGL1", source: "srtm_gl1" },
];

function metersToLatDeg(m: number): number {
  return m / 111320;
}
function metersToLngDeg(m: number, lat: number): number {
  return m / (111320 * Math.cos((lat * Math.PI) / 180));
}

function buildBbox(lat: number, lng: number, radius: number) {
  const dLat = metersToLatDeg(radius);
  const dLng = metersToLngDeg(radius, lat);
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lng - dLng,
    east: lng + dLng,
  };
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

async function tryOne(
  demtype: string,
  source: OpenTopoSource,
  opts: Required<Pick<FetchOptions, "lat" | "lng" | "radiusMeters" | "timeoutMs">> & {
    apiKey: string;
    signal?: AbortSignal;
  },
): Promise<{ attempt: OpenTopoAttempt; result: OpenTopoDsmResult | null }> {
  const started = Date.now();
  const box = buildBbox(opts.lat, opts.lng, opts.radiusMeters);
  const url =
    `https://portal.opentopography.org/API/globaldem?demtype=${demtype}` +
    `&south=${box.south}&north=${box.north}&west=${box.west}&east=${box.east}` +
    `&outputFormat=GTiff&API_Key=${encodeURIComponent(opts.apiKey)}`;

  try {
    const resp = await fetchWithTimeout(url, opts.timeoutMs, opts.signal);
    const latency_ms = Date.now() - started;
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return {
        attempt: {
          demtype,
          source,
          status: "error",
          http_status: resp.status,
          latency_ms,
          error: body.slice(0, 200),
        },
        result: null,
      };
    }
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("json") || ct.includes("html") || ct.includes("text/plain")) {
      const body = await resp.text().catch(() => "");
      return {
        attempt: {
          demtype,
          source,
          status: "error",
          http_status: resp.status,
          latency_ms,
          error: `unexpected_content_type:${ct}:${body.slice(0, 120)}`,
        },
        result: null,
      };
    }
    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength < 200) {
      return {
        attempt: {
          demtype,
          source,
          status: "empty",
          http_status: resp.status,
          latency_ms,
          bytes: buffer.byteLength,
        },
        result: null,
      };
    }

    const tiff = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const rasters = await image.readRasters();
    const raw = rasters[0] as Float32Array | Float64Array | Int16Array;
    const data =
      raw instanceof Float32Array ? raw : Float32Array.from(raw as any);

    // Prefer the bbox we requested — it's authoritative and always valid.
    const bounds = {
      minLat: box.south,
      maxLat: box.north,
      minLng: box.west,
      maxLng: box.east,
    };
    const resolution = (opts.radiusMeters * 2) / height;

    // Basic sanity — reject if entirely nodata (e.g. USGS1m outside CONUS).
    let valid = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (Number.isFinite(v) && v > -1000 && v < 9000) valid++;
    }
    if (valid / data.length < 0.05) {
      return {
        attempt: {
          demtype,
          source,
          status: "empty",
          http_status: resp.status,
          latency_ms,
          bytes: buffer.byteLength,
          error: "raster_mostly_nodata",
        },
        result: null,
      };
    }

    return {
      attempt: {
        demtype,
        source,
        status: "ok",
        http_status: resp.status,
        latency_ms,
        bytes: buffer.byteLength,
      },
      result: {
        data,
        width,
        height,
        bounds,
        resolution,
        noDataValue: -32768,
        source,
        attempts: [],
      },
    };
  } catch (err) {
    return {
      attempt: {
        demtype,
        source,
        status: "error",
        latency_ms: Date.now() - started,
        error: (err as Error).message ?? String(err),
      },
      result: null,
    };
  }
}

/**
 * Fetch a USGS 3DEP DSM (or SRTM fallback) from OpenTopography.
 * Never throws — always returns attempts log; result is null on total failure.
 */
export async function fetchUsgs3DepDsm(
  opts: FetchOptions,
): Promise<{ result: OpenTopoDsmResult | null; attempts: OpenTopoAttempt[] }> {
  const apiKey = opts.apiKey ?? Deno.env.get("OPENTOPOGRAPHY_API_KEY") ?? "";
  const attempts: OpenTopoAttempt[] = [];
  if (!apiKey) {
    attempts.push({
      demtype: "-",
      source: "usgs_3dep_1m",
      status: "error",
      latency_ms: 0,
      error: "opentopography_api_key_missing",
    });
    return { result: null, attempts };
  }
  const merged = {
    lat: opts.lat,
    lng: opts.lng,
    radiusMeters: opts.radiusMeters ?? 80,
    timeoutMs: opts.timeoutMs ?? 20_000,
    apiKey,
    signal: opts.signal,
  };
  for (const { demtype, source } of DEMTYPE_ORDER) {
    const { attempt, result } = await tryOne(demtype, source, merged);
    attempts.push(attempt);
    if (result) {
      result.attempts = attempts;
      return { result, attempts };
    }
  }
  return { result: null, attempts };
}

/** True iff the returned source is high enough resolution for facet topology. */
export function isCustomerReportEligible(source: OpenTopoSource): boolean {
  return source === "usgs_3dep_1m";
}
