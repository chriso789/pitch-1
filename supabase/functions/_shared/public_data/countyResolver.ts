// supabase/functions/_shared/public_data/countyResolver.ts

import { CountyContext } from "./types.ts";

/**
 * Resolve county from lat/lng using Census TIGER geocoder.
 * Falls back to county_hint from Nominatim if TIGER fails.
 */
export async function getCountyContext(input: {
  lat: number;
  lng: number;
  state: string;
  county_hint?: string;
  timeoutMs: number;
}): Promise<CountyContext> {
  const { lat, lng, state, county_hint, timeoutMs } = input;

  try {
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), Math.min(timeoutMs, 8000));

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);

    if (res.ok) {
      const data = await res.json();
      const geographies = data?.result?.geographies;
      const county = geographies?.Counties?.[0];
      const stateGeo = geographies?.States?.[0];

      if (county) {
        return {
          state: stateGeo?.STUSAB || state,
          county_name: county.BASENAME || county.NAME || county_hint || "Unknown",
          county_fips: county.GEOID || `${county.STATE}${county.COUNTY}`,
        };
      }
    }
  } catch (e) {
    console.error("[countyResolver] TIGER error:", e);
  }

  // Fallback to Nominatim hint
  return {
    state,
    county_name: county_hint || "Unknown",
  };
}
