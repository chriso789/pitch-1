// Internal U-Net inference client.
// Calls the trained roof segmentation service deployed on Render.
// Service contract (from infra memory):
//   POST {INTERNAL_UNET_INFERENCE_URL}
//   Authorization: Bearer {INTERNAL_UNET_API_KEY}
//   Body: { lat, lng, address?, pitch_override? }
//   Returns: { meta, location, roof, measurements: { area_sqft, predominant_pitch, lengths_ft:{ridge,hip,valley,eave,rake} },
//              geometry: { footprint_polygon: [[lng,lat],...], features: [{type,p1,p2,length_ft,confidence,source}] },
//              debug: { meters_per_pixel, alignment_score, ... } }

export interface UNetFeature {
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  p1: [number, number]; // [lng, lat]
  p2: [number, number];
  length_ft?: number;
  confidence?: number;
  source?: string;
}

export interface UNetInferenceResult {
  meta?: { version?: string; source?: string; generated_at?: string; stub?: boolean };
  roof?: { type?: string; confidence?: number };
  measurements?: {
    area_sqft?: number;
    predominant_pitch?: number;
    lengths_ft?: {
      ridge?: number; hip?: number; valley?: number; eave?: number; rake?: number;
    };
  };
  geometry?: {
    footprint_polygon?: [number, number][];
    features?: UNetFeature[];
  };
  debug?: Record<string, unknown>;
}

export interface UNetCallOptions {
  lat: number;
  lng: number;
  address?: string;
  pitch_override?: number;
  timeoutMs?: number;
}

export interface UNetCallOutcome {
  ok: boolean;
  result?: UNetInferenceResult;
  error?: string;
  status?: number;
  durationMs: number;
  configured: boolean;
  isStub: boolean;
}

/**
 * Call the internal U-Net Render service.
 * Returns a structured outcome — never throws, so callers can decide
 * whether to fall back to vision / skeleton paths.
 */
export async function callInternalUNet(opts: UNetCallOptions): Promise<UNetCallOutcome> {
  const url = Deno.env.get('INTERNAL_UNET_INFERENCE_URL');
  const key = Deno.env.get('INTERNAL_UNET_API_KEY');
  const started = Date.now();

  if (!url) {
    return { ok: false, error: 'INTERNAL_UNET_INFERENCE_URL not configured', durationMs: 0, configured: false, isStub: false };
  }

  const timeoutMs = opts.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        lat: opts.lat,
        lng: opts.lng,
        address: opts.address ?? null,
        pitch_override: opts.pitch_override ?? null,
      }),
    });

    const durationMs = Date.now() - started;

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        ok: false,
        status: resp.status,
        error: `U-Net service ${resp.status}: ${text.slice(0, 300)}`,
        durationMs,
        configured: true,
        isStub: false,
      };
    }

    const json = (await resp.json()) as UNetInferenceResult;
    const isStub = !!json?.meta?.stub || json?.meta?.source === 'pitch-ai-stub';

    // Reject empty / stub results so callers fall back instead of persisting zeros.
    const hasGeometry =
      Array.isArray(json?.geometry?.footprint_polygon) && (json!.geometry!.footprint_polygon!.length >= 3);
    const hasMeasurement = (json?.measurements?.area_sqft ?? 0) > 0;

    if (isStub || (!hasGeometry && !hasMeasurement)) {
      return {
        ok: false,
        result: json,
        error: isStub ? 'U-Net returned stub result' : 'U-Net returned empty geometry',
        durationMs,
        configured: true,
        isStub,
      };
    }

    return { ok: true, result: json, durationMs, configured: true, isStub: false };
  } catch (err) {
    const durationMs = Date.now() - started;
    const msg = err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err);
    return { ok: false, error: msg, durationMs, configured: true, isStub: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convert a successful U-Net inference into the overlay shape consumed by
 * `convertVisionOverlayToMeasureResult` in measure/index.ts.
 *
 * This lets us reuse the existing persistence path (perimeter -> WKT,
 * shoelace area, linear features) without duplicating logic.
 */
export function unetResultToOverlay(result: UNetInferenceResult): {
  perimeter: [number, number][];
  ridges: Array<{ start: [number, number]; end: [number, number]; confidence: number }>;
  hips: Array<{ start: [number, number]; end: [number, number]; confidence: number }>;
  valleys: Array<{ start: [number, number]; end: [number, number]; confidence: number }>;
  eaves: Array<{ start: [number, number]; end: [number, number]; confidence: number }>;
  rakes: Array<{ start: [number, number]; end: [number, number]; confidence: number }>;
  metadata: {
    roofType?: string;
    qualityScore?: number;
    totalAreaSqft?: number;
    perimeterSource?: string;
    pitch?: string;
  };
} | null {
  const footprint = result?.geometry?.footprint_polygon ?? [];
  if (!Array.isArray(footprint) || footprint.length < 3) return null;

  const features = result?.geometry?.features ?? [];
  const bucket = (t: UNetFeature['type']) =>
    features
      .filter((f) => f.type === t)
      .map((f) => ({
        start: f.p1,
        end: f.p2,
        confidence: typeof f.confidence === 'number' ? f.confidence : 0.85,
      }));

  return {
    perimeter: footprint,
    ridges: bucket('ridge'),
    hips: bucket('hip'),
    valleys: bucket('valley'),
    eaves: bucket('eave'),
    rakes: bucket('rake'),
    metadata: {
      roofType: result?.roof?.type,
      qualityScore: result?.roof?.confidence != null ? Math.round(result.roof.confidence * 100) : undefined,
      totalAreaSqft: result?.measurements?.area_sqft,
      perimeterSource: 'internal_unet',
      pitch: result?.measurements?.predominant_pitch != null
        ? `${result.measurements.predominant_pitch}/12`
        : undefined,
    },
  };
}
