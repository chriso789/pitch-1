// supabase/functions/_shared/public_data/overpass.ts

export async function fetchOverpassAddressesInPolygon(geojson: any, timeoutMs: number) {
  const poly = toOverpassPolyString(geojson);

  const query = `
    [out:json][timeout:25];
    (
      n["addr:housenumber"](poly:"${poly}");
      w["addr:housenumber"](poly:"${poly}");
      r["addr:housenumber"](poly:"${poly}");
      n["building"]["addr:housenumber"](poly:"${poly}");
      w["building"]["addr:housenumber"](poly:"${poly}");
      r["building"]["addr:housenumber"](poly:"${poly}");
    );
    out center tags;
  `;

  const res = await fetchText("https://overpass-api.de/api/interpreter", timeoutMs, query);
  const json = JSON.parse(res);

  const out: Array<{ lat: number; lng: number; house_number?: string; road?: string; formatted?: string }> = [];

  for (const el of (json.elements ?? [])) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!lat || !lng) continue;

    const tags = el.tags ?? {};
    const hn = tags["addr:housenumber"];
    const rd = tags["addr:street"];
    const city = tags["addr:city"];
    const state = tags["addr:state"];
    const zip = tags["addr:postcode"];

    const formatted = [hn, rd, city, state, zip].filter(Boolean).join(" ").trim();
    out.push({ lat, lng, house_number: hn, road: rd, formatted: formatted || undefined });
  }

  return out;
}

function toOverpassPolyString(geojson: any): string {
  const g = geojson?.type === "Feature" ? geojson.geometry : geojson;
  const coords = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
  if (!coords) throw new Error("Unsupported polygon for overpass");
  return coords.map(([lng, lat]: number[]) => `${lat} ${lng}`).join(" ");
}

async function fetchText(url: string, timeoutMs: number, body: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "PitchCRM/StormCanvass" },
      body: `data=${encodeURIComponent(body)}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}
