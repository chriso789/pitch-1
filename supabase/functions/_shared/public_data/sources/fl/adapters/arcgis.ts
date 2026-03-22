// supabase/functions/_shared/public_data/sources/fl/adapters/arcgis.ts

import { ArcGISCountyConfig, CountyLookupInput, CountyLookupResult } from "../types.ts";

/**
 * Generic ArcGIS REST adapter. Works with any county that exposes
 * a MapServer or FeatureServer with query support.
 */
export async function arcgisLookup(
  config: ArcGISCountyConfig,
  input: CountyLookupInput,
): Promise<CountyLookupResult> {
  const { serviceUrl, searchField, outFields, fieldMap, transforms, id } = config;

  // Street suffix abbreviation map
  const SUFFIX_MAP: Record<string, string> = {
    DRIVE: "DR", STREET: "ST", AVENUE: "AVE", BOULEVARD: "BLVD",
    LANE: "LN", COURT: "CT", CIRCLE: "CIR", PLACE: "PL",
    TERRACE: "TER", ROAD: "RD", TRAIL: "TRL", PARKWAY: "PKWY",
    HIGHWAY: "HWY", EXPRESSWAY: "EXPY",
  };

  // Normalize address for LIKE search: strip unit/apt, uppercase, abbreviate suffixes
  const addr = input.address
    .toUpperCase()
    .replace(/[#,]/g, "")
    .replace(/\s+(APT|UNIT|STE|SUITE|LOT|BLDG)\s+.*/i, "")
    .trim()
    .replace(/\b(DRIVE|STREET|AVENUE|BOULEVARD|LANE|COURT|CIRCLE|PLACE|TERRACE|ROAD|TRAIL|PARKWAY|HIGHWAY|EXPRESSWAY)\b/g,
      (match) => SUFFIX_MAP[match] || match);

  // Build query URL
  const where = `${searchField} LIKE '%${addr}%'`;
  const params = new URLSearchParams({
    where,
    outFields,
    f: "json",
    resultRecordCount: "3",
    returnGeometry: "false",
  });

  const url = `${serviceUrl}/query?${params.toString()}`;
  console.log(`[${id}] querying: ${url.slice(0, 200)}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`[${id}] HTTP ${res.status}`);
      return emptyResult(id, { http_status: res.status });
    }

    const data = await res.json();
    const features = data?.features;

    if (!features || features.length === 0) {
      console.log(`[${id}] no features returned`);
      return emptyResult(id, { query: where, message: "no features" });
    }

    // Extract house number from input address for matching
    const inputHouseNum = addr.match(/^\d+/)?.[0] ?? "";

    // Score each feature to pick the best match instead of blindly using [0]
    const scored = features.map((f: any) => {
      const fAddr = String(f.attributes[searchField] ?? "").toUpperCase().trim();
      const fHouseNum = fAddr.match(/^\d+/)?.[0] ?? "";
      let score = 0;

      // Exact house number match is highest priority
      if (inputHouseNum && fHouseNum === inputHouseNum) score += 100;
      // Partial street name overlap
      if (fAddr.includes(addr.replace(/^\d+\s*/, ""))) score += 50;
      // Penalize if house number exists but doesn't match
      if (inputHouseNum && fHouseNum && fHouseNum !== inputHouseNum) score -= 80;

      return { feature: f, score, fAddr };
    });

    scored.sort((a: any, b: any) => b.score - a.score);
    const best = scored[0];

    if (best.score <= 0 && inputHouseNum) {
      console.warn(`[${id}] no feature matched house number "${inputHouseNum}". Best: "${best.fAddr}"`);
    }

    const attrs = best.feature.attributes;
    const result = mapFields(attrs, fieldMap, transforms);
    const exactMatch = best.score >= 100;

    console.log(`[${id}] found owner: ${result.owner_name ?? "unknown"} (score: ${best.score}, exact: ${exactMatch})`);

    return {
      ...result,
      source: id,
      confidence_score: exactMatch ? 85 : result.owner_name ? 55 : 30,
      raw: attrs,
    };
  } catch (e) {
    clearTimeout(timeout);
    console.error(`[${id}] error:`, e);
    return emptyResult(id, { error: String(e) });
  }
}

function mapFields(
  attrs: Record<string, unknown>,
  fieldMap: Record<string, string>,
  transforms?: Record<string, (val: unknown) => unknown>,
): Partial<CountyLookupResult> {
  const result: Record<string, unknown> = {};

  for (const [arcField, ourField] of Object.entries(fieldMap)) {
    let val = attrs[arcField];
    if (val === null || val === undefined || val === "") continue;

    // Apply transform if defined
    if (transforms?.[ourField]) {
      val = transforms[ourField](val);
    }

    result[ourField] = val;
  }

  return result as Partial<CountyLookupResult>;
}

function emptyResult(source: string, raw: Record<string, unknown>): CountyLookupResult {
  return { source, confidence_score: 0, raw };
}
