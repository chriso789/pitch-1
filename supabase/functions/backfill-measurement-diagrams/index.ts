// Backfill `geometry_report_json.{planes_px,edges_px,raster_size,raster_image_url}`
// for roof_measurements rows that were created before the dev raster overlay
// payload was wired into start-ai-measurement.
//
// Usage:
//   POST /functions/v1/backfill-measurement-diagrams
//   body: { tenant_id?: string, limit?: number, dry_run?: boolean }
//
// Master/admin only — requires service-role on the server side. Caller must
// be authenticated; we do NOT expose this publicly.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PlaneRow {
  polygon_px?: Array<{ x: number; y: number }>;
  source?: string;
}
interface EdgeRow {
  edge_type?: string;
  line_px?: Array<{ x: number; y: number }>;
  source?: string;
}

function buildOverlayPayload(row: any) {
  const ai = row.ai_detection_data || {};
  const grj = row.geometry_report_json || {};
  const planes: PlaneRow[] = grj.planes || ai.planes || [];
  const edges: EdgeRow[] = grj.edges || ai.edges || [];
  const sz = row.analysis_image_size || {};
  const raster_size = {
    width: Number(sz.width) || 0,
    height: Number(sz.height) || 0,
  };
  const raster_image_url = row.mapbox_image_url || null;

  const planes_px = planes
    .map((p) => ({
      polygon: (p.polygon_px || []).map((pt) => [pt.x, pt.y] as [number, number]),
      source: p.source || "unknown",
    }))
    .filter((p) => p.polygon.length >= 3);

  const edges_px = edges
    .map((e) => {
      const pts = e.line_px || [];
      if (pts.length < 2) return null;
      return {
        type: e.edge_type || "ridge",
        p1: [pts[0].x, pts[0].y] as [number, number],
        p2: [pts[1].x, pts[1].y] as [number, number],
        source: e.source || "unknown",
      };
    })
    .filter(Boolean);

  return { planes_px, edges_px, raster_size, raster_image_url };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* no body */
  }
  const tenant_id: string | undefined = body.tenant_id;
  const limit: number = Math.min(Number(body.limit) || 200, 1000);
  const dry_run: boolean = !!body.dry_run;

  let q = supabase
    .from("roof_measurements")
    .select(
      "id, tenant_id, mapbox_image_url, analysis_image_size, ai_detection_data, geometry_report_json",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (tenant_id) q = q.eq("tenant_id", tenant_id);

  const { data: rows, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let scanned = 0;
  let needs_backfill = 0;
  let updated = 0;
  let skipped_no_geometry = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const row of rows || []) {
    scanned++;
    const grj = row.geometry_report_json || {};
    const hasOverlay =
      Array.isArray(grj.planes_px) &&
      Array.isArray(grj.edges_px) &&
      grj.raster_size?.width > 0;
    if (hasOverlay) continue;
    needs_backfill++;

    const payload = buildOverlayPayload(row);
    if (
      payload.planes_px.length === 0 &&
      payload.edges_px.length === 0
    ) {
      skipped_no_geometry++;
      continue;
    }

    if (dry_run) continue;

    const merged = { ...grj, ...payload };
    const { error: upErr } = await supabase
      .from("roof_measurements")
      .update({ geometry_report_json: merged })
      .eq("id", row.id);
    if (upErr) {
      errors.push({ id: row.id, error: upErr.message });
    } else {
      updated++;
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      dry_run,
      scanned,
      needs_backfill,
      updated,
      skipped_no_geometry,
      errors,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
};

Deno.serve(handler);
