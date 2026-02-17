// supabase/functions/noaa-storm-reports/index.ts
// Fetches storm reports from NOAA SWDI (Severe Weather Data Inventory) API
// Free, no API key required. Returns hail, wind, tornado reports near a lat/lng.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SWDI_BASE = "https://www.ncdc.noaa.gov/swdiws/json";

interface StormReport {
  date: string;
  event_type: string;
  magnitude: string;
  description: string;
  location: string;
  lat: number;
  lng: number;
  source: string;
  distance_miles?: number;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { lat, lng, radius_miles = 15, years_back = 3 } = await req.json();

    if (!lat || !lng) {
      return new Response(JSON.stringify({ error: "lat and lng are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years_back);

    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const dateRange = `${fmt(startDate)}:${fmt(endDate)}`;

    // SWDI datasets: plsr (Preliminary Local Storm Reports), nx3hail (NEXRAD hail signatures)
    const datasets = ["plsr", "nx3hail"];
    const allReports: StormReport[] = [];

    for (const dataset of datasets) {
      const url = `${SWDI_BASE}/${dataset}/${dateRange}?stat=tilesum:${lng},${lat}&limit=100`;
      console.log(`[noaa-storm] fetching: ${url}`);

      try {
        const res = await fetch(url);
        if (!res.ok) {
          const text = await res.text();
          console.warn(`[noaa-storm] ${dataset} failed [${res.status}]: ${text.slice(0, 200)}`);
          continue;
        }

        const json = await res.json();
        const results = json?.result ?? [];

        for (const r of results) {
          if (dataset === "plsr") {
            const rLat = parseFloat(r.LAT || r.lat || "0");
            const rLng = parseFloat(r.LON || r.lon || "0");
            const dist = haversineDistance(lat, lng, rLat, rLng);
            if (dist > radius_miles) continue;

            allReports.push({
              date: r.VALID || r.EVENT_BEGIN || "",
              event_type: r.EVENT || r.event_type || "Unknown",
              magnitude: r.MAG || r.MAGNITUDE || "",
              description: r.REMARKS || r.DESCRIPTION || "",
              location: r.CITY || r.LOCATION || "",
              lat: rLat,
              lng: rLng,
              source: "NOAA PLSR",
              distance_miles: Math.round(dist * 10) / 10,
            });
          } else if (dataset === "nx3hail") {
            const rLat = parseFloat(r.LAT || r.WSR_LAT || "0");
            const rLng = parseFloat(r.LON || r.WSR_LON || "0");
            const dist = haversineDistance(lat, lng, rLat, rLng);
            if (dist > radius_miles) continue;

            allReports.push({
              date: r.ZTIME || r.VALID || "",
              event_type: "Hail (Radar)",
              magnitude: r.MAXSIZE ? `${r.MAXSIZE}"` : "",
              description: `NEXRAD hail signature, max size: ${r.MAXSIZE || "unknown"}`,
              location: "",
              lat: rLat,
              lng: rLng,
              source: "NOAA NEXRAD",
              distance_miles: Math.round(dist * 10) / 10,
            });
          }
        }
      } catch (e) {
        console.warn(`[noaa-storm] error fetching ${dataset}:`, e);
      }
    }

    // Also try NWS alerts API for recent/active alerts
    try {
      const alertsUrl = `https://api.weather.gov/alerts?point=${lat},${lng}&status=actual&limit=10`;
      const alertRes = await fetch(alertsUrl, {
        headers: { "User-Agent": "PitchCRM/1.0 (support@pitchcrm.com)" },
      });
      if (alertRes.ok) {
        const alertJson = await alertRes.json();
        for (const feature of (alertJson?.features || [])) {
          const props = feature.properties;
          if (props?.event?.toLowerCase().includes("storm") ||
              props?.event?.toLowerCase().includes("hail") ||
              props?.event?.toLowerCase().includes("tornado") ||
              props?.event?.toLowerCase().includes("wind")) {
            allReports.push({
              date: props.onset || props.effective || "",
              event_type: props.event || "Weather Alert",
              magnitude: props.severity || "",
              description: (props.headline || props.description || "").slice(0, 300),
              location: props.areaDesc || "",
              lat,
              lng,
              source: "NWS Alert",
              distance_miles: 0,
            });
          }
        }
      }
    } catch (e) {
      console.warn("[noaa-storm] NWS alerts error:", e);
    }

    // Sort by date descending
    allReports.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    console.log(`[noaa-storm] found ${allReports.length} reports within ${radius_miles}mi of ${lat},${lng}`);

    return new Response(JSON.stringify({
      success: true,
      reports: allReports,
      count: allReports.length,
      search: { lat, lng, radius_miles, years_back },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[noaa-storm] error:", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
