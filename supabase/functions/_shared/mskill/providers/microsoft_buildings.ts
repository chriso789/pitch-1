import {
  enrichCandidateWithTarget,
  featuresFromGeoJson,
  type EvidenceCandidate,
  type GeoJsonGeometry,
} from "../evidence-source.ts";
import type { ProviderRow } from "./county_arcgis.ts";

export const MICROSOFT_BUILDINGS_PROVIDER_ADAPTER_VERSION = "vendor-free-ms-buildings-v1";

export interface MicrosoftBuildingsLookupArgs {
  provider?: ProviderRow | null;
  lat: number;
  lon: number;
  state?: string | null;
  county?: string | null;
  radius_m?: number;
}

export interface MicrosoftBuildingsLookupResult {
  candidates: EvidenceCandidate[];
  attempted_url: string | null;
  skipped_reason?: string | null;
  error?: string | null;
}

export async function lookupMicrosoftBuildings(
  args: MicrosoftBuildingsLookupArgs,
): Promise<MicrosoftBuildingsLookupResult> {
  const metadata = (args.provider?.metadata ?? {}) as Record<string, unknown>;
  const template = String(metadata.lookup_url_template ?? "").trim();
  if (!template) {
    return {
      candidates: [],
      attempted_url: null,
      skipped_reason: "microsoft_buildings_lookup_url_not_configured",
    };
  }

  const url = expandTemplate(template, {
    lat: args.lat,
    lon: args.lon,
    lng: args.lon,
    state: args.state ?? "",
    county: args.county ?? "",
    radius_m: args.radius_m ?? 120,
  });

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/geo+json, application/json" },
      signal: AbortSignal.timeout(Number(metadata.timeout_ms ?? 10_000)),
    });
    if (!res.ok) return { candidates: [], attempted_url: safeUrl(url), error: `http_${res.status}` };

    const body = await res.json();
    const features = featuresFromGeoJson(body);
    const baseConfidence = Number(metadata.base_confidence ?? 0.90);
    const idField = String(metadata.external_id_field ?? "id");
    const candidates = features
      .filter((f) => f.geometry)
      .map((f) => {
        const props = (f.properties ?? {}) as Record<string, unknown>;
        return enrichCandidateWithTarget({
          evidence_kind: "building_footprint",
          provider_key: args.provider?.provider_key ?? "microsoft_buildings",
          geometry_geojson: f.geometry as GeoJsonGeometry,
          source_url: safeUrl(url),
          external_id: String(props[idField] ?? f.id ?? ""),
          confidence: baseConfidence,
          metadata: {
            provider_family: "microsoft_us_building_footprints_index",
            source_dataset: "microsoft_us_building_footprints",
            raw_properties: props,
          },
        }, { lat: args.lat, lon: args.lon });
      });

    return { candidates, attempted_url: safeUrl(url) };
  } catch (err) {
    return {
      candidates: [],
      attempted_url: safeUrl(url),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function expandTemplate(template: string, values: Record<string, string | number>): string {
  let out = template;
  for (const [name, value] of Object.entries(values)) {
    out = out.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
  }
  return out;
}

function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    return u.toString();
  } catch {
    return "configured_microsoft_buildings_lookup";
  }
}
