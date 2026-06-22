// Hardened Google Solar API client.
// Never silently falls through. Always returns a status discriminator so
// the orchestrator can record `solar_api_unavailable` in evidence_acquisition_log
// rather than letting downstream code think Solar was simply "missing data."

export type SolarStatus =
  | "ok"
  | "no_data"            // 404 — coverage gap, valid signal
  | "unauthorized"        // 403 — billing / referrer / IP restriction
  | "quota_exceeded"      // 429
  | "missing_key"
  | "network_error"
  | "server_error";

export interface SolarBuildingInsights {
  status: SolarStatus;
  http_status?: number;
  data?: any;
  error?: string;
  latency_ms: number;
}

const SOLAR_BASE = "https://solar.googleapis.com/v1";

export async function fetchBuildingInsights(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SolarBuildingInsights> {
  const key = Deno.env.get("GOOGLE_SOLAR_API_KEY") ?? Deno.env.get("GOOGLE_MAPS_API_KEY");
  const started = performance.now();
  if (!key) {
    return { status: "missing_key", latency_ms: 0, error: "GOOGLE_SOLAR_API_KEY not configured" };
  }
  const url = `${SOLAR_BASE}/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${key}`;
  try {
    const resp = await fetchImpl(url);
    const latency_ms = Math.round(performance.now() - started);
    if (resp.status === 200) {
      const data = await resp.json();
      return { status: "ok", http_status: 200, data, latency_ms };
    }
    if (resp.status === 404) return { status: "no_data", http_status: 404, latency_ms };
    if (resp.status === 403) {
      const text = await resp.text().catch(() => "");
      return { status: "unauthorized", http_status: 403, error: text.slice(0, 500), latency_ms };
    }
    if (resp.status === 429) return { status: "quota_exceeded", http_status: 429, latency_ms };
    const text = await resp.text().catch(() => "");
    return { status: "server_error", http_status: resp.status, error: text.slice(0, 500), latency_ms };
  } catch (e) {
    return {
      status: "network_error",
      latency_ms: Math.round(performance.now() - started),
      error: (e as Error).message,
    };
  }
}
