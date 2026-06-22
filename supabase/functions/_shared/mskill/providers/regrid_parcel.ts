import {
  enrichCandidateWithTarget,
  featuresFromGeoJson,
  type EvidenceCandidate,
  type GeoJsonGeometry,
} from "../evidence-source.ts";

export interface RegridParcelLookupArgs {
  lat: number;
  lon: number;
  url_template?: string | null;
  confidence?: number | null;
}

export interface RegridParcelLookupResult {
  candidates: EvidenceCandidate[];
  attempted_url: string | null;
  skipped_reason?: string | null;
  error?: string | null;
}

export async function lookupRegridParcel(args: RegridParcelLookupArgs): Promise<RegridParcelLookupResult> {
  const serviceToken = Deno.env.get("REGRID_API_KEY") ?? "";
  const template = String(args.url_template ?? Deno.env.get("REGRID_PARCEL_LOOKUP_URL_TEMPLATE") ?? "").trim();
  if (!serviceToken) {
    return { candidates: [], attempted_url: null, skipped_reason: "regrid_api_key_not_configured" };
  }
  if (!template) {
    return { candidates: [], attempted_url: null, skipped_reason: "regrid_lookup_url_template_not_configured" };
  }

  const url = expandTemplate(template, {
    lat: args.lat,
    lon: args.lon,
    lng: args.lon,
    token: serviceToken,
  });

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/geo+json, application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { candidates: [], attempted_url: safeUrl(url), error: `http_${res.status}` };

    const body = await res.json();
    const features = featuresFromGeoJson(body);
    const candidates = features
      .filter((f) => f.geometry)
      .map((f) => {
        const props = (f.properties ?? {}) as Record<string, unknown>;
        return enrichCandidateWithTarget({
          evidence_kind: "parcel",
          provider_key: "regrid_parcel",
          geometry_geojson: f.geometry as GeoJsonGeometry,
          source_url: safeUrl(url),
          external_id: String(props.ll_uuid ?? props.parcelnumb ?? props.id ?? f.id ?? ""),
          confidence: Number(args.confidence ?? 0.84),
          metadata: {
            provider_family: "regrid_parcel_point_lookup",
            situs_address: props.situs_address ?? props.address ?? null,
            owner_name: props.owner ?? props.owner_name ?? null,
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
    return "configured_regrid_lookup";
  }
}
