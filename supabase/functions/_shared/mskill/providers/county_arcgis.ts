import {
  enrichCandidateWithTarget,
  featuresFromGeoJson,
  type EvidenceCandidate,
  type GeoJsonGeometry,
} from "../evidence-source.ts";

export interface ProviderRow {
  provider_key: string;
  display_name?: string | null;
  category?: string | null;
  scope?: string | null;
  base_url?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ArcGisLookupArgs {
  provider: ProviderRow;
  lat: number;
  lon: number;
  evidence_kind: "parcel" | "building_footprint";
  radius_m?: number;
}

export interface ArcGisLookupResult {
  candidates: EvidenceCandidate[];
  attempted_url: string | null;
  error?: string | null;
  skipped_reason?: string | null;
}

export async function queryArcGisPointLayer(args: ArcGisLookupArgs): Promise<ArcGisLookupResult> {
  const metadata = (args.provider.metadata ?? {}) as Record<string, unknown>;
  const queryUrl = String(metadata.query_url ?? args.provider.base_url ?? "").trim();
  if (!queryUrl) {
    return {
      candidates: [],
      attempted_url: null,
      skipped_reason: "provider_missing_query_url",
    };
  }

  const url = buildArcGisQueryUrl(queryUrl, args.lon, args.lat, args.radius_m ?? 120, metadata);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(Number(metadata.timeout_ms ?? 10_000)),
    });
    if (!res.ok) {
      return { candidates: [], attempted_url: scrubUrl(url), error: `http_${res.status}` };
    }
    const body = await res.json();
    const features = featuresFromGeoJson(body);
    const baseConfidence = Number(metadata.base_confidence ?? (args.evidence_kind === "parcel" ? 0.86 : 0.92));
    const idField = String(metadata.external_id_field ?? metadata.object_id_field ?? "OBJECTID");

    const candidates = features
      .filter((f) => f.geometry)
      .map((f) => {
        const props = (f.properties ?? {}) as Record<string, unknown>;
        return enrichCandidateWithTarget({
          evidence_kind: args.evidence_kind,
          provider_key: args.provider.provider_key,
          geometry_geojson: f.geometry as GeoJsonGeometry,
          source_url: scrubUrl(url),
          external_id: String(props[idField] ?? f.id ?? ""),
          confidence: baseConfidence,
          metadata: {
            provider_name: args.provider.display_name ?? null,
            provider_family: "arcgis_feature_service",
            raw_properties: props,
          },
        }, { lat: args.lat, lon: args.lon });
      });

    return { candidates, attempted_url: scrubUrl(url) };
  } catch (err) {
    return {
      candidates: [],
      attempted_url: scrubUrl(url),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildArcGisQueryUrl(
  baseUrl: string,
  lon: number,
  lat: number,
  radiusM: number,
  metadata: Record<string, unknown>,
): string {
  const queryEndpoint = baseUrl.includes("/query") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/query`;
  const url = new URL(queryEndpoint);
  url.searchParams.set("f", String(metadata.response_format ?? "geojson"));
  url.searchParams.set("where", String(metadata.where ?? "1=1"));
  url.searchParams.set("outFields", String(metadata.out_fields ?? "*"));
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("geometry", `${lon},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("distance", String(radiusM));
  url.searchParams.set("units", "esriSRUnit_Meter");
  return url.toString();
}

function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["token", "key", "api_key", "apikey"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "REDACTED");
    }
    return u.toString();
  } catch {
    return url;
  }
}
