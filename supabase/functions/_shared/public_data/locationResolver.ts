// supabase/functions/_shared/public_data/locationResolver.ts

import { NormalizedLocation } from "./types.ts";
import { normalizeAddressKey } from "./normalize.ts";

export async function resolveLocation(input: {
  lat?: number;
  lng?: number;
  address?: string;
  timeoutMs: number;
}): Promise<NormalizedLocation> {
  const { lat, lng, address, timeoutMs } = input;

  // PRIORITY: When an explicit address is provided, use it as the primary source
  // for parcel identity. lat/lng is only used as context fallback.
  // This prevents coordinate drift (e.g. pin at 4063 resolving to neighbor 4083).
  if (address) {
    try {
      const geo = await nominatimSearch(address, timeoutMs);
      const state = (geo.address?.state_code || geo.address?.state || "").toUpperCase().slice(0, 2) || "";
      const normalized = geo.display_name || address;
      const street = [geo.address?.house_number, geo.address?.road].filter(Boolean).join(" ");
      const city = geo.address?.city || geo.address?.town || geo.address?.village || "";
      const zip = geo.address?.postcode || "";
      const county_hint = geo.address?.county?.replace(/ County$/i, "") || undefined;
      const key = normalizeAddressKey(street || normalized);

      return {
        lat: parseFloat(geo.lat) || lat || 0,
        lng: parseFloat(geo.lon) || lng || 0,
        state,
        normalized_address: normalized,
        street,
        city,
        zip,
        county_hint,
        normalized_address_key: key,
      };
    } catch (e) {
      console.warn(`[resolveLocation] Address search failed for "${address}", falling back to lat/lng:`, e);
      // Fall through to lat/lng if address search fails
    }
  }

  if (lat && lng) {
    const rev = await nominatimReverse(lat, lng, timeoutMs);
    const state = (rev.address?.state_code || rev.address?.state || "").toUpperCase().slice(0, 2) || "";
    const normalized = rev.display_name || address || `${lat}, ${lng}`;
    const street = [rev.address?.house_number, rev.address?.road].filter(Boolean).join(" ");
    const city = rev.address?.city || rev.address?.town || rev.address?.village || "";
    const zip = rev.address?.postcode || "";
    const county_hint = rev.address?.county?.replace(/ County$/i, "") || undefined;
    const key = normalizeAddressKey(street || normalized);

    return { lat, lng, state, normalized_address: normalized, street, city, zip, county_hint, normalized_address_key: key };
  }

  throw new Error("resolveLocation: provide lat/lng or address");
}

async function nominatimReverse(lat: number, lng: number, timeoutMs: number) {
  const u = new URL("https://nominatim.openstreetmap.org/reverse");
  u.searchParams.set("format", "json");
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lon", String(lng));
  u.searchParams.set("addressdetails", "1");
  return await fetchJson(u.toString(), timeoutMs);
}

async function nominatimSearch(q: string, timeoutMs: number) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("format", "json");
  u.searchParams.set("q", q);
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("limit", "1");
  const arr = await fetchJson(u.toString(), timeoutMs);
  if (!Array.isArray(arr) || !arr[0]) throw new Error("Nominatim search returned no results");
  return arr[0];
}

async function fetchJson(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "PitchCRM/StormCanvass" }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}
