// Vision-prior roof tracer.
//
// Purpose: give the UI a fast, "looks-right" outline of the confirmed roof
// even when the georeferenced measurement pipeline blocks. This is a VISION
// PRIOR — pixel coordinates on the aerial tile, NOT a georeferenced,
// customer-ready measurement. It is safe to render as an overlay for the
// developer test surface and blocked reports.
//
// Input:  { lat, lng, zoom?, size?, image_url?, address?, prefer_roof_center? }
// Output: {
//   image: { url, width, height, zoom, source },
//   segments: [{ type: 'eave'|'rake'|'ridge'|'hip'|'valley', points: [[x,y], ...] }],
//   raw: <model text>,
//   model, durationMs
// }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { parseSegments } from "./segment-parser.ts";

const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const GOOGLE_SOLAR_API_KEY = Deno.env.get("GOOGLE_SOLAR_API_KEY") || GOOGLE_MAPS_API_KEY;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";

const MODEL = "google/gemini-3.5-flash";
const AI_TRACE_TIMEOUT_MS = 28_000;

type Segment = {
  type: "eave" | "rake" | "ridge" | "hip" | "valley";
  points: Array<[number, number]>;
  confidence?: number;
};

type TargetBoxPx = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  source: string;
};

type SolarTarget = {
  center?: { lat: number; lng: number };
  boundingBox?: any;
  areaMeters2?: number;
  segmentCount?: number;
};

const SYSTEM_PROMPT = `You are a roofing measurement vision assistant. You look at
an aerial (top-down satellite) image of a single house and trace the roof edges
of the CENTER house only. The target house is the large roof structure at the
center of the image (near the image center pixel). Ignore neighboring houses,
trees, driveways, pools, patios, screen enclosures, sidewalks, and vehicles.

You must return polyline coordinates in image pixel space (origin top-left,
+x right, +y down). Coordinates MUST be inside the image bounds and MUST lie
on the actual roof pixels of the center house — not floating in the yard, not
on a neighbor's roof, not on trees.

Scale check before returning: the target roof should span a large fraction
(typically 40-70%) of the image width. If your traced perimeter covers less
than 20% of the image width or is offset from the image center by more than
30% of the image size, you are tracing the wrong object — re-locate the
center house and retrace.

Classify every polyline as exactly one of:
- "eave"   : horizontal exterior roof edge along a gutter line (bottom of a slope)
- "rake"   : sloped exterior roof edge along a gable end
- "ridge"  : level horizontal peak where two upslope planes meet
- "hip"    : diagonal edge from a ridge endpoint down to an eave corner
- "valley" : interior V-shaped edge where two roof planes meet inward

Return STRICT COMPACT JSON only, no prose, no markdown fences. Use this minified schema to avoid truncation:

{"s":[["e",x1,y1,x2,y2,confidence],["ra",x1,y1,x2,y2,confidence],["r",x1,y1,x2,y2,confidence],["h",x1,y1,x2,y2,confidence],["v",x1,y1,x2,y2,confidence]]}

Type codes: e=eave, ra=rake, r=ridge, h=hip, v=valley.

Rules:
- Trace the FULL perimeter (all eaves + rakes) as a closed loop of connected segments.
- Trace every visible ridge, hip and valley.
- Each polyline is a straight run of the same type — break at corners/junctions.
- Prefer 2-point straight segments; use more points only when the edge curves.
- Do NOT invent structure you cannot see.
- Do NOT include any segment that lies outside the target house footprint.`;

function buildStaticMapsUrl(lat: number, lng: number, zoom: number, size: number): string {
  const s = Math.min(640, size);
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}` +
    `&zoom=${zoom}&size=${s}x${s}&scale=1&maptype=satellite&key=${GOOGLE_MAPS_API_KEY}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function readLatLng(v: any): { lat: number; lng: number } | null {
  const lat = Number(v?.latitude ?? v?.lat);
  const lng = Number(v?.longitude ?? v?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function readLatLngBox(bb: any): { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } } | null {
  const sw = readLatLng(bb?.sw ?? bb?.southwest ?? bb?.southWest ?? bb?.southWestCorner);
  const ne = readLatLng(bb?.ne ?? bb?.northeast ?? bb?.northEast ?? bb?.northEastCorner);
  return sw && ne ? { sw, ne } : null;
}

function bboxCenter(bb: any): { lat: number; lng: number } | null {
  const box = readLatLngBox(bb);
  if (!box) return null;
  return {
    lat: (box.sw.lat + box.ne.lat) / 2,
    lng: (box.sw.lng + box.ne.lng) / 2,
  };
}

/**
 * Pick a Google Static Maps zoom so the Solar building bbox fills ~fillFraction
 * of the tile's shorter side. Clamped to [19, 21] — Google satellite tiles are
 * unreliable above 21 and too coarse below 19 for roof tracing.
 */
function pickZoomForSolarBox(
  bb: any,
  lat: number,
  size: number,
  fillFraction = 0.6,
): number | null {
  const box = readLatLngBox(bb);
  if (!box || !Number.isFinite(lat)) return null;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const widthMeters = Math.abs(box.ne.lng - box.sw.lng) * 111320 * cosLat;
  const heightMeters = Math.abs(box.ne.lat - box.sw.lat) * 111320;
  const diagonalMeters = Math.max(widthMeters, heightMeters);
  if (!(diagonalMeters > 0)) return null;
  const targetPx = Math.max(64, Math.min(size, size) * fillFraction);
  const metersPerPixel = diagonalMeters / targetPx;
  if (!(metersPerPixel > 0)) return null;
  // metersPerPixel = 156543.03 * cos(lat) / 2^z  ⇒  z = log2(156543.03*cos/mpp)
  const z = Math.log2((156543.03392 * cosLat) / metersPerPixel);
  if (!Number.isFinite(z)) return null;
  return clamp(Math.round(z), 19, 21);
}

async function fetchSolarTarget(lat: number, lng: number): Promise<SolarTarget | null> {
  if (!GOOGLE_SOLAR_API_KEY || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_SOLAR_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    const boundingBox = data?.boundingBox || null;
    const center = bboxCenter(boundingBox);
    return {
      center: center || undefined,
      boundingBox,
      areaMeters2: Number(data?.solarPotential?.buildingStats?.areaMeters2 || 0) || undefined,
      segmentCount: Array.isArray(data?.solarPotential?.roofSegmentStats) ? data.solarPotential.roofSegmentStats.length : undefined,
    };
  } catch {
    return null;
  }
}

function latLngToWorldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const siny = clamp(Math.sin((lat * Math.PI) / 180), -0.9999, 0.9999);
  const scale = 256 * Math.pow(2, zoom);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * scale,
  };
}

function inferStaticMapScale(url: string, width: number, fallbackSize: number): number {
  try {
    const u = new URL(url);
    const explicit = Number(u.searchParams.get("scale"));
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const sizeParam = u.searchParams.get("size");
    if (sizeParam?.includes("x")) {
      const [w] = sizeParam.split("x").map((v) => Number(v.replace(/\D+$/g, "")));
      if (Number.isFinite(w) && w > 0) return Math.max(1, width / w);
    }
  } catch {
    // fall through
  }
  return Math.max(1, width / Math.min(640, fallbackSize));
}

function parseStaticMapCenter(url: string): { lat: number; lng: number } | null {
  try {
    const center = new URL(url).searchParams.get("center");
    if (!center) return null;
    const [lat, lng] = center.split(",").map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

function latLngToImagePixel(
  point: { lat: number; lng: number },
  center: { lat: number; lng: number },
  zoom: number,
  width: number,
  height: number,
  rasterScale: number,
): [number, number] {
  const c = latLngToWorldPixel(center.lat, center.lng, zoom);
  const p = latLngToWorldPixel(point.lat, point.lng, zoom);
  return [width / 2 + (p.x - c.x) * rasterScale, height / 2 + (p.y - c.y) * rasterScale];
}

function projectSolarTargetBox(
  solarTarget: SolarTarget | null,
  center: { lat: number; lng: number },
  zoom: number,
  width: number,
  height: number,
  rasterScale: number,
): TargetBoxPx | null {
  const box = readLatLngBox(solarTarget?.boundingBox);
  if (!box) return null;
  const pts = [
    latLngToImagePixel({ lat: box.sw.lat, lng: box.sw.lng }, center, zoom, width, height, rasterScale),
    latLngToImagePixel({ lat: box.sw.lat, lng: box.ne.lng }, center, zoom, width, height, rasterScale),
    latLngToImagePixel({ lat: box.ne.lat, lng: box.ne.lng }, center, zoom, width, height, rasterScale),
    latLngToImagePixel({ lat: box.ne.lat, lng: box.sw.lng }, center, zoom, width, height, rasterScale),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = Math.max(18, Math.min(width, height) * 0.025);
  const minX = clamp(Math.min(...xs) - pad, 0, width);
  const minY = clamp(Math.min(...ys) - pad, 0, height);
  const maxX = clamp(Math.max(...xs) + pad, 0, width);
  const maxY = clamp(Math.max(...ys) + pad, 0, height);
  if (maxX - minX < width * 0.08 || maxY - minY < height * 0.08) return null;
  return { minX, minY, maxX, maxY, source: "google_solar_building_bbox" };
}

function segmentBounds(segs: Segment[]): TargetBoxPx | null {
  if (segs.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segs) for (const [x, y] of s.points) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY, source: "segments" } : null;
}

function boxIoU(a: TargetBoxPx, b: TargetBoxPx): number {
  const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const inter = ix * iy;
  const areaA = Math.max(1, (a.maxX - a.minX) * (a.maxY - a.minY));
  const areaB = Math.max(1, (b.maxX - b.minX) * (b.maxY - b.minY));
  return inter / (areaA + areaB - inter);
}

function readImageDimensions(buf: Uint8Array): { width: number; height: number } | null {
  // PNG: signature + IHDR width/height, big-endian.
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[12] === 0x49 && buf[13] === 0x48 && buf[14] === 0x44 && buf[15] === 0x52
  ) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: scan SOF markers for dimensions.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      while (offset < buf.length && buf[offset] !== 0xff) offset++;
      while (offset < buf.length && buf[offset] === 0xff) offset++;
      if (offset >= buf.length) break;
      const marker = buf[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 2 > buf.length) break;
      const length = (buf[offset] << 8) + buf[offset + 1];
      if (length < 2 || offset + length > buf.length) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && length >= 7) {
        const height = (buf[offset + 3] << 8) + buf[offset + 4];
        const width = (buf[offset + 5] << 8) + buf[offset + 6];
        return { width, height };
      }
      offset += length;
    }
  }

  return null;
}

function inferStaticMapDimensions(url: string, fallbackSize: number): { width: number; height: number } {
  try {
    const u = new URL(url);
    const sizeParam = u.searchParams.get("size") || u.pathname.match(/\/(\d+)x(\d+)(?:@2x)?(?:\?|$)/)?.[0]?.replace(/[/?@].*$/g, "");
    const pathMatch = u.pathname.match(/\/(\d+)x(\d+)(@2x)?$/);
    let logicalW = Math.min(640, fallbackSize);
    let logicalH = logicalW;
    let scale = Number(u.searchParams.get("scale") || 1);
    if (sizeParam?.includes("x")) {
      const [w, h] = sizeParam.split("x").map((v) => Number(v.replace(/\D+$/g, "")));
      if (Number.isFinite(w) && w > 0) logicalW = w;
      if (Number.isFinite(h) && h > 0) logicalH = h;
    } else if (pathMatch) {
      logicalW = Number(pathMatch[1]);
      logicalH = Number(pathMatch[2]);
      scale = pathMatch[3] ? 2 : scale;
    }
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    return { width: Math.round(logicalW * scale), height: Math.round(logicalH * scale) };
  } catch {
    const s = Math.min(640, fallbackSize);
    return { width: s, height: s };
  }
}

async function fetchImageAsDataUrl(url: string, fallbackSize: number): Promise<{ dataUrl: string; width: number; height: number }> {
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
  const decoded = readImageDimensions(buf) ?? inferStaticMapDimensions(url, fallbackSize);
  return { dataUrl: `data:${mime};base64,${b64}`, width: decoded.width, height: decoded.height };
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
    const zoom = Number.isFinite(Number(body?.zoom)) ? Number(body.zoom) : 21;
    const size = Number.isFinite(Number(body?.size)) ? Number(body.size) : 640;
    let imageUrl: string | undefined = typeof body?.image_url === "string" ? body.image_url : undefined;
    const preferRoofCenter = body?.prefer_roof_center !== false;

    const solarTarget = Number.isFinite(lat) && Number.isFinite(lng) && preferRoofCenter
      ? await fetchSolarTarget(lat, lng)
      : null;
    const roofCenter = solarTarget?.center && !imageUrl ? solarTarget.center : { lat, lng };

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
      imageUrl = buildStaticMapsUrl(roofCenter.lat, roofCenter.lng, zoom, size);
    }

    const { dataUrl, width: detectedWidth, height: detectedHeight } = await fetchImageAsDataUrl(imageUrl, size);
    const modelImageUrl = /^https?:\/\//i.test(imageUrl) ? imageUrl : dataUrl;
    const hintedSize = body?.image_size && typeof body.image_size === "object"
      ? {
        width: Number(body.image_size.width),
        height: Number(body.image_size.height),
      }
      : null;
    const width = Number.isFinite(hintedSize?.width) && Number(hintedSize?.width) > 0
      ? Number(hintedSize?.width)
      : detectedWidth;
    const height = Number.isFinite(hintedSize?.height) && Number(hintedSize?.height) > 0
      ? Number(hintedSize?.height)
      : detectedHeight;
    const mapCenter = parseStaticMapCenter(imageUrl) || roofCenter;
    const rasterScale = inferStaticMapScale(imageUrl, width, size);
    const targetBoxPx = projectSolarTargetBox(solarTarget, mapCenter, zoom, width, height, rasterScale);
    const targetDirective = targetBoxPx
      ? `Authoritative Google Solar target roof box: x ${Math.round(targetBoxPx.minX)}-${Math.round(targetBoxPx.maxX)}, ` +
        `y ${Math.round(targetBoxPx.minY)}-${Math.round(targetBoxPx.maxY)}. The correct roof fills this box; ` +
        `snap exterior roof edges to the visible roof pixels inside/along this box and ignore objects outside it. `
      : `The image center is at (${Math.round(width / 2)}, ${Math.round(height / 2)}). The target roof surrounds that center pixel. `;

    async function runOnce(promptExtra = ""): Promise<Segment[]> {
      const gwRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(AI_TRACE_TIMEOUT_MS),
        headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Trace the roof of the target house. Image is ${width}x${height} pixels. ` +
                        `${body?.address ? `Address: ${String(body.address).slice(0, 160)}. ` : ""}` +
                        `${targetDirective}${promptExtra} Return minified compact JSON only using the {"s":[[type,x1,y1,x2,y2,confidence]]} schema.`,
                },
                { type: "image_url", image_url: { url: modelImageUrl } },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 4000,
          response_format: { type: "json_object" },
        }),
      });
      if (!gwRes.ok) {
        const t = await gwRes.text().catch(() => "");
        throw new Error(`ai_gateway_error status=${gwRes.status} ${t.slice(0, 300)}`);
      }
      const json: any = await gwRes.json();
      const text: string = json?.choices?.[0]?.message?.content ?? "";
      lastRawText = text;
      return parseSegments(text);
    }

    // Sanity: reject only obviously unusable traces. Do not require a strict
    // Solar-box IoU match here: this is a visual prior, and the model may trace
    // the visible eaves wider than the Solar bounding box. The measurement
    // pipeline still owns customer-ready validation.
    function traceOnTarget(segs: Segment[]): boolean {
      const bounds = segmentBounds(segs);
      if (!bounds) return false;
      const { minX, minY, maxX, maxY } = bounds;
      const cx = width / 2, cy = height / 2;
      const spanX = maxX - minX, spanY = maxY - minY;
      if (targetBoxPx) {
        const tx = (targetBoxPx.minX + targetBoxPx.maxX) / 2;
        const ty = (targetBoxPx.minY + targetBoxPx.maxY) / 2;
        const targetSpanX = targetBoxPx.maxX - targetBoxPx.minX;
        const targetSpanY = targetBoxPx.maxY - targetBoxPx.minY;
        const paddedContainsTargetCenter = tx >= minX - targetSpanX * 0.25 && tx <= maxX + targetSpanX * 0.25 && ty >= minY - targetSpanY * 0.25 && ty <= maxY + targetSpanY * 0.25;
        const bigEnoughForTarget = spanX >= targetSpanX * 0.35 && spanY >= targetSpanY * 0.35;
        const nearTarget = boxIoU(bounds, targetBoxPx) >= 0.03 || paddedContainsTargetCenter;
        return bigEnoughForTarget && nearTarget;
      }
      const containsCenter = cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
      const bigEnough = spanX >= width * 0.20 && spanY >= height * 0.20;
      return containsCenter && bigEnough;
    }

    let lastRawText = "";
    let segments: Segment[] = [];
    try {
      segments = await runOnce();
    } catch (e) {
      lastRawText = `[ai_trace_first_pass_failed] ${String(e)}`;
    }
    if (!traceOnTarget(segments)) {
      // Do not draw fake geometry. A bad/off-target AI trace is safer as an
      // empty diagnostic result than as a misleading roof overlay.
      segments = [];
      lastRawText = `${lastRawText}\n[ai_trace_rejected_off_target_no_template_fallback]`;
    }

    return new Response(JSON.stringify({
      image: {
        url: imageUrl,
        width,
        height,
        zoom,
        source: solarTarget?.center && !body?.image_url ? "google_solar_centered_static_maps" : "google_static_maps",
        center_lat: mapCenter.lat,
        center_lng: mapCenter.lng,
        target_box_px: targetBoxPx,
      },
      trace_bounds_px: segmentBounds(segments),
      segments,
      count: segments.length,
      raw: lastRawText,
      model: MODEL,
      durationMs: Date.now() - startedAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "vision_trace_failed", message: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
