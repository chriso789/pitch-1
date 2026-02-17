// supabase/functions/_shared/geo/fccArea.ts
// FCC Census Area API — fast, free, no API key needed

export type GeoArea = {
  stateCode?: string;   // "FL"
  countyName?: string;  // "Hillsborough County"
  countyFips?: string;  // "12057"
  stateFips?: string;   // "12"
};

/**
 * Resolve state + county from lat/lng using FCC Census Area API.
 * Faster and more reliable than Census TIGER geocoder.
 */
export async function fccArea(
  lat: number,
  lon: number,
  timeoutMs = 8000,
): Promise<GeoArea> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const url = `https://geo.fcc.gov/api/census/area?format=json&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`FCC area lookup failed: ${res.status}`);
    const json = await res.json();

    const result = json?.results?.[0];
    return {
      stateCode: result?.state_code,
      countyName: result?.county_name,
      countyFips: result?.county_fips,
      stateFips: result?.state_fips,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Normalize county name for registry lookup:
 * "Hillsborough County" → "hillsborough"
 */
export function normalizeCountyName(name?: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/ county$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
