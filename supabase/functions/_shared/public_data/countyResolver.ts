// supabase/functions/_shared/public_data/countyResolver.ts
// County resolution: FCC Area API (fast) → Census TIGER (fallback)

import { CountyContext } from "./types.ts";
import { fccArea, normalizeCountyName } from "../geo/fccArea.ts";

/**
 * Resolve county from lat/lng.
 * Tries FCC Census Area API first (faster, no key needed).
 * Falls back to Census TIGER geocoder if FCC fails.
 */
export async function getCountyContext(input: {
  lat: number;
  lng: number;
  state: string;
  county_hint?: string;
  timeoutMs: number;
}): Promise<CountyContext> {
  const { lat, lng, state, county_hint, timeoutMs } = input;

  // --- Try FCC first (faster) ---
  try {
    const fcc = await fccArea(lat, lng, Math.min(timeoutMs, 6000));
    if (fcc.countyName) {
      console.log(`[countyResolver] FCC resolved: ${fcc.countyName} (${fcc.stateCode})`);
      return {
        state: fcc.stateCode || state,
        county_name: normalizeCountyName(fcc.countyName),
        county_fips: fcc.countyFips,
      };
    }
  } catch (e) {
    console.warn("[countyResolver] FCC error, falling back to TIGER:", e);
  }

  // --- Fallback: Census TIGER ---
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
        const rawName = county.BASENAME || county.NAME || county_hint || "Unknown";
        return {
          state: stateGeo?.STUSAB || state,
          county_name: normalizeCountyName(rawName),
          county_fips: county.GEOID || `${county.STATE}${county.COUNTY}`,
        };
      }
    }
  } catch (e) {
    console.error("[countyResolver] TIGER error:", e);
  }

  // Fallback to hint
  return {
    state,
    county_name: normalizeCountyName(county_hint),
  };
}
