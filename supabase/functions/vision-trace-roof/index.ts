// Vision-prior roof tracer.
//
// Purpose: give the UI a fast, "looks-right" outline of the confirmed roof
// even when the georeferenced measurement pipeline blocks. This is a VISION
// PRIOR — pixel coordinates on the aerial tile, NOT a georeferenced,
// customer-ready measurement. It is safe to render as an overlay for the
// developer test surface and blocked reports.
//
// Input:  { lat, lng, zoom?, size?, image_url?, address? }
// Output: {
//   image: { url, width, height, zoom, source },
//   segments: [{ type: 'eave'|'rake'|'ridge'|'hip'|'valley', points: [[x,y], ...] }],
//   raw: <model text>,
//   model, durationMs
// }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";

const MODEL = "google/gemini-3.1-pro-preview";

type Segment = {
  type: "eave" | "rake" | "ridge" | "hip" | "valley";
  points: Array<[number, number]>;
  confidence?: number;
};

const SYSTEM_PROMPT = `You are a roofing measurement vision assistant. You look at
an aerial (top-down satellite) image of a single house and trace the roof edges
of the CENTER house only. Ignore neighboring houses, trees, driveways, pools,
patios, sidewalks and vehicles.

You must return polyline coordinates in image pixel space (origin top-left,
+x right, +y down). Coordinates are in the SAME pixel space as the image you
were given. All coordinates must be inside the image bounds.

You must classify every polyline as exactly one of:
- "eave"   : horizontal exterior roof edge along a gutter line (bottom of a slope)
- "rake"   : sloped exterior roof edge along a gable end
- "ridge"  : level horizontal peak where two upslope planes meet
- "hip"    : diagonal edge from a ridge endpoint down to an eave corner
- "valley" : interior V-shaped edge where two roof planes meet inward

Return STRICT JSON only, no prose, no markdown fences:

{
  "segments": [
    { "type": "eave",  "points": [[x1,y1],[x2,y2], ...], "confidence": 0.0-1.0 },
    ...
  ]
}

Rules:
- Trace the FULL perimeter (all eaves + rakes) as a closed loop of connected segments.
- Trace every visible ridge, hip and valley.
- Each polyline is a straight run of the same type — break at corners/junctions.
- Prefer 2-point straight segments; use more points only when the edge curves.
- Do NOT invent structure you cannot see.
- Do NOT include any segment that lies outside the target house.`;

function buildStaticMapsUrl(lat: number, lng: number, zoom: number, size: number): string {
  const s = Math.min(640, size);
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}` +
    `&zoom=${zoom}&size=${s}x${s}&scale=2&maptype=satellite&key=${GOOGLE_MAPS_API_KEY}`;
}

async function fetchImageAsDataUrl(url: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image_fetch_failed status=${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/png";
  // base64 encode
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as any);
  }
  const b64 = btoa(binary);
  // We can't cheaply decode PNG dimensions here; caller sets expected size.
  return { dataUrl: `data:${mime};base64,${b64}`, width: 0, height: 0 };
}

function parseSegments(text: string): Segment[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  let parsed: any;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    // try to extract first {...} block
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { parsed = JSON.parse(m[0]); } catch { return []; }
  }
  const segs = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const allowed = new Set(["eave", "rake", "ridge", "hip", "valley"]);
  const out: Segment[] = [];
  for (const s of segs) {
    if (!allowed.has(s?.type)) continue;
    const pts = Array.isArray(s?.points) ? s.points : [];
    const norm: Array<[number, number]> = [];
    for (const p of pts) {
      if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        norm.push([Number(p[0]), Number(p[1])]);
      }
    }
    if (norm.length >= 2) {
      out.push({
        type: s.type,
        points: norm,
        confidence: Number.isFinite(s?.confidence) ? Number(s.confidence) : undefined,
      });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "missing_lovable_api_key" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    const zoom = Number.isFinite(Number(body?.zoom)) ? Number(body.zoom) : 20;
    const size = Number.isFinite(Number(body?.size)) ? Number(body.size) : 640;
    let imageUrl: string | undefined = typeof body?.image_url === "string" ? body.image_url : undefined;

    if (!imageUrl) {
      if (!GOOGLE_MAPS_API_KEY) {
        return new Response(JSON.stringify({ error: "missing_google_maps_api_key" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return new Response(JSON.stringify({ error: "missing_coordinates" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      imageUrl = buildStaticMapsUrl(lat, lng, zoom, size);
    }

    // Fetch aerial and inline as data URL so the model always sees the same pixels.
    const { dataUrl } = await fetchImageAsDataUrl(imageUrl);
    // Google static maps @scale=2 returns 2*size px. That's the pixel space the model traces in.
    const width = Math.min(640, size) * 2;
    const height = width;

    const gwRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Trace the roof of the center house. Image is ${width}x${height} pixels. ` +
                      `Return JSON only.`,
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!gwRes.ok) {
      const t = await gwRes.text().catch(() => "");
      return new Response(JSON.stringify({ error: "ai_gateway_error", status: gwRes.status, body: t.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json: any = await gwRes.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const segments = parseSegments(text);

    return new Response(JSON.stringify({
      image: { url: imageUrl, width, height, zoom, source: "google_static_maps" },
      segments,
      count: segments.length,
      raw: text,
      model: MODEL,
      durationMs: Date.now() - startedAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "vision_trace_failed", message: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
