// supabase/functions/noaa-storm-reports/index.ts
// Fetches storm reports from IEM Local Storm Reports + NWS Alerts
// Free, no API key required

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }

const STORM_TYPES = ["HAIL", "TSTM WND", "TORNADO", "THUNDERSTORM WIND", "MARINE TSTM"];

/** Get the WFO (Weather Forecast Office) code for a lat/lng from NWS API */
async function getWFO(lat: number, lng: number): Promise<string[]> {
  try {
    const res = await fetch(`https://api.weather.gov/points/${lat},${lng}`, {
      headers: { "User-Agent": "PitchCRM/1.0 (support@pitchcrm.com)" },
    });
    if (!res.ok) { await res.text(); return []; }
    const json = await res.json();
    const cwa = json?.properties?.cwa; // e.g. "FWD"
    if (cwa) return [cwa];
    return [];
  } catch (e) {
    console.warn("[storm] WFO lookup failed:", e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { lat, lng, radius_miles = 15, years_back = 3 } = await req.json();
    if (!lat || !lng) {
      return new Response(JSON.stringify({ error: "lat and lng required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years_back);
    const allReports: StormReport[] = [];

    // Step 1: Get WFO code for location-filtered IEM queries
    const wfos = await getWFO(lat, lng);
    const wfoParam = wfos.length > 0 ? wfos.join(",") : "";
    console.log(`[storm] WFO for ${lat},${lng}: ${wfoParam || "(none, using all)"}`);

    // ---- IEM Local Storm Reports ----
    // With WFO filter, responses are much smaller so we can use larger time windows
    try {
      const chunks: { sts: string; ets: string }[] = [];
      const c = new Date(startDate);
      // Chunk by 1 year if WFO filtered, 3 months otherwise
      const monthsPerChunk = wfoParam ? 12 : 3;
      while (c < endDate) {
        const ce = new Date(c);
        ce.setMonth(ce.getMonth() + monthsPerChunk);
        if (ce > endDate) ce.setTime(endDate.getTime());
        chunks.push({ sts: `${fmtDate(c)}T00:00`, ets: `${fmtDate(ce)}T23:59` });
        c.setTime(ce.getTime() + 86400000);
      }

      const results = await Promise.allSettled(chunks.map(async (chunk) => {
        const url = `https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=${chunk.sts}&ets=${chunk.ets}&wfos=${wfoParam}`;
        console.log(`[storm] IEM: ${url}`);
        const res = await fetch(url);
        if (!res.ok) { await res.text(); return []; }
        const gj = await res.json();
        const rpts: StormReport[] = [];
        for (const f of (gj?.features || [])) {
          const p = f.properties || {};
          const [rLng, rLat] = f.geometry?.coordinates || [0, 0];
          const type = (p.typetext || "").toUpperCase();
          if (!STORM_TYPES.some(t => type.includes(t))) continue;
          const dist = haversine(lat, lng, rLat, rLng);
          if (dist > radius_miles) continue;
          rpts.push({
            date: p.valid || "",
            event_type: p.typetext || "Storm",
            magnitude: p.magnitude != null ? `${p.magnitude} ${p.unit || ""}`.trim() : "",
            description: p.remark || "",
            location: [p.city, p.county, p.state].filter(Boolean).join(", "),
            lat: rLat, lng: rLng, source: "IEM/NWS LSR",
            distance_miles: Math.round(dist * 10) / 10,
          });
        }
        console.log(`[storm] IEM chunk ${chunk.sts}: ${rpts.length} hits from ${gj?.features?.length || 0} features`);
        return rpts;
      }));
      for (const r of results) {
        if (r.status === "fulfilled") allReports.push(...r.value);
      }
      console.log(`[storm] IEM total: ${allReports.length}`);
    } catch (e) {
      console.warn("[storm] IEM error:", e);
    }

    // ---- NWS Alerts (active) ----
    try {
      const res = await fetch(`https://api.weather.gov/alerts?point=${lat},${lng}&status=actual&limit=10`, {
        headers: { "User-Agent": "PitchCRM/1.0 (support@pitchcrm.com)" },
      });
      if (res.ok) {
        const json = await res.json();
        for (const f of (json?.features || [])) {
          const p = f.properties;
          const evt = (p?.event || "").toLowerCase();
          if (["storm", "hail", "tornado", "wind"].some(k => evt.includes(k))) {
            allReports.push({
              date: p.onset || p.effective || "",
              event_type: p.event, magnitude: p.severity || "",
              description: (p.headline || "").slice(0, 300),
              location: p.areaDesc || "",
              lat, lng, source: "NWS Alert", distance_miles: 0,
            });
          }
        }
      } else { await res.text(); }
    } catch (e) {
      console.warn("[storm] NWS error:", e);
    }

    // Deduplicate
    const deduped: StormReport[] = [];
    for (const r of allReports) {
      if (!deduped.some(ex =>
        ex.event_type === r.event_type &&
        ex.date.slice(0, 10) === r.date.slice(0, 10) &&
        haversine(ex.lat, ex.lng, r.lat, r.lng) < 1
      )) deduped.push(r);
    }

    deduped.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    console.log(`[storm] final: ${deduped.length} (${allReports.length} raw) within ${radius_miles}mi`);

    return new Response(JSON.stringify({
      success: true, reports: deduped, count: deduped.length,
      search: { lat, lng, radius_miles, years_back },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[storm] error:", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
