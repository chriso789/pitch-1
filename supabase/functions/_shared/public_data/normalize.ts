// supabase/functions/_shared/public_data/normalize.ts

/**
 * Unified address key normalizer.
 * Produces keys like "4063_fonsica_ave" — all flows MUST use this.
 */
export function normalizeAddressKey(streetOrFormatted: string): string {
  return streetOrFormatted
    .toLowerCase()
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(court)\b/g, "ct")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(circle)\b/g, "cir")
    .replace(/\b(parkway)\b/g, "pkwy")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(place)\b/g, "pl")
    .replace(/\b(terrace)\b/g, "ter")
    .replace(/\b(highway)\b/g, "hwy")
    .replace(/\b(north)\b/g, "n")
    .replace(/\b(south)\b/g, "s")
    .replace(/\b(east)\b/g, "e")
    .replace(/\b(west)\b/g, "w")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "_");
}

/**
 * Normalize from separate street_number + street_name (used by canvassiq-load-parcels).
 * Delegates to the canonical normalizeAddressKey.
 */
export function normalizeAddressKeyFromParts(streetNumber: string, streetName: string): string {
  return normalizeAddressKey(`${streetNumber} ${streetName}`);
}
